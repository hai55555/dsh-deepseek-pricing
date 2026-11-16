import test from 'node:test'
import assert from 'node:assert/strict'

import { createDataLayer } from '../src/data.js'
import { pricingSource } from '../src/pricing.js'
import { timorUrl } from '../src/holidays.js'

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

const TIMOR_2026 = JSON.stringify({
  code: 0,
  holiday: {
    '01-01': { holiday: true, name: '元旦', date: '2026-01-01' },
    '10-01': { holiday: true, name: '国庆节', date: '2026-10-01' },
    '10-10': { holiday: false, name: '国庆节后补班', date: '2026-10-10' },
  },
})
const TIMOR_2027 = JSON.stringify({ code: 0, holiday: {} })

test('state carries the holiday dates the browser needs for past-turn pricing', async () => {
  const responses = new Map([
    [pricingSource('CNY'), ZH_MARKDOWN],
    [timorUrl(2026), TIMOR_2026],
    [timorUrl(2027), TIMOR_2027],
  ])
  const layer = createDataLayer(
    { tool: false, currency: 'CNY', refreshMinutes: 360, holidayRefresh: true },
    {
      now: () => Date.parse('2026-11-04T09:16:00Z'),
      fetchText: async (url) => {
        if (!responses.has(url)) throw new Error(`no fixture for ${url}`)
        return responses.get(url)
      },
    },
  )
  // Forced refresh: the first read now answers from the snapshot and fetches behind it.
  const state = await layer.refresh('CNY')
  assert.equal(state.period, 'peak')
  assert.equal(state.holidays.dates['2026-10-01'].name, '国庆节')
  assert.equal(state.holidays.dates['2026-10-10'], undefined)
  assert.equal(state.prices.models[0].peak.cacheMiss, 2)
  assert.equal(state.nextTransition.atMs, Date.parse('2026-11-04T10:00:00Z'))
  assert.ok(state.warnings.some((warning) => warning.includes('2027')))
})
