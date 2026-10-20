import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { PlayerNameForm } from '../src/player.ts'
import { CurrentRun, Leaderboard } from '../src/leaderboard.ts'

// Minimal DOM adapter for async component behavior. Real rendering and native
// form interactions are verified separately in the browser.
class TestElement extends EventTarget {
  tagName: string
  children: (TestElement | string)[] = []
  parent: TestElement | null = null
  dataset: Record<string, string> = {}
  hidden = false
  disabled = false
  value = ''
  textContent = ''
  className = ''
  attributes = new Map<string, string>()
  constructor(tagName: string) { super(); this.tagName = tagName }
  append(...children: (TestElement | string)[]) {
    for (const child of children) { if (child instanceof TestElement) { child.remove(); child.parent = this }; this.children.push(child) }
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null }
  replaceChildren(...children: (TestElement | string)[]) { for (const child of this.children) if (child instanceof TestElement) child.parent = null; this.children = []; this.append(...children) }
  setAttribute(key: string, value: string) { this.attributes.set(key, value) }
  querySelector(tag: string): TestElement | null { return descendants(this).find(child => child.tagName === tag) ?? null }
  focus() {}
}
function descendants(root: TestElement): TestElement[] {
  return root.children.flatMap(child => child instanceof TestElement ? [child, ...descendants(child)] : [])
}
function dom() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => new TestElement(tag) } })
  return () => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document') }
}
const profile = { username: 'NightDriver', tag: '1001', changedAt: 1, needsRename: false }

test('an explicit unchanged Save renews the cookie while submission keeps its fast path', async () => {
  const restore = dom()
  try {
    const calls: object[] = []
    const form = new PlayerNameForm(async body => { if (body) calls.push(body); return { profile } })
    await form.show(new AbortController().signal)
    await form.ensure()
    assert.equal(calls.length, 0)
    const root = form.root as unknown as TestElement
    root.dispatchEvent(new Event('submit', { cancelable: true }))
    await setImmediate()
    assert.deepEqual(calls, [{ action: 'claim', username: 'NightDriver' }])
    assert.ok(descendants(root).some(child => child.textContent === 'Playing as NightDriver#1001'))
  } finally { restore() }
})

test('failed and invalid profile loads remain retryable without replacing a newer result', async () => {
  const restore = dom()
  try {
    let attempt = 0
    const form = new PlayerNameForm(async () => { attempt++; if (attempt === 1) throw Error('temporary outage'); if (attempt === 2) return { profile: { invalid: true } }; return { profile } })
    await form.show(new AbortController().signal)
    assert.equal(form.active, true)
    assert.equal(form.needsLoad, true)
    await form.show(new AbortController().signal)
    assert.equal(form.needsLoad, true)
    await form.show(new AbortController().signal)
    assert.equal(form.needsLoad, false)
    const root = form.root as unknown as TestElement
    assert.equal(root.querySelector('input')?.value, 'NightDriver')
    let resolveOld!: (data: Record<string, unknown>) => void
    let reads = 0
    const raced = new PlayerNameForm(() => ++reads === 1 ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ profile }))
    const old = raced.show(new AbortController().signal)
    await raced.show(new AbortController().signal)
    resolveOld({ profile: { ...profile, username: 'OldDriver' } })
    await old
    assert.equal((raced.root as unknown as TestElement).querySelector('input')?.value, 'NightDriver')
  } finally { restore() }
})

test('Refresh leaderboard reloads the profile after the player API recovers', async () => {
  const restore = dom()
  const originalFetch = globalThis.fetch
  let reads = 0
  globalThis.fetch = async () => ++reads === 1 ? Response.json({ error: 'names_unavailable' }, { status: 503 }) : Response.json({ profile })
  try {
    const host = new TestElement('div')
    const board = new Leaderboard(async () => ({ ruleset: 'roadster-v1', usernamesEnabled: true, entries: [] }))
    const run = new CurrentRun(true, async () => ({ ticket: '11111111-1111-4111-8111-111111111111.1.roadster-v1.signature' }))
    run.finish(1, 1, 1)
    board.show(host as unknown as HTMLElement, run)
    await setImmediate()
    assert.equal(reads, 1)
    assert.equal(host.querySelector('input')?.value, '')
    const refresh = descendants(host).find(child => child.textContent === 'Refresh leaderboard')!
    refresh.dispatchEvent(new Event('click'))
    await setImmediate()
    assert.equal(reads, 2)
    assert.equal(host.querySelector('input')?.value, 'NightDriver')
    board.hide()
  } finally { globalThis.fetch = originalFetch; restore() }
})
