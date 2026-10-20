import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createHandler, aliasFor } from '../server/leaderboard.ts'
import api from '../api/leaderboard.ts'
import { RedisStore, GATE, SUBMIT } from '../server/store.ts'
import { MemoryStore } from './memory-store.ts'
import { isAlias, RULESET, TICKET_MS } from '../shared/leaderboard.ts'
import { CurrentRun } from '../src/leaderboard.ts'
const secret = 'test-only-secret-do-not-use-in-production'
const start = { action: 'start', ruleset: RULESET, debug: false, screenshot: false }
function setup() {
  const store = new MemoryStore()
  let time = 1800000000000
  const handler = createHandler(store, secret, () => time)
  const send = (body?: unknown, headers: Record<string,string> = {}) => handler(new Request('https://game.example/api/leaderboard', { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }))
  const run = async () => {
    const { ticket } = await (await send(start)).json()
    time += 1000
    return { action: 'submit', ticket, runId: ticket.split('.')[0], ruleset: RULESET, debug: false, screenshot: false, score: 650, distance: 50, durationMs: 1000 }
  }
  return { store, handler, send, run, advance: (ms: number) => { time += ms } }
}
test('server aliases use only the curated vocabulary; tampered names never reach storage', async () => {
  for (let i = 0; i < 500; i++) assert.ok(isAlias(aliasFor(randomUUID(), secret)))
  assert.equal(isAlias('nasty arbitrary text'), false)
  const s = setup(), run = await s.run()
  for (const field of ['alias', 'name', 'displayName']) assert.equal((await s.send({ ...run, [field]: 'tampered' })).status, 400)
  assert.equal(s.store.entries.size, 0)
  assert.equal((await s.send({ ...start, runId: run.runId })).status, 400)
  const result = await (await s.send(run)).json()
  assert.ok(isAlias(result.entry.alias))
})
test('strict numeric, body, ruleset and eligibility validation', async () => {
  const s = setup(), run = await s.run()
  for (const field of ['score', 'distance', 'durationMs']) {
    for (const value of [-1, 0.1, '1', null, NaN, Infinity, 1e15, {}, []]) assert.equal((await s.send({ ...run, [field]: value })).status, 400, `${field}: ${value}`)
  }
  for (const patch of [{ ruleset: 'old' }, { debug: true }, { screenshot: true }, { runId: randomUUID() }, { ticket: run.ticket + 'x' }, { durationMs: 500000 }, { distance: 10000 }]) assert.equal((await s.send({ ...run, ...patch })).status, 400)
  for (const patch of [{ debug: true }, { screenshot: true }, { alias: 'Amber Otter' }, { ruleset: 'old' }]) assert.equal((await s.send({ ...start, ...patch })).status, 400)
  for (const body of [null, [], 1, 'bad', {}]) assert.equal((await s.send(body)).status, 400)
  assert.equal((await s.send(run, { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await s.send(run, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await s.send(run, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal((await s.send({ text: 'x'.repeat(2048) })).status, 413)
  assert.equal((await s.handler(new Request('https://game.example/api/leaderboard', { method: 'DELETE' }))).status, 405)
  assert.equal((await s.handler(new Request('https://game.example/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).status, 400)
})
test('concurrent duplicate submissions are idempotent, ranked and trimmed with stable ties', async () => {
  const s = setup(), run = await s.run()
  const responses = await Promise.all(Array.from({ length: 30 }, () => s.send(run).then(r => r.json())))
  assert.equal(responses.filter(r => !r.duplicate).length, 1)
  assert.equal(s.store.entries.size, 1)
  const runs = await Promise.all(Array.from({ length: 105 }, () => s.run()))
  await Promise.all(runs.map((r, i) => s.send({ ...r, score: 1000 + i % 2 })))
  const entries = (await (await s.send()).json()).entries
  assert.equal(entries.length, 20)
  for (let i = 1; i < entries.length; i++) assert.ok(entries[i - 1].score > entries[i].score || entries[i - 1].runId > entries[i].runId)
  assert.ok(!entries.some((e: {runId: string}) => e.runId === run.runId))
  assert.equal((await (await s.send({ ...run, score: 999999 })).json()).duplicate, true)
  assert.equal(s.store.entries.size, 100)
  s.advance(TICKET_MS)
  assert.equal((await s.send(run)).status, 400)
})
test('disabled, unavailable and rate-limited backends fail closed', async () => {
  const s = setup()
  s.store.allowed = false
  assert.equal((await s.send()).status, 429)
  assert.equal((await createHandler(null, secret)(new Request('https://game.example'))).status, 503)
  assert.equal((await api.fetch(new Request('https://game.example'))).status, 503)
  s.store.allowed = true
  s.store.list = async () => { throw Error('secret storage detail') }
  const response = await s.send()
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes('secret'))
})
test('current-run snapshot is immutable, fresh and independent of local records', async () => {
  const requests: object[] = []
  const request = async (body?: object) => { requests.push(body!); return { ticket: `${randomUUID()}.1800000000000.${RULESET}.signature` } }
  const a = new CurrentRun(true, request), b = new CurrentRun(true, request)
  assert.notEqual(a.id, b.id)
  const result = a.finish(123.9, 45.6, 1000.8)!
  assert.ok(Object.isFrozen(result))
  assert.equal(a.finish(99999, 99999, 99999), result)
  assert.equal((await a.submission() as {score:number}).score, 123)
  assert.equal(requests.length, 2) // Only registration; submission is explicit.
  const debug = new CurrentRun(false, request)
  assert.equal(debug.finish(999999, 4000, 1), null)
  await assert.rejects(debug.submission())
  assert.equal(requests.length, 2)
  const offline = new CurrentRun(true, async () => { throw Error('offline') })
  offline.finish(100, 10, 1000)
  await assert.rejects(offline.submission(), /local record is safe/)
})
test('REST adapter sends atomic Lua and bounded reads; rejects storage failures', async () => {
  const calls: (string|number)[][] = []
  const entry = { runId: randomUUID(), alias: 'Amber Otter', score: 1, distance: 1 }
  const request: typeof fetch = async (_url, init) => {
    assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer test-token')
    assert.equal(init?.redirect, 'error')
    const args = JSON.parse(init!.body as string); calls.push(args)
    return Response.json({ result: args[0] === 'ZREVRANGE' ? [`${entry.runId}|${JSON.stringify(entry)}`] : 1 })
  }
  const store = new RedisStore('https://mock.invalid', 'test-token', 'test:v1', request)
  assert.ok(await store.allow('hashed', true, 1))
  assert.ok(await store.submit(entry, 1, 2))
  assert.deepEqual(await store.list(), [entry])
  assert.equal(calls[0]![1], GATE)
  assert.equal(calls[1]![1], SUBMIT)
  assert.deepEqual(calls[2], ['ZREVRANGE', 'test:v1:top', 0, 19])
  await assert.rejects(new RedisStore('https://mock.invalid', 'x', 'test', async () => Response.json({ error: 'nope' })).list())
  await assert.rejects(new RedisStore('https://mock.invalid', 'x', 'test', async () => new Response('', { status: 503 })).list())
})
