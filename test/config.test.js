import test from 'node:test'
import assert from 'node:assert/strict'

import { findOwnEntry, sanitizeConfigPatch as hostPatch } from '../src/options.js'

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

test('the browser copy of the patch rule matches the Host copy', () => {
  const cases = [
    undefined,
    null,
    {},
    { tool: true },
    { tool: 'yes' },
    { holidayRefresh: false },
    { refreshMinutes: 0 },
    { refreshMinutes: -5 },
    { refreshMinutes: 45.6 },
    { refreshMinutes: 9999 },
    { refreshMinutes: 'abc' },
    { refreshMinutes: null },
    { currency: 'USD', tool: false },
    { tool: true, holidayRefresh: true, refreshMinutes: 360, currency: 'USD', extra: 1 },
  ]
  for (const value of cases) {
    assert.deepEqual(
      client.sanitizeConfigPatch(value),
      hostPatch(value),
      `drifted for ${JSON.stringify(value)}`,
    )
  }
})

test('only booleans and a bounded interval are writable', () => {
  assert.deepEqual(hostPatch({ tool: 1, holidayRefresh: 'no', refreshMinutes: 30 }), {
    refreshMinutes: 30,
  })
  assert.deepEqual(hostPatch({ tool: true, holidayRefresh: false }), {
    tool: true,
    holidayRefresh: false,
  })
  assert.deepEqual(hostPatch({ refreshMinutes: 100000 }), { refreshMinutes: 1440 })
  assert.deepEqual(hostPatch({ refreshMinutes: -1 }), { refreshMinutes: 0 })
  assert.deepEqual(hostPatch({ refreshMinutes: 12.5 }), { refreshMinutes: 13 })
  assert.deepEqual(hostPatch({ currency: 'USD' }), {})
})

test('the row entry is found across the shapes Loader versions expose', () => {
  const ours = { patchId: 'deepseek-pricing' }
  const byId = { id: 'deepseek-pricing' }
  const byOptionId = { options: { id: 'deepseek-pricing' } }
  const byPackage = { options: { name: 'dsh-deepseek-pricing' } }
  const other = { patchId: 'dshmarket', options: { name: 'dshmarket' } }
  const editor = (entries) => ({ entries: () => entries })

  assert.equal(findOwnEntry(editor([other, ours])), ours)
  assert.equal(findOwnEntry(editor([byId])), byId)
  assert.equal(findOwnEntry(editor([byOptionId])), byOptionId)
  assert.equal(findOwnEntry(editor([other, byPackage])), byPackage)
  assert.equal(findOwnEntry(editor([other])), null)
  assert.equal(findOwnEntry(editor([])), null)
  assert.equal(findOwnEntry(null), null)
})

test('the detail-page section only claims this plugin', () => {
  const own = [
    { kind: 'bundle', pkg: { name: 'dsh-deepseek-pricing' } },
    { pkg: { name: 'dsh-deepseek-pricing' }, kind: 'row' },
    { entry: { id: 'deepseek-pricing' } },
    { entry: { name: 'dsh-deepseek-pricing' } },
    { id: 'deepseek-pricing' },
    { patchId: 'deepseek-pricing' },
    { pkgName: 'dsh-deepseek-pricing' },
  ]
  const foreign = [
    undefined,
    null,
    {},
    { kind: 'bundle', pkg: { name: 'dshmarket' } },
    { entry: { id: 'something-else' } },
    { name: 'dsh-local-cot-translation' },
  ]
  for (const subject of own) {
    assert.equal(client.isOwnPluginSubject(subject), true, `missed ${JSON.stringify(subject)}`)
  }
  for (const subject of foreign) {
    assert.equal(client.isOwnPluginSubject(subject), false, `claimed ${JSON.stringify(subject)}`)
  }
})