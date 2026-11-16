/**
 * Cached data layer shared by the HTTP routes and the optional agent tool.
 *
 * Kept free of Cordis and schemastery imports so it can be unit-tested with an
 * injected clock and an injected fetch.
 */

import {
  BEIJING_TIME_ZONE,
  PEAK_WEEKDAYS,
  PEAK_WINDOWS,
  beijingParts,
  evaluatePeak,
  mergeHolidays,
  nextTransition,
} from './peak.js'
import { normalizeCurrency, parsePricingMarkdown, pricingSource } from './pricing.js'
import { holidayCnUrl, parseHolidayCn, parseTimor, timorUrl } from './holidays.js'
import { SNAPSHOT_CAPTURED_AT, snapshotFor, snapshotHolidays } from './snapshot.js'

// timor.tech is occasionally slow (measured 11 s for one year), so the old 8 s
// budget alone produced the "已同步 → 获取失败" flapping. The first state read
// no longer waits for holidays, which makes a generous timeout affordable.
const FETCH_TIMEOUT_MS = 20000
// A statutory calendar changes once a year (the next year is published around
// November), so a weekly check is plenty and a restart inside the window costs
// no network at all.
const HOLIDAY_TTL_MS = 7 * 24 * 3600 * 1000
const HOLIDAY_CACHE_VERSION = 1
const PRICE_RETRY_MS = 60 * 1000
const HOLIDAY_RETRY_MS = 15 * 60 * 1000
const USER_AGENT = 'dsh-deepseek-pricing/0.2'

export function describeError(error) {
  if (!error) return '未知错误'
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 180 ? `${message.slice(0, 177)}…` : message
}

export async function defaultFetchText(url) {
  if (typeof fetch !== 'function') throw new Error('当前运行时没有可用的 fetch')
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/markdown, text/plain, application/json;q=0.9, */*;q=0.8',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.text()
}

function snapshotHolidayYear(year) {
  const snapshot = snapshotHolidays(year)
  if (snapshot) {
    return {
      year,
      status: 'snapshot',
      map: snapshot,
      source: '内置快照',
      updatedAtMs: Date.parse(SNAPSHOT_CAPTURED_AT),
      error: null,
    }
  }
  return { year, status: 'unpublished', map: {}, source: null, updatedAtMs: null, error: null }
}

/**
 * @param {{ tool: boolean, currency: string, refreshMinutes: number, holidayRefresh: boolean }} config
 * @param {{ now?: () => number, fetchText?: (url: string) => Promise<string> }} [deps]
 */
export function createDataLayer(config, deps = {}) {
  const nowFn = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const fetchText = typeof deps.fetchText === 'function' ? deps.fetchText : defaultFetchText
  const readHolidayCache =
    typeof deps.readHolidayCache === 'function' ? deps.readHolidayCache : null
  const writeHolidayCache =
    typeof deps.writeHolidayCache === 'function' ? deps.writeHolidayCache : null

  const priceCache = new Map()
  const priceError = new Map()
  const priceFailureAt = new Map()
  const inflight = new Map()

  const holidayState = {
    years: [],
    merged: {},
    fetchedAtMs: 0,
    attemptAtMs: 0,
    error: null,
  }

  /**
   * Last successful fetch per year. A transient network failure must not throw
   * away a calendar we already have: the settings page used to flip between
   * 已同步 and 获取失败 whenever a refresh hiccuped, and holiday pricing
   * silently fell back to "no holidays" for a year that had just been fetched.
   */
  const holidayLastGood = new Map()
  // Consecutive refreshes that could not fetch a real calendar; the first few
  // retry within a minute, then the gate widens to HOLIDAY_RETRY_MS.
  let holidayFailures = 0

  function rememberHolidayYear(year, entry) {
    holidayLastGood.set(year, {
      map: entry.map,
      source: entry.source,
      updatedAtMs: entry.updatedAtMs,
    })
  }

  function lastGoodHolidayYear(year, error) {
    const previous = holidayLastGood.get(year)
    if (!previous) return null
    return {
      year,
      status: 'stale',
      map: previous.map,
      source: previous.source,
      updatedAtMs: previous.updatedAtMs,
      error,
    }
  }

  /**
   * The cache lives inside the installed package (`.cache/holidays.json`), so
   * uninstalling the bundle — which deletes that directory — also removes it.
   * Hydrating restores the calendars *and* the fetch clock, so a restart inside
   * the TTL performs no request at all.
   */
  let holidayCacheHydrated = false

  async function hydrateHolidayCache() {
    if (holidayCacheHydrated) return
    holidayCacheHydrated = true
    if (!readHolidayCache) return
    let cached
    try {
      cached = await readHolidayCache()
    } catch {
      return
    }
    if (!cached || cached.version !== HOLIDAY_CACHE_VERSION || !Array.isArray(cached.years)) return
    const currentYear = beijingParts(nowFn()).year
    const years = []
    for (const entry of cached.years) {
      if (!entry || !Number.isInteger(entry.year)) continue
      if (entry.year < currentYear || entry.year > currentYear + 1) continue
      if (!entry.map || typeof entry.map !== 'object') continue
      const good = {
        map: entry.map,
        source: typeof entry.source === 'string' ? entry.source : '磁盘缓存',
        updatedAtMs: Number(entry.updatedAtMs) || 0,
      }
      holidayLastGood.set(entry.year, good)
      years.push({
        year: entry.year,
        status: 'fresh',
        map: good.map,
        source: good.source,
        updatedAtMs: good.updatedAtMs,
        error: null,
      })
    }
    if (years.length === 0) return
    holidayState.years = years.sort((a, b) => a.year - b.year)
    holidayState.merged = mergeHolidays(holidayState.years)
    const savedAtMs = Number(cached.savedAtMs) || 0
    if (savedAtMs > 0) {
      holidayState.fetchedAtMs = savedAtMs
      holidayState.attemptAtMs = savedAtMs
    }
  }

  /**
   * Cold start with no cache: answer immediately from the built-in snapshot and
   * let the fetch land behind the request. The old behaviour blocked the first
   * state read for the whole fetch (up to 16 s with the old timeout).
   */
  function seedPendingHolidayYears() {
    const year = beijingParts(nowFn()).year
    holidayState.years = [year, year + 1].map((entryYear) => {
      const snapshot = snapshotHolidays(entryYear)
      return {
        year: entryYear,
        status: 'pending',
        map: snapshot || {},
        source: snapshot ? '内置快照' : null,
        updatedAtMs: snapshot ? Date.parse(SNAPSHOT_CAPTURED_AT) : null,
        error: null,
      }
    })
    holidayState.merged = mergeHolidays(holidayState.years)
    holidayState.attemptAtMs = 0
  }

  function persistHolidayCache() {
    if (!writeHolidayCache) return
    const currentYear = beijingParts(nowFn()).year
    const years = Array.from(holidayLastGood.entries())
      .filter(([year]) => year >= currentYear && year <= currentYear + 1)
      .map(([year, good]) => ({
        year,
        map: good.map,
        source: good.source,
        updatedAtMs: good.updatedAtMs,
      }))
      .sort((a, b) => a.year - b.year)
    if (years.length === 0) return
    const payload = { version: HOLIDAY_CACHE_VERSION, savedAtMs: nowFn(), years }
    Promise.resolve()
      .then(() => writeHolidayCache(payload))
      .catch(() => {
        // A read-only package directory only costs the next cold start a fetch.
      })
  }

  function single(key, task) {
    if (inflight.has(key)) return inflight.get(key)
    const promise = task().finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, promise)
    return promise
  }

  async function fetchHolidayYear(year) {
    if (!config.holidayRefresh) return snapshotHolidayYear(year)
    let lastError = null
    let sawUnpublished = false
    const attempts = [
      { url: timorUrl(year), parse: parseTimor },
      { url: holidayCnUrl(year), parse: parseHolidayCn },
    ]
    for (const attempt of attempts) {
      try {
        const text = await fetchText(attempt.url)
        const parsed = attempt.parse(text, year)
        if (parsed.status === 'ok') {
          const entry = {
            year,
            status: 'fresh',
            map: parsed.map,
            source: attempt.url,
            updatedAtMs: nowFn(),
            error: null,
          }
          rememberHolidayYear(year, entry)
          return entry
        }
        sawUnpublished = true
      } catch (error) {
        lastError = error
      }
    }
    // Keep the last calendar we actually received rather than degrading to the
    // snapshot (or to nothing) on a single failed refresh.
    const previous = lastGoodHolidayYear(
      year,
      sawUnpublished && !lastError ? '本次未返回节假日数据' : describeError(lastError),
    )
    if (previous) return previous
    const snapshot = snapshotHolidays(year)
    if (snapshot) {
      return {
        year,
        status: 'snapshot',
        map: snapshot,
        source: '内置快照',
        updatedAtMs: Date.parse(SNAPSHOT_CAPTURED_AT),
        error: null,
      }
    }
    if (sawUnpublished) {
      return { year, status: 'unpublished', map: {}, source: null, updatedAtMs: null, error: null }
    }
    return {
      year,
      status: 'unavailable',
      map: {},
      source: null,
      updatedAtMs: null,
      error: describeError(lastError),
    }
  }

  /**
   * One refresh, deduplicated by `single`. The first call in a process waits for
   * it (the page has a loading state); every later call serves the cached state
   * and refreshes behind it, so an 8-second timeout never blocks the UI.
   */
  function refreshHolidays() {
    return single('holidays', async () => {
      holidayState.attemptAtMs = nowFn()
      const year = beijingParts(nowFn()).year
      const years = await Promise.all([year, year + 1].map(fetchHolidayYear))
      holidayState.years = years
      holidayState.merged = mergeHolidays(years)
      holidayState.error = years.find((entry) => entry.error)?.error || null
      // "Unpublished" is a definitive answer from the source, not a failure: it
      // earns the full TTL instead of being retried every 15 minutes all year.
      const settled = years.every(
        (entry) => entry.status === 'fresh' || entry.status === 'unpublished',
      )
      holidayFailures = settled ? 0 : holidayFailures + 1
      // Only a settled set earns the long TTL; anything else is retried after
      // the shorter gate instead of being trusted for a week.
      holidayState.fetchedAtMs = settled ? nowFn() : 0
      if (years.some((entry) => entry.status === 'fresh')) persistHolidayCache()
      return holidayState
    })
  }

  function kickHolidayRefresh() {
    refreshHolidays().catch(() => {
      // The next build reports the failure through holidayWarnings().
    })
  }

  async function loadHolidays(force) {
    await hydrateHolidayCache()
    if (!config.holidayRefresh) {
      if (holidayState.years.length === 0) {
        const year = beijingParts(nowFn()).year
        holidayState.years = [year, year + 1].map(snapshotHolidayYear)
        holidayState.merged = mergeHolidays(holidayState.years)
      } else {
        // Sync is off, but a calendar from an earlier sync is still real data —
        // label it honestly instead of pretending it is a fresh fetch.
        holidayState.years = holidayState.years.map((entry) => ({ ...entry, status: 'cached' }))
      }
      return holidayState
    }
    if (holidayState.years.length === 0) seedPendingHolidayYears()
    const nowMs = nowFn()
    const fresh =
      holidayState.fetchedAtMs > 0 && nowMs - holidayState.fetchedAtMs < HOLIDAY_TTL_MS
    if (!force && fresh) return holidayState
    if (!force) {
      const retryMs = holidayFailures > 0 && holidayFailures <= 3 ? 60 * 1000 : HOLIDAY_RETRY_MS
      if (nowMs - holidayState.attemptAtMs >= retryMs) kickHolidayRefresh()
      return holidayState
    }
    await refreshHolidays()
    return holidayState
  }

  async function loadPrices(rawCurrency, force) {
    const currency = normalizeCurrency(rawCurrency)
    const ttl = config.refreshMinutes > 0 ? config.refreshMinutes * 60000 : 0
    const cached = priceCache.get(currency)
    const fresh = Boolean(cached && ttl > 0 && nowFn() - cached.fetchedAtMs < ttl)
    if (!force && (fresh || (cached && ttl === 0))) {
      return { ...cached, error: priceError.get(currency) || null }
    }
    if (
      !force &&
      priceFailureAt.has(currency) &&
      nowFn() - priceFailureAt.get(currency) < PRICE_RETRY_MS
    ) {
      const fallback = cached || snapshotFor(currency)
      return { ...fallback, error: priceError.get(currency) || null }
    }

    return single(`price:${currency}`, async () => {
      try {
        const markdown = await fetchText(pricingSource(currency))
        const parsed = parsePricingMarkdown(markdown, currency)
        const record = {
          ...parsed,
          fetchedAtMs: nowFn(),
          source: pricingSource(currency),
          stale: false,
        }
        priceCache.set(currency, record)
        priceError.delete(currency)
        priceFailureAt.delete(currency)
        return { ...record, error: null }
      } catch (error) {
        const message = describeError(error)
        priceError.set(currency, message)
        priceFailureAt.set(currency, nowFn())
        const fallback = cached || snapshotFor(currency)
        return { ...fallback, error: message }
      }
    })
  }

  function clockOf(ms) {
    if (!Number.isFinite(ms)) return null
    const parts = beijingParts(ms)
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
  }

  function holidayWarnings() {
    const warnings = []
    for (const entry of holidayState.years) {
      if (entry.status === 'pending') continue
      if (entry.status === 'unpublished') {
        warnings.push(`${entry.year} 年法定节假日数据尚未发布，节假日期间可能被误判为高峰`)
      } else if (entry.status === 'unavailable') {
        warnings.push(
          `${entry.year} 年节假日数据获取失败${entry.error ? `（${entry.error}）` : ''}，按无节假日计算`,
        )
      } else if (entry.status === 'stale') {
        const at = clockOf(entry.updatedAtMs)
        warnings.push(
          `${entry.year} 年节假日本次刷新失败${entry.error ? `（${entry.error}）` : ''}，沿用${
            at ? ` ${at} ` : '上次'
          }成功获取的数据；节假日判断仍然有效`,
        )
      }
    }
    if (
      holidayState.years.length > 0 &&
      holidayState.years.every((entry) => entry.status === 'snapshot')
    ) {
      warnings.push('节假日数据来自内置快照')
    }
    return warnings
  }

  async function buildState(rawCurrency) {
    const currency = normalizeCurrency(rawCurrency)
    const nowMs = nowFn()
    const parts = beijingParts(nowMs)
    const [price, holidayData] = await Promise.all([
      loadPrices(currency, false),
      loadHolidays(false),
    ])
    const holidays = holidayData.merged || {}
    const today = evaluatePeak(parts, holidays)
    const transition = nextTransition(nowMs, holidays)

    const warnings = []
    if (price.error) warnings.push(`价格同步失败：${price.error}`)
    if (price.stale) warnings.push('当前显示的是离线价格快照，可能不是最新价格')
    if (price.scheduleNote && price.scheduleNote.known === false) {
      warnings.push('官方时段说明可能已变化，请核对官方定价页')
    }
    warnings.push(...holidayWarnings())

    return {
      ok: true,
      nowMs,
      timeZone: BEIJING_TIME_ZONE,
      beijing: {
        dateKey: parts.dateKey,
        isoWeekday: parts.isoWeekday,
        hour: parts.hour,
        minute: parts.minute,
      },
      period: today.period,
      today: {
        holidayName: today.holidayName,
        workday: today.workday,
        inWindow: today.inWindow,
      },
      schedule: {
        windows: PEAK_WINDOWS,
        weekdays: PEAK_WEEKDAYS,
        timeZone: BEIJING_TIME_ZONE,
      },
      nextTransition: transition ? { atMs: transition.atMs, to: transition.to } : null,
      prices: {
        currency: price.currency,
        unit: 'per_1m_tokens',
        models: price.models,
        searchFetch: price.searchFetch ?? null,
        fetchedAtMs: price.fetchedAtMs ?? null,
        source: price.source,
        stale: Boolean(price.stale),
        error: price.error || null,
      },
      scheduleNote: price.scheduleNote || null,
      holidays: {
        todayName: today.holidayName,
        years: holidayData.years.map((entry) => ({
          year: entry.year,
          status: entry.status,
          source: entry.source,
          updatedAtMs: entry.updatedAtMs,
        })),
        // Date -> holiday name, so the browser can price a past turn at the
        // period that applied when it ended (weekend/holiday aware).
        dates: holidays,
      },
      warnings,
      config: {
        tool: config.tool,
        currency: config.currency,
        refreshMinutes: config.refreshMinutes,
        // The settings page mirrors every writable switch from here, so a
        // written value must come back or the checkbox would snap back.
        holidayRefresh: config.holidayRefresh,
      },
    }
  }

  async function refresh(rawCurrency) {
    const currency = normalizeCurrency(rawCurrency)
    await Promise.allSettled([
      loadPrices(currency, true),
      loadPrices(currency === 'CNY' ? 'USD' : 'CNY', true),
      loadHolidays(true),
    ])
    return buildState(currency)
  }

  return { buildState, refresh }
}
