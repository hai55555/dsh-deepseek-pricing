import test from 'node:test'
import assert from 'node:assert/strict'

const captured = { definition: null }
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured.definition = definition
    },
  },
}

await import('../client.js')

const ReactStub = {
  createElement: () => null,
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
}

const clientModule = captured.definition.factory(() => ReactStub)
const cost = clientModule.__test

function priceState(overrides = {}) {
  return {
    ok: true,
    prices: {
      currency: 'CNY',
      fetchedAtMs: Date.parse('2026-11-12T01:00:00Z'),
      stale: false,
      models: [
        {
          id: 'deepseek-flash',
          peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
          offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
        },
        {
          id: 'deepseek-v4-pro',
          peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
          offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
        },
      ],
      ...overrides.prices,
    },
    holidays: { dates: {}, ...overrides.holidays },
  }
}

function usageTail(overrides = {}) {
  return {
    time: overrides.time ?? Date.parse('2026-11-12T13:00:00Z'),
    tokenUsage: {
      uncachedInputTokens: 523226,
      cacheReadTokens: 2110336,
      outputTokens: 4336,
      totalTokens: 2637898,
      routes: [{ provider: 'deepseek-account', model: 'deepseek-flash' }],
      ...overrides.tokenUsage,
    },
  }
}

const NO_PREFS = { enabled: true, mappings: [] }

test('detects the price model from a route', () => {
  assert.equal(cost.detectPriceModel('deepseek-account/deepseek-flash'), 'deepseek-flash')
  assert.equal(cost.detectPriceModel('deepseek-v4-pro'), 'deepseek-v4-pro')
  assert.equal(cost.detectPriceModel('deepseek-account/unknown'), null)
  assert.equal(cost.detectPriceModel(''), null)
})

test('groups 万分 digits from the decimal point (explicit 4/┊ format)', () => {
  assert.equal(cost.groupInteger('12345', 4, '┊'), '1┊2345')
  assert.equal(cost.groupInteger('12345678', 4, '┊'), '1234┊5678')
  assert.equal(cost.groupFraction('5825234', 4, '┊'), '5825┊234')
  assert.equal(cost.groupFraction('582', 4, '┊'), '582')
})

const DASH4 = { groupSize: 4, separator: 'dash', decimals: 3, tiny: 'ellipsis' }

test('formats money with three decimals and with full precision', () => {
  assert.equal(cost.formatChipCost(582776720000, DASH4).text, '0.583')
  assert.equal(cost.formatExactCost(582776720000, DASH4), '0.5827┊7672')
  assert.equal(cost.formatChipCost(1220000000000, DASH4).text, '1.220')
  assert.equal(cost.formatExactCost(1220000000000, DASH4), '1.22')
  assert.equal(cost.formatChipCost(1000000000000, DASH4).text, '1.000')
  assert.equal(cost.formatExactCost(1000000000000, DASH4), '1')
  assert.equal(cost.formatExactCost(12345678901234, DASH4), '12.3456┊7890┊1234')
})

test('the default format is three-digit grouping with spaces', () => {
  assert.deepEqual(cost.FORMAT_DEFAULT, { groupSize: 3, separator: 'space', decimals: 3, tiny: 'ellipsis' })
  assert.equal(cost.formatChipCost(1234567890000000, cost.FORMAT_DEFAULT).text, '1 234.568')
  assert.equal(cost.formatExactCost(12345678901234, cost.FORMAT_DEFAULT), '12.345 678 901 234')
})

test('classifies peak, off-peak, weekends and holidays in Beijing time', () => {
  assert.equal(cost.classifyPeakAt(Date.parse('2026-11-04T01:00:00Z')).period, 'peak')
  assert.equal(cost.classifyPeakAt(Date.parse('2026-11-04T10:00:00Z')).period, 'off-peak')
  assert.equal(cost.classifyPeakAt(Date.parse('2026-11-07T02:00:00Z')).period, 'off-peak')
  const holiday = cost.classifyPeakAt(Date.parse('2026-10-01T02:00:00Z'), {
    '2026-10-01': { name: '国庆节' },
  })
  assert.equal(holiday.period, 'off-peak')
  assert.equal(holiday.holidayName, '国庆节')
})

test('prices a turn with the off-peak rate at its end time', () => {
  const result = cost.computeTurnCost(usageTail(), priceState(), NO_PREFS)
  assert.equal(result.period, 'off-peak')
  assert.equal(result.modelId, 'deepseek-flash')
  assert.equal(result.units, 582776720000)
  assert.equal(result.currency, 'CNY')
})

test('prices a turn with the peak rate', () => {
  const result = cost.computeTurnCost(
    usageTail({ time: Date.parse('2026-11-04T01:16:00Z') }),
    priceState(),
    NO_PREFS,
  )
  assert.equal(result.period, 'peak')
  assert.equal(result.units, 1165553440000)
})

test('uses the holiday calendar to price old turns', () => {
  const result = cost.computeTurnCost(
    usageTail({ time: Date.parse('2026-10-01T02:00:00Z') }),
    priceState({ holidays: { dates: { '2026-10-01': { name: '国庆节' } } } }),
    NO_PREFS,
  )
  assert.equal(result.period, 'off-peak')
  assert.equal(result.units, 582776720000)
})

test('reports incomplete or ambiguous usage', () => {
  assert.equal(cost.computeTurnCost(usageTail({ tokenUsage: { routes: [] } }), priceState(), NO_PREFS).unavailable, 'route')
  assert.equal(
    cost.computeTurnCost(
      usageTail({ tokenUsage: { routes: [{ provider: 'x', model: 'm' }], cacheReadTokens: undefined } }),
      priceState(),
      NO_PREFS,
    ).unavailable,
    'cacheRead',
  )
  const mixed = cost.computeTurnCost(
    usageTail({
      tokenUsage: {
        routes: [
          { provider: 'deepseek-account', model: 'deepseek-flash' },
          { provider: 'deepseek-account', model: 'deepseek-v4-pro' },
        ],
      },
    }),
    priceState(),
    NO_PREFS,
  )
  assert.equal(mixed.unavailable, 'mixedModel')
  assert.equal(cost.computeTurnCost(usageTail(), null, NO_PREFS).unavailable, 'prices')
})

test('honours a manual mapping and an ignore row', () => {
  const mapped = cost.computeTurnCost(
    usageTail({
      tokenUsage: { routes: [{ provider: 'acme', model: 'gateway-1' }] },
    }),
    priceState(),
    { enabled: true, mappings: [{ route: 'acme/gateway-1', model: 'flash' }] },
  )
  assert.equal(mapped.modelId, 'deepseek-flash')
  const ignored = cost.computeTurnCost(usageTail(), priceState(), {
    enabled: true,
    mappings: [{ route: 'deepseek-account/deepseek-flash', model: 'ignore' }],
  })
  assert.equal(ignored, null)
})

test('sanitizes stored preferences', () => {
  const sanitized = cost.sanitizeCostPrefs({
    enabled: true,
    mappings: [{ route: ' a/b ', model: 'flash' }, { route: 'x', model: 'bogus' }],
  })
  assert.equal(sanitized.enabled, true)
  assert.deepEqual(sanitized.mappings, [
    { route: 'a/b', model: 'flash' },
    { route: 'x', model: '' },
  ])
  assert.deepEqual(sanitized.format, cost.FORMAT_DEFAULT)
  assert.deepEqual(cost.sanitizeCostPrefs(null), {
    enabled: false,
    mappings: [],
    format: cost.FORMAT_DEFAULT,
  })
})
