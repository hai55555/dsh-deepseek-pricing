/**
 * Model-facing and human-facing formatting shared by the tool result.
 * Kept outside index.js so tests can cover it without loading the plugin host.
 */

import { beijingParts } from './peak.js'

const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function pad2(value) {
  return String(value).padStart(2, '0')
}

export function trimNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return String(Number(value.toFixed(4)))
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '不到 1 分钟'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '不到 1 分钟'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours <= 0) return `${rest} 分钟`
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

export function formatStamp(ms) {
  if (!Number.isFinite(ms)) return '未知时间'
  const parts = beijingParts(ms)
  return `${parts.dateKey} ${pad2(parts.hour)}:${pad2(parts.minute)}`
}

export function formatBeijingClock(ms) {
  const parts = beijingParts(ms)
  return `${parts.dateKey} ${WEEKDAYS[parts.isoWeekday]} ${pad2(parts.hour)}:${pad2(parts.minute)}`
}

/**
 * Compact Markdown shown to the model by the optional `deepseek_pricing` tool.
 * @param {any} state result of the host data layer's buildState()
 */
export function formatToolResult(state) {
  const parts = beijingParts(state.nowMs)
  const clock = `${pad2(parts.hour)}:${pad2(parts.minute)}`
  const isUsd = state.prices.currency === 'USD'
  const symbol = isUsd ? '$' : '¥'
  const currencyName = isUsd ? '美元' : '人民币'
  const periodKey = state.period === 'peak' ? 'peak' : 'offPeak'
  const periodName = state.period === 'peak' ? '高峰（全价）' : '空闲（半价）'
  const lines = [
    `DeepSeek 计费时段：${periodName}`,
    `北京时间：${parts.dateKey} ${WEEKDAYS[parts.isoWeekday]} ${clock}`,
  ]
  if (state.today && state.today.holidayName) {
    lines.push(`今日：${state.today.holidayName}（法定节假日，全天空闲）`)
  } else {
    lines.push('今日：周一至周五 09:00–12:00、14:00–18:00 为高峰，其余为空闲')
  }
  if (state.nextTransition) {
    const at = beijingParts(state.nextTransition.atMs)
    const target = state.nextTransition.to === 'peak' ? '高峰' : '空闲'
    lines.push(
      `下一次切换：${pad2(at.hour)}:${pad2(at.minute)} 起为${target}（约 ${formatDuration(
        state.nextTransition.atMs - state.nowMs,
      )}后）`,
    )
  }
  lines.push(
    `价格（${currencyName}，每百万 tokens，当前为${state.period === 'peak' ? '高峰价' : '空闲价'}）：`,
  )
  for (const model of state.prices.models) {
    const price = model[periodKey]
    lines.push(
      `- ${model.id}：输入(缓存命中) ${symbol}${trimNumber(price.cacheHit)}、输入(缓存未命中) ${symbol}${trimNumber(
        price.cacheMiss,
      )}、输出 ${symbol}${trimNumber(price.output)}`,
    )
  }
  lines.push(
    `数据：${state.prices.stale ? '离线快照' : '官方文档'}，更新于 ${formatStamp(state.prices.fetchedAtMs)}`,
  )
  for (const warning of state.warnings || []) lines.push(`注意：${warning}`)
  return lines.join('\n')
}
