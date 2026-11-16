import test from 'node:test'
import assert from 'node:assert/strict'

import { createDataLayer } from '../src/data.js'
import { pricingSource } from '../src/pricing.js'
import { timorUrl } from '../src/holidays.js'

/**
 * A transient holiday fetch failure must never throw away a calendar that was
 * already fetched: the settings page used to flip 已同步 → 获取失败, and the
 * peak calculation silently lost every holiday for that year.
 */

const ZH_MARKDOWN = `| 模型 | 模型 | 模型 | deepseek-flash(1) | deepseek-v4-pro |
| --- | --- | --- | --- | --- |
| 模型版本 | 模型版本 | 模型版本 | DeepSeek-V4.1-Flash-1017 | DeepSeek-V4-Pro-0813 |
| 价格(2) | 百万tokens输入 / （缓存命中） | 空闲时段 | 0.02元 | 0.15元 |
| 价格(2) | 百万tokens输入 / （缓存命中） | 高峰时段 | 0.04元 | 0.30元 |
| 价格(2) | 百万tokens输入 /（缓存未命中） | 空闲时段 | 1元 | 4.5元 |
| 价格(2) | 百万tokens输入 /（缓存未命中） | 高峰时段 | 2元 | 9.0元 |
| 价格(2) | 百万tokens输出 | 空闲时段 | 4元 | 13.5元 |
| 价格(2) | 百万tokens输出 | 高峰时段 | 8元 | 27.0元 |
| Search | 每 1,000 次成功请求 | 5元 |
| Fetch | 每 1,000 次成功请求 | 5元 |

(2) 空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。
`

const TIMOR = {
  2026: JSON.stringify({
    code: 0,
    holiday: {
      '01-01': { holiday: true, name: '元旦', date: '2026-01-01' },
      '10-01': { holiday: true, name: '国庆节', date: '2026-10-01' },
    },
  }),
  2027: JSON.stringify({
    code: 0,
    holiday: { '01-01': { holiday: true, name: '元旦', date: '2027-01-01' } },
  }),
}

function makeLayer(options = {}) {
  const state = { offline: false, now: Date.parse('2026-11-16T00:30:00Z') }
  const layer = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: true },
    {
      now: () => state.now,
      fetchText: async (url) => {
        if (url === pricingSource('CNY')) return ZH_MARKDOWN
        if (url === pricingSource('USD')) return ZH_MARKDOWN
        if (state.offline) throw new Error('fetch failed')
        for (const year of [2026, 2027]) {
          if (url === timorUrl(year)) return TIMOR[year]
        }
        throw new Error(`no fixture for ${url}`)
      },
    },
  )
  return { layer, state, options }
}

const yearOf = (state, year) => state.holidays.years.find((entry) => entry.year === year)

test('a successful fetch is remembered and reported as synced', async () => {
  const { layer } = makeLayer()
  const state = await layer.buildState('CNY')
  assert.equal(yearOf(state, 2026).status, 'fresh')
  assert.equal(yearOf(state, 2027).status, 'fresh')
  assert.equal(state.holidays.dates['2027-01-01'].name, '元旦')
  assert.equal(state.warnings.length, 0)
})

test('a failed refresh keeps the last calendar instead of dropping it', async () => {
  const { layer, state: clock } = makeLayer()
  await layer.buildState('CNY')

  clock.offline = true
  const afterFailure = await layer.refresh('CNY')

  const kept = yearOf(afterFailure, 2027)
  assert.equal(kept.status, 'stale', 'a transient failure must not fall back to 获取失败')
  assert.equal(afterFailure.holidays.dates['2027-01-01'].name, '元旦', 'holiday pricing keeps working')
  assert.ok(afterFailure.warnings.some((warning) => warning.includes('2027') && warning.includes('沿用')))
  // 2026 also keeps its fetched calendar rather than regressing to the snapshot.
  assert.equal(yearOf(afterFailure, 2026).status, 'stale')
})

test('the next successful refresh clears the stale marker', async () => {
  const { layer, state: clock } = makeLayer()
  await layer.buildState('CNY')
  clock.offline = true
  await layer.refresh('CNY')
  clock.offline = false
  const recovered = await layer.refresh('CNY')
  assert.equal(yearOf(recovered, 2027).status, 'fresh')
  assert.equal(recovered.warnings.length, 0)
})

test('with no previous calendar the fallback is the snapshot, then nothing', async () => {
  const { layer, state: clock } = makeLayer()
  clock.offline = true
  const cold = await layer.buildState('CNY')
  // 2026 has a built-in snapshot; 2027 has none.
  assert.equal(yearOf(cold, 2026).status, 'snapshot')
  assert.equal(yearOf(cold, 2027).status, 'unavailable')
  assert.ok(cold.warnings.some((warning) => warning.includes('2027') && warning.includes('按无节假日计算')))
})

test('a year the sources report as empty stays unpublished, not failed', async () => {
  const state = { now: Date.parse('2026-11-16T00:30:00Z') }
  const layer = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: true },
    {
      now: () => state.now,
      fetchText: async (url) => {
        if (url === pricingSource('CNY')) return ZH_MARKDOWN
        if (url === timorUrl(2026)) return TIMOR[2026]
        if (url === timorUrl(2027)) return JSON.stringify({ code: 0, holiday: {} })
        throw new Error('no fixture')
      },
    },
  )
  const result = await layer.refresh('CNY')
  assert.equal(yearOf(result, 2026).status, 'fresh')
  assert.equal(yearOf(result, 2027).status, 'unpublished')
  assert.ok(result.warnings.some((warning) => warning.includes('2027') && warning.includes('尚未发布')))
})

/* ---------------------------------------------------------------------- */
/* disk cache (.cache/holidays.json inside the package)                    */
/* ---------------------------------------------------------------------- */

const T0 = Date.parse('2026-11-16T00:30:00Z')
const HOUR = 3600 * 1000
const flush = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

function cachedYears(savedAtMs) {
  return {
    version: 1,
    savedAtMs,
    years: [
      { year: 2026, map: { '2026-01-01': { name: '元旦' } }, source: 'timor', updatedAtMs: savedAtMs },
      { year: 2027, map: { '2027-01-01': { name: '元旦' } }, source: 'timor', updatedAtMs: savedAtMs },
    ],
  }
}

test('a cold start answers from the snapshot and fetches behind it', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const layer = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: true },
    {
      now: () => T0,
      fetchText: async (url) => {
        if (url === pricingSource('CNY')) return ZH_MARKDOWN
        await gate // hold the holiday request so the state must not wait for it
        for (const year of [2026, 2027]) if (url === timorUrl(year)) return TIMOR[year]
        throw new Error('no fixture')
      },
      readHolidayCache: async () => null,
      writeHolidayCache: async () => {},
    },
  )
  const first = await layer.buildState('CNY')
  // The request must not wait for the fetch: pending, with real snapshot data
  // already in place for the current year.
  assert.deepEqual(first.holidays.years.map((entry) => entry.status), ['pending', 'pending'])
  assert.equal(first.holidays.dates['2026-10-01'].name, '国庆节')
  release()
  await flush()
  const second = await layer.buildState('CNY')
  assert.deepEqual(second.holidays.years.map((entry) => entry.status), ['fresh', 'fresh'])
  assert.equal(second.holidays.dates['2027-01-01'].name, '元旦')
})

test('a fresh disk cache skips the network entirely after a restart', async () => {
  const holidayFetches = []
  const layer = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: true },
    {
      now: () => T0,
      fetchText: async (url) => {
        if (url === pricingSource('CNY')) return ZH_MARKDOWN
        holidayFetches.push(url)
        throw new Error('holiday fetch must not happen while the cache is fresh')
      },
      readHolidayCache: async () => cachedYears(T0 - HOUR),
      writeHolidayCache: async () => {},
    },
  )
  const state = await layer.buildState('CNY')
  assert.deepEqual(holidayFetches, [])
  assert.equal(yearOf(state, 2026).status, 'fresh')
  assert.equal(yearOf(state, 2027).status, 'fresh')
  assert.equal(state.holidays.dates['2027-01-01'].name, '元旦')
  assert.equal(state.warnings.length, 0)
})

test('the cache is written after a successful fetch', async () => {
  const writes = []
  const layer = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: true },
    {
      now: () => T0,
      fetchText: async (url) => {
        if (url === pricingSource('CNY')) return ZH_MARKDOWN
        for (const year of [2026, 2027]) if (url === timorUrl(year)) return TIMOR[year]
        throw new Error('no fixture')
      },
      readHolidayCache: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      writeHolidayCache: async (payload) => {
        writes.push(payload)
      },
    },
  )
  await layer.buildState('CNY')
  await flush()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].version, 1)
  assert.deepEqual(
    writes[0].years.map((entry) => entry.year),
    [2026, 2027],
  )
  assert.equal(writes[0].years[1].map['2027-01-01'].name, '元旦')
  // Keep the unused layer referenced so its fixtures stay honest.
  assert.ok(layer)
})

test('an expired cache still serves data while the refresh fails', async () => {
  const layer = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: true },
    {
      now: () => T0,
      fetchText: async (url) => {
        if (url === pricingSource('CNY')) return ZH_MARKDOWN
        throw new Error('fetch failed')
      },
      readHolidayCache: async () => cachedYears(T0 - 8 * 24 * HOUR),
      writeHolidayCache: async () => {},
    },
  )
  const first = await layer.buildState('CNY')
  assert.equal(first.holidays.dates['2027-01-01'].name, '元旦', 'cached calendar is used immediately')
  await flush()
  const second = await layer.buildState('CNY')
  assert.equal(yearOf(second, 2027).status, 'stale')
  assert.equal(second.holidays.dates['2027-01-01'].name, '元旦')
  assert.ok(second.warnings.some((warning) => warning.includes('沿用')))
})

test('a broken or out-of-range cache is ignored', async () => {
  const broken = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: true },
    {
      now: () => T0,
      fetchText: async (url) => {
        if (url === pricingSource('CNY')) return ZH_MARKDOWN
        for (const year of [2026, 2027]) if (url === timorUrl(year)) return TIMOR[year]
        throw new Error('no fixture')
      },
      readHolidayCache: async () => {
        throw new Error('Unexpected end of JSON input')
      },
      writeHolidayCache: async () => {},
    },
  )
  const recovered = await broken.refresh('CNY')
  assert.equal(yearOf(recovered, 2027).status, 'fresh')

  const pruned = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: true },
    {
      now: () => T0,
      fetchText: async (url) => {
        if (url === pricingSource('CNY')) return ZH_MARKDOWN
        throw new Error('should not fetch while the cache is fresh')
      },
      readHolidayCache: async () => ({
        version: 1,
        savedAtMs: T0 - HOUR,
        years: [
          { year: 2024, map: { '2024-01-01': { name: '元旦' } }, source: 'timor', updatedAtMs: 0 },
          { year: 2026, map: { '2026-01-01': { name: '元旦' } }, source: 'timor', updatedAtMs: 0 },
        ],
      }),
      writeHolidayCache: async () => {},
    },
  )
  const state = await pruned.buildState('CNY')
  assert.deepEqual(
    state.holidays.years.map((entry) => entry.year),
    [2026],
  )
  assert.equal(state.holidays.dates['2024-01-01'], undefined)
})

test('sync-off uses the cached calendar and labels it as such', async () => {
  const layer = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: false },
    {
      now: () => T0,
      fetchText: async (url) => {
        if (url === pricingSource('CNY')) return ZH_MARKDOWN
        throw new Error('holiday sync is off')
      },
      readHolidayCache: async () => cachedYears(T0 - 30 * 24 * HOUR),
      writeHolidayCache: async () => {},
    },
  )
  const state = await layer.buildState('CNY')
  assert.equal(yearOf(state, 2027).status, 'cached')
  assert.equal(state.holidays.dates['2027-01-01'].name, '元旦')
})