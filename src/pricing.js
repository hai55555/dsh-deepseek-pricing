/**
 * Parse the Markdown edition of the official DeepSeek pricing page.
 *
 * The page offers a "copy Markdown" edition, which is far more stable than the
 * rendered HTML:
 *   https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md  (CNY)
 *   https://api-docs.deepseek.com/quick_start/pricing.md        (USD)
 *
 * The parser is deliberately tolerant about row shape (merged cells duplicate
 * labels) and strict about the numbers it accepts: a row it cannot prove is
 * rejected instead of half-applied.
 */

export const PRICING_SOURCES = Object.freeze({
  CNY: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md',
  USD: 'https://api-docs.deepseek.com/quick_start/pricing.md',
})

export const PRICE_DIMENSIONS = Object.freeze(['cacheHit', 'cacheMiss', 'output'])

const MODEL_ID = /^deepseek-[a-z0-9]+(?:-[a-z0-9]+)*$/i
const MONEY = /^(?:([¥$])\s*)?(\d+(?:\.\d+)?)\s*(元)?$/

export class PricingParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PricingParseError'
  }
}

export function normalizeCurrency(value) {
  const text = String(value || '').trim().toUpperCase()
  return text === 'USD' || text === '$' || text === '美元' ? 'USD' : 'CNY'
}

export function pricingSource(currency) {
  return PRICING_SOURCES[normalizeCurrency(currency)]
}

function splitRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function stripFootnote(cell) {
  return String(cell || '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .trim()
}

function parseMoneyCell(cell) {
  const text = String(cell || '').trim()
  if (!text) return null
  const match = text.match(MONEY)
  if (!match) return null
  const [, symbol, number, yuan] = match
  if (!symbol && !yuan) return null
  const value = Number(number)
  if (!Number.isFinite(value) || value <= 0) return null
  return { value, symbol: symbol || null, yuan: Boolean(yuan) }
}

function detectDimension(text) {
  if (/缓存\s*未命中|CACHE\s*MISS/i.test(text)) return 'cacheMiss'
  if (/缓存\s*命中|CACHE\s*HIT/i.test(text)) return 'cacheHit'
  if (/输出|OUTPUT/i.test(text)) return 'output'
  return null
}

function detectPeriod(text) {
  if (/空闲|OFF[\s-]*PEAK/i.test(text)) return 'offPeak'
  if (/高峰|\bPEAK\b/i.test(text)) return 'peak'
  return null
}

function validateMoney(money, currency) {
  if (currency === 'USD') {
    if (money.symbol !== '$') {
      throw new PricingParseError('英文定价页应使用美元符号，实际不是 $ 金额')
    }
    return
  }
  if (money.symbol === '$') {
    throw new PricingParseError('中文定价页出现了美元金额，币种不匹配')
  }
  if (!money.yuan && money.symbol !== '¥') {
    throw new PricingParseError('中文定价页金额缺少“元”或 ¥ 标记')
  }
}

/**
 * @param {string} markdown
 * @param {'CNY' | 'USD'} rawCurrency
 * @returns {{
 *   currency: string,
 *   models: Array<{ id: string, name: string, peak: Record<string, number>, offPeak: Record<string, number> }>,
 *   searchFetch: number | null,
 *   scheduleNote: { text: string, known: boolean } | null,
 * }}
 */
export function parsePricingMarkdown(markdown, rawCurrency) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw new PricingParseError('定价页内容为空')
  }
  const currency = normalizeCurrency(rawCurrency)
  const lines = markdown.split(/\r?\n/)

  let headerIndex = -1
  let modelIds = []
  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitRow(lines[index])
    if (!cells || cells.length < 3) continue
    const first = stripFootnote(cells[0])
    const isModelHeader = first === '模型' || first.toUpperCase() === 'MODEL'
    if (!isModelHeader) continue
    const ids = cells
      .slice(1)
      .map(stripFootnote)
      .filter((cell) => MODEL_ID.test(cell))
    if (ids.length >= 2) {
      headerIndex = index
      modelIds = ids.slice(-2)
      break
    }
  }
  if (headerIndex < 0) {
    throw new PricingParseError('未找到模型表头（期望包含 deepseek-* 模型名）')
  }

  let names = []
  for (const line of lines) {
    const cells = splitRow(line)
    if (!cells) continue
    const first = stripFootnote(cells[0])
    if (first !== '模型版本' && first.toUpperCase() !== 'MODEL VERSION') continue
    const versions = cells
      .slice(1)
      .map((cell) => stripFootnote(cell))
      .filter((cell) => cell && !/^(模型|MODEL)\b/i.test(cell))
    if (versions.length >= 2) names = versions.slice(-2)
    break
  }

  const raw = new Map()
  let seenRows = 0
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const cells = splitRow(lines[index])
    if (!cells || cells.length < 3) continue
    const label = stripFootnote(cells[0])
    if (!/^(价格|PRICING)$/i.test(label)) continue
    const text = cells.join(' | ')
    const dimension = detectDimension(text)
    const period = detectPeriod(text)
    if (!dimension || !period) continue
    const monies = cells.map(parseMoneyCell).filter(Boolean)
    if (monies.length < 2) {
      throw new PricingParseError(`价格行缺少两个模型的金额：${lines[index].trim()}`)
    }
    const [firstMoney, secondMoney] = monies.slice(-2)
    validateMoney(firstMoney, currency)
    validateMoney(secondMoney, currency)
    seenRows += 1

    for (const [position, modelId] of modelIds.entries()) {
      const money = position === 0 ? firstMoney : secondMoney
      let entry = raw.get(modelId)
      if (!entry) {
        entry = { peak: {}, offPeak: {} }
        raw.set(modelId, entry)
      }
      entry[period][dimension] = money.value
    }
  }
  if (seenRows < 6) {
    throw new PricingParseError(`价格行不足（期望 6 行，实际 ${seenRows} 行）`)
  }

  const models = modelIds.map((id, index) => {
    const entry = raw.get(id)
    if (!entry) throw new PricingParseError(`缺少模型 ${id} 的价格行`)
    const peak = {}
    const offPeak = {}
    for (const dimension of PRICE_DIMENSIONS) {
      const peakValue = entry.peak[dimension]
      const offPeakValue = entry.offPeak[dimension]
      if (!Number.isFinite(peakValue) || !Number.isFinite(offPeakValue)) {
        throw new PricingParseError(`模型 ${id} 缺少 ${dimension} 的高峰或空闲价格`)
      }
      if (peakValue <= 0 || offPeakValue <= 0) {
        throw new PricingParseError(`模型 ${id} 的 ${dimension} 价格必须大于 0`)
      }
      if (Math.abs(peakValue - offPeakValue * 2) > peakValue * 0.01 + 1e-9) {
        throw new PricingParseError(`模型 ${id} 的 ${dimension} 高峰价不是空闲价的 2 倍`)
      }
      peak[dimension] = peakValue
      offPeak[dimension] = offPeakValue
    }
    return { id, name: names[index] || id, peak, offPeak }
  })

  let searchFetch = null
  for (const line of lines) {
    const cells = splitRow(line)
    if (!cells) continue
    if (stripFootnote(cells[0]).toLowerCase() !== 'search') continue
    const money = cells.map(parseMoneyCell).filter(Boolean).pop()
    if (money) searchFetch = money.value
    break
  }

  let scheduleNote = null
  let fallbackLine = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('|')) continue
    if (/空闲时段价格|off-peak rates/i.test(trimmed)) {
      const text = trimmed.replace(/\*\*/g, '')
      scheduleNote = { text, known: hasKnownSchedule(text) }
      break
    }
    if (!fallbackLine && /高峰时段|peak hours/i.test(trimmed) && /\d{1,2}:\d{2}/.test(trimmed)) {
      fallbackLine = trimmed
    }
  }
  if (!scheduleNote && fallbackLine) {
    scheduleNote = { text: fallbackLine.replace(/\*\*/g, ''), known: hasKnownSchedule(fallbackLine) }
  }

  return { currency, models, searchFetch, scheduleNote }
}

function hasKnownSchedule(text) {
  const knownZh = /9:00/.test(text) && /14:00/.test(text) && /18:00/.test(text)
  const knownEn = /01:00/.test(text) && /06:00/.test(text) && /10:00/.test(text)
  return knownZh || knownEn
}
