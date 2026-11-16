/**
 * Host half of dsh-deepseek-pricing.
 *
 * Registers two read-only HTTP routes plus one write route for the browser
 * half and, when the user enables it, an optional `deepseek_pricing` tool for
 * the model. All network access, caching and calculations live in
 * ./src/data.js.
 *
 * The config shape below is read by apply(); this bundle intentionally exports
 * no Config schema: a workspace-linked bundle resolves bare `@deepseek-ai/*`
 * imports from its real path (the workspace), not from the profile's
 * node_modules, so importing schemastery here would fail to load the plugin.
 * The row in cordis.patch.yml carries the values:
 *
 *   - id: deepseek-pricing
 *     config:
 *       tool: true            # register the model-facing tool
 *       currency: CNY         # CNY | USD
 *       refreshMinutes: 360   # 0 = manual refresh only
 *       holidayRefresh: true  # sync Chinese statutory holidays
 *
 * The settings page edits the Host-owned subset through POST
 * /api/deepseek-pricing/config, which persists through `configEditor` so the
 * values live in the profile's cordis.patch.yml (one source of truth, removed
 * with the row on uninstall) instead of a second store of our own.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDataLayer, describeError } from './src/data.js'
import { normalizeCurrency } from './src/pricing.js'
import { formatToolResult } from './src/format.js'
import { findOwnEntry, sanitizeConfigPatch } from './src/options.js'

/**
 * The holiday cache lives inside the installed package. Uninstalling the bundle
 * deletes that directory, so the cache disappears with no leftover to document
 * and no uninstall hook (DSH has none: `ctx.effect` teardown also runs on
 * disable, reload, and restart, so it cannot mean "uninstall").
 */
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(PACKAGE_DIR, '.cache')
const HOLIDAY_CACHE_FILE = join(CACHE_DIR, 'holidays.json')

async function readHolidayCache() {
  return JSON.parse(await readFile(HOLIDAY_CACHE_FILE, 'utf8'))
}

async function writeHolidayCache(payload) {
  await mkdir(CACHE_DIR, { recursive: true })
  const temporary = `${HOLIDAY_CACHE_FILE}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(payload), 'utf8')
  await rename(temporary, HOLIDAY_CACHE_FILE)
}

/**
 * The browser-facing routes need the web server. Declaring it here makes the
 * fiber wait until the service exists instead of activating early and
 * silently registering nothing; `ctx.inject` below additionally re-registers
 * when the service is replaced.
 */
export const inject = ['webServer']

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(data))
  res.end(data)
}

function createStateHandler(data) {
  return async (req, res) => {
    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET') {
      sendJson(res, 405, { ok: false, error: '只支持 GET' })
      return
    }
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const state = await data.buildState(url.searchParams.get('currency'))
      sendJson(res, 200, state)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: describeError(error) })
    }
  }
}

function createRefreshHandler(data) {
  return async (req, res) => {
    const method = String(req.method || 'POST').toUpperCase()
    if (method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '只支持 POST' })
      return
    }
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const state = await data.refresh(url.searchParams.get('currency'))
      sendJson(res, 200, state)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: describeError(error) })
    }
  }
}

/**
 * Read a small JSON body without trusting its size. The browser half is the
 * only caller, so a hard cap plus a rejected promise is enough.
 */
function readJsonBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Persist the config through the Loader. The response is sent first on
 * purpose: `edit` reconciles this very row, which disposes the fiber that owns
 * this handler, so an awaited write would abort the reply. The browser treats
 * 202 as "saved, reloading" and re-reads /state afterwards.
 */
function createConfigHandler(ctx) {
  return async (req, res) => {
    const method = String(req.method || 'POST').toUpperCase()
    if (method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '只支持 POST' })
      return
    }
    let payload
    try {
      const text = await readJsonBody(req)
      payload = text ? JSON.parse(text) : {}
    } catch (error) {
      sendJson(res, 400, { ok: false, error: describeError(error) })
      return
    }
    const patch = sanitizeConfigPatch(payload)
    if (Object.keys(patch).length === 0) {
      sendJson(res, 400, { ok: false, error: '没有可写入的字段' })
      return
    }
    const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
    if (!editor || typeof editor.edit !== 'function') {
      sendJson(res, 501, {
        ok: false,
        error: '当前 DSH 版本不支持自动写入配置，请手动编辑 profile 的 cordis.patch.yml',
      })
      return
    }
    let entry = null
    try {
      entry = findOwnEntry(editor)
    } catch {
      entry = null
    }
    if (!entry) {
      sendJson(res, 404, {
        ok: false,
        error: '没有找到本插件的配置行，请手动编辑 profile 的 cordis.patch.yml',
      })
      return
    }
    sendJson(res, 202, { ok: true, patch, reload: true })
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => editor.edit(entry, (current) => ({ ...(current || {}), ...patch })))
        .catch(() => {
          // The page re-reads /state, which keeps reporting the old values.
        })
    }, 30)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }
}

function createTool(data, config) {
  return {
    name: 'deepseek_pricing',
    description:
      '查询 DeepSeek API 当前是高峰还是空闲计费时段、距离下次切换还有多久，以及各模型当前单价。仅在需要判断“现在调用是否更便宜、要不要等到空闲时段”时使用。无参数。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      const state = await data.buildState(config.currency)
      return formatToolResult(state)
    },
  }
}

export function apply(ctx, rawConfig = {}) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}
  const config = {
    tool: source.tool === true,
    currency: normalizeCurrency(source.currency),
    refreshMinutes: clampNumber(source.refreshMinutes, 0, 1440, 360),
    holidayRefresh: source.holidayRefresh !== false,
  }
  const data = createDataLayer(config, { readHolidayCache, writeHolidayCache })

  // The web server publishes its service after the Host's plugin rows start,
  // so a one-shot ctx.get('webServer') at apply time answers undefined on a
  // cold start and the routes would never register (the page then receives the
  // auth/404 fallback). ctx.inject keeps a dedicated fiber pending until the
  // service exists and re-runs if the service is replaced.
  ctx.inject(['webServer'], (scoped) => {
    const server = scoped.webServer
    scoped.effect(
      () =>
        server.register({
          kind: 'exact',
          path: '/api/deepseek-pricing/state',
          handler: createStateHandler(data),
        }),
      'deepseek-pricing: state route',
    )
    scoped.effect(
      () =>
        server.register({
          kind: 'exact',
          path: '/api/deepseek-pricing/refresh',
          handler: createRefreshHandler(data),
        }),
      'deepseek-pricing: refresh route',
    )
    scoped.effect(
      () =>
        server.register({
          kind: 'exact',
          path: '/api/deepseek-pricing/config',
          handler: createConfigHandler(ctx),
        }),
      'deepseek-pricing: config route',
    )
  })

  if (config.tool) {
    ctx.inject(['tools'], (scoped) => {
      scoped.effect(
        () => scoped.tools.register(createTool(data, config)),
        'deepseek-pricing: tool',
      )
    })
  }
}
