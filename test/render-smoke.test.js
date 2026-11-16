import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Render smoke test: runs the real slot components against a tiny React
 * stand-in instead of a DOM. It catches render-time crashes (undefined state,
 * wrong prop shapes, hook order) without needing jsdom, and it pins the four
 * seats this plugin claims.
 */

const captured = { definition: null }
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured.definition = definition
    },
  },
}
globalThis.document = {
  createElement: () => ({
    setAttribute() {},
    appendChild() {},
    removeChild() {},
    textContent: '',
  }),
  head: { appendChild() {} },
}

await import('../client.js')

function reactStub() {
  return {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props || {}), children: children.flat() },
    }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value === undefined ? null : value }),
    useCallback: (fn) => fn,
  }
}

/** Resolve function components down to host nodes so assertions see real props. */
function resolve(node, depth = 0) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (Array.isArray(node)) return node.map((child) => resolve(child, depth + 1))
  if (typeof node !== 'object') return node
  assert.ok(depth < 80, 'component tree recursed too deep')
  if (typeof node.type === 'function') return resolve(node.type(node.props), depth + 1)
  const props = node.props || {}
  return {
    type: node.type,
    props,
    children: (props.children || []).map((child) => resolve(child, depth + 1)),
  }
}

function flatten(node, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node !== 'object') {
    out.push(String(node))
    return out
  }
  for (const child of node.children) flatten(child, out)
  return out
}

function mountClient() {
  const client = captured.definition.factory(() => reactStub())
  const t = (key) => key
  const seats = new Map()
  const ctx = {
    effect: (fn) => {
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name, fn) => {
        fn()
        return () => {}
      },
      register: (definition, component) => {
        const list = seats.get(definition.name) || []
        list.push({ definition, component })
        seats.set(definition.name, list)
        return () => {}
      },
    },
  }
  client.apply(ctx)
  return { client, seats, t }
}

test('every seat is claimed with a stable id', () => {
  const { seats } = mountClient()
  assert.deepEqual(
    [...seats.keys()].sort(),
    [
      'conversation.chat.turnTail',
      'conversation.input.left',
      'plugins.detail.section',
      'settings.section',
    ],
  )
  const detailIds = seats.get('plugins.detail.section').map((seat) => seat.definition.id)
  assert.deepEqual(detailIds, ['deepseek-pricing-switches', 'deepseek-pricing-uninstall'])
  assert.equal(seats.get('settings.section')[0].definition.id, 'deepseek-pricing')
  const total = [...seats.values()].reduce((sum, list) => sum + list.length, 0)
  assert.equal(total, 5)
})

test('the settings page renders its feature switches with no data yet', () => {
  const { seats, t } = mountClient()
  const tree = resolve(seats.get('settings.section')[0].component({ t }))
  const text = flatten(tree).join(' | ')
  assert.match(text, /featTitle/)
  assert.match(text, /featCost/)
  assert.match(text, /featTool/)
  assert.match(text, /featHoliday/)
  assert.match(text, /featRefresh/)
  assert.match(text, /costMappingHint/)
  assert.match(text, /costMappingSection/)
  assert.match(text, /numberSection/)
  assert.match(text, /numberPreview/)

  // One card for the cost settings, sitting right after the feature switches,
  // and the switches themselves after the reference cards.
  const at = (needle) => text.indexOf(needle)
  assert.ok(at('priceTitle') < at('featTitle'), 'feature switches follow the price table')
  assert.ok(at('featTitle') < at('costTitle'), 'cost card follows the feature switches')
  assert.ok(at('costMappingSection') < at('numberSection'), 'mapping comes before the format')
  // No /state yet: the Host switches must render unchecked and disabled
  // instead of throwing on `config.tool`.
  const toolInput = findCheckbox(tree, 'dp-opt-tool')
  assert.equal(toolInput.props.checked, false)
  assert.equal(toolInput.props.disabled, true)
})

test('the plugin page card only answers for this plugin', () => {
  const { seats, t } = mountClient()
  const component = seats.get('plugins.detail.section')[0].component
  assert.equal(resolve(component({ t, subject: { pkg: { name: 'dshmarket' } } })), null)
  assert.equal(resolve(component({ t, subject: undefined })), null)

  const own = resolve(component({ t, subject: { pkg: { name: 'dsh-deepseek-pricing' } } }))
  const text = flatten(own).join(' | ')
  assert.match(text, /detailTitle/)
  assert.match(text, /featCost/)
  assert.match(text, /featTool/)
})

test('the plugin page carries optional uninstall notes', () => {
  const { seats, t } = mountClient()
  const component = seats
    .get('plugins.detail.section')
    .find((seat) => seat.definition.id === 'deepseek-pricing-uninstall').component

  assert.equal(resolve(component({ t, subject: { pkg: { name: 'dshmarket' } } })), null)

  const own = resolve(component({ t, subject: { pkg: { name: 'dsh-deepseek-pricing' } } }))
  const text = flatten(own).join(' | ')
  assert.match(text, /uninstallTitle/)
  // Every leftover must name the concrete action, and state that skipping it is fine.
  for (const key of [
    'uninstallIntro',
    'uninstallLocal',
    'uninstallLocalAction',
    'uninstallRow',
    'uninstallRowAction',
    'uninstallPnpm',
    'uninstallPnpmAction',
    'uninstallCache',
    'uninstallCacheAction',
  ]) {
    assert.match(text, new RegExp(key))
  }
})

test('the composer chip and turn cost seats render without a session', () => {
  const { seats, t } = mountClient()
  assert.doesNotThrow(() => resolve(seats.get('conversation.input.left')[0].component({ t })))
  const emptyChat = (selector) => selector({ legacy: { turnEnds: [] }, nodes: {} })
  assert.doesNotThrow(() =>
    resolve(
      seats.get('conversation.chat.turnTail')[0].component({
        t,
        turn: { turn: 1 },
        seq: 1,
        useChat: emptyChat,
      }),
    ),
  )
})

function findCheckbox(node, id) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findCheckbox(child, id)
      if (found) return found
    }
    return null
  }
  if (node.type === 'input' && node.props.id === id) return node
  return findCheckbox(node.children, id)
}