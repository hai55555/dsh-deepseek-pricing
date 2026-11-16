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

const client = captured.definition.factory(() => ReactStub).__test
const { formatChipCost, formatExactCost, groupInteger, groupFraction, sanitizeFormat } = client

const fmt = (patch = {}) => ({ ...client.FORMAT_DEFAULT, ...patch })

const SEPARATORS = [
  ['space', ' '],
  ['comma', ','],
  ['bar', '|'],
  ['dash', '┊'],
  ['none', ''],
]

test('groups integer and fraction digits for every separator and size', () => {
  for (const [id, char] of SEPARATORS) {
    const size3 = id === 'none' ? '1234567' : `1${char}234${char}567`
    const size4 = id === 'none' ? '1234567' : `123${char}4567`
    assert.equal(groupInteger('1234567', 3, char), size3, `${id}/3 integer`)
    assert.equal(groupInteger('1234567', 4, char), size4, `${id}/4 integer`)
    // The fraction groups inward from the decimal point.
    assert.equal(groupFraction('58277672', 4, char), id === 'none' ? '58277672' : `5827${char}7672`)
    assert.equal(groupFraction('582776720', 4, char), id === 'none' ? '582776720' : `5827${char}7672${char}0`)
    // A single full group never gains a trailing separator.
    assert.equal(groupFraction('5827', 4, char), '5827', `${id}/4 single group`)
    assert.equal(groupInteger('123', 3, char), '123', `${id}/3 short`)
  }
})

test('the chip shows exactly the configured number of decimals', () => {
  const value = 582776720000 // 0.58277672
  assert.equal(formatChipCost(value, fmt()).text, '0.583')
  assert.equal(formatChipCost(value, fmt({ decimals: 1 })).text, '0.6')
  assert.equal(formatChipCost(value, fmt({ decimals: 8 })).text, '0.582 776 72')
  // Trailing zeros are kept: fixed precision, not "up to".
  assert.equal(formatChipCost(1220000000000, fmt()).text, '1.220')
  assert.equal(formatChipCost(1220000000000, fmt({ decimals: 1 })).text, '1.2')
  assert.equal(formatChipCost(1000000000000, fmt({ decimals: 8 })).text, '1.000 000 00')
})

test('rounding carries into the integer part', () => {
  // 0.999999999999 at three decimals rounds to 1.000, not 0.1000.
  assert.equal(formatChipCost(999999999999, fmt()).text, '1.000')
  // 9007.199254740991 is the largest cost representable in a safe integer.
  assert.equal(formatChipCost(9007199254740991, fmt()).text, '9 007.199')
})

test('the chosen separator and grouping apply to the chip and the fraction', () => {
  const big = 1234567890123456 // 1234.567890123456
  assert.equal(formatChipCost(big, fmt({ separator: 'comma' })).text, '1,234.568')
  assert.equal(formatChipCost(big, fmt({ separator: 'none' })).text, '1234.568')
  // Fraction grouping only shows up once there are more fraction digits than
  // one group holds.
  assert.equal(
    formatChipCost(12345678901234, fmt({ decimals: 8 })).text,
    '12.345 678 90',
  )
  assert.equal(
    formatChipCost(12345678901234, fmt({ decimals: 8, groupSize: 4, separator: 'dash' })).text,
    '12.3456┊7890',
  )
})

test('tiny amounts follow the selected mode', () => {
  const tiny = 400000 // 0.0000004
  assert.deepEqual(formatChipCost(tiny, fmt()), { text: '0.000', marker: 'ellipsis' })
  assert.deepEqual(formatChipCost(tiny, fmt({ tiny: 'less' })), { text: '0.001', marker: 'less' })
  assert.deepEqual(formatChipCost(tiny, fmt({ tiny: 'less', decimals: 5 })), {
    text: '0.00001',
    marker: 'less',
  })
  // Exactly zero is not "tiny": no marker, no ellipsis.
  assert.deepEqual(formatChipCost(0, fmt()), { text: '0.000', marker: null })
  assert.deepEqual(formatChipCost(0, fmt({ tiny: 'less' })), { text: '0.000', marker: null })
})

test('the tooltip keeps full precision but follows the separator', () => {
  assert.equal(formatExactCost(582776720000, fmt()), '0.582 776 72')
  assert.equal(formatExactCost(582776720000, fmt({ separator: 'dash', groupSize: 4 })), '0.5827┊7672')
  assert.equal(formatExactCost(12345678901234, fmt()), '12.345 678 901 234')
  assert.equal(formatExactCost(1220000000000, fmt()), '1.22')
  assert.equal(formatExactCost(1000000000000, fmt()), '1')
  assert.equal(formatExactCost(0, fmt()), '0')
})

test('stored formats are sanitized and defaulted field by field', () => {
  assert.deepEqual(sanitizeFormat(undefined), client.FORMAT_DEFAULT)
  assert.deepEqual(sanitizeFormat({ groupSize: 3, separator: 'space', decimals: 3, tiny: 'ellipsis' }), {
    groupSize: 3,
    separator: 'space',
    decimals: 3,
    tiny: 'ellipsis',
  })
  assert.deepEqual(sanitizeFormat({ groupSize: 4, separator: 'dash', decimals: 8, tiny: 'less' }), {
    groupSize: 4,
    separator: 'dash',
    decimals: 8,
    tiny: 'less',
  })
  const junk = sanitizeFormat({ groupSize: 5, separator: 'tab', decimals: 0, tiny: 'hide' })
  assert.deepEqual(junk, client.FORMAT_DEFAULT)
  assert.equal(sanitizeFormat({ decimals: 9 }).decimals, 3)
  assert.equal(sanitizeFormat({ decimals: 1.5 }).decimals, 3)
})

test('cost preferences migrate from the pre-format shape', () => {
  const old = client.sanitizeCostPrefs({ enabled: true, mappings: [{ route: 'a/b', model: 'pro' }] })
  assert.equal(old.enabled, true)
  assert.equal(old.mappings.length, 1)
  assert.deepEqual(old.format, client.FORMAT_DEFAULT)
  assert.deepEqual(client.sanitizeCostPrefs(null).format, client.FORMAT_DEFAULT)
  const custom = client.sanitizeCostPrefs({
    enabled: false,
    mappings: [],
    format: { separator: 'comma', decimals: 2, groupSize: 4, tiny: 'less' },
  })
  assert.deepEqual(custom.format, { groupSize: 4, separator: 'comma', decimals: 2, tiny: 'less' })
})