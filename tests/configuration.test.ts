import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configuredHandler } from '../api/leaderboard.ts'

const activation = {
  LEADERBOARD_ENABLED: 'true',
  LEADERBOARD_SECRET: 'offline-test-signing-secret-at-least-32-characters',
  LEADERBOARD_PREFIX: 'test:configuration',
}
const upstash = { UPSTASH_REDIS_REST_URL: 'https://explicit.invalid', UPSTASH_REDIS_REST_TOKEN: 'explicit-test-token' }
const kv = { KV_REST_API_URL: 'https://legacy.invalid', KV_REST_API_TOKEN: 'legacy-test-token' }

test('configuration uses a complete KV pair and preserves explicit Upstash precedence', async () => {
  for (const [bindings, expectedUrl, expectedToken] of [
    [kv, kv.KV_REST_API_URL, kv.KV_REST_API_TOKEN],
    [upstash, upstash.UPSTASH_REDIS_REST_URL, upstash.UPSTASH_REDIS_REST_TOKEN],
    [{ ...kv, ...upstash }, upstash.UPSTASH_REDIS_REST_URL, upstash.UPSTASH_REDIS_REST_TOKEN],
  ] as const) {
    let calls = 0
    const request: typeof fetch = async (url, init) => {
      calls++
      assert.equal(url, expectedUrl)
      assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${expectedToken}`)
      const command = JSON.parse(init!.body as string)
      return Response.json({ result: command[0] === 'EVAL' ? 1 : [] })
    }
    const response = await configuredHandler({ ...activation, ...bindings }, request)(new Request('https://game.example/api/leaderboard'))
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).entries, [])
    assert.equal(calls, 2)
  }
})

test('incomplete, mixed, read-only and disabled configurations never contact storage', async () => {
  const bindings: NodeJS.ProcessEnv[] = [
    {}, { KV_REST_API_URL: kv.KV_REST_API_URL }, { KV_REST_API_TOKEN: kv.KV_REST_API_TOKEN },
    { UPSTASH_REDIS_REST_URL: upstash.UPSTASH_REDIS_REST_URL, KV_REST_API_TOKEN: kv.KV_REST_API_TOKEN },
    { UPSTASH_REDIS_REST_TOKEN: upstash.UPSTASH_REDIS_REST_TOKEN, KV_REST_API_URL: kv.KV_REST_API_URL },
    { ...kv, UPSTASH_REDIS_REST_URL: upstash.UPSTASH_REDIS_REST_URL },
    { ...kv, UPSTASH_REDIS_REST_TOKEN: upstash.UPSTASH_REDIS_REST_TOKEN },
    { ...kv, UPSTASH_REDIS_REST_URL: '' }, { ...kv, UPSTASH_REDIS_REST_TOKEN: '' },
    { KV_REST_API_URL: kv.KV_REST_API_URL, KV_REST_API_READ_ONLY_TOKEN: 'read-only-test-token' },
    { ...kv, LEADERBOARD_ENABLED: 'false' }, { ...kv, LEADERBOARD_SECRET: '' },
    { ...kv, LEADERBOARD_SECRET: 'too-short' }, { ...kv, LEADERBOARD_PREFIX: '' },
  ]
  for (const binding of bindings) {
    let calls = 0
    const request: typeof fetch = async () => { calls++; throw Error('unexpected storage access') }
    const response = await configuredHandler({ ...activation, ...binding }, request)(new Request('https://game.example/api/leaderboard'))
    assert.equal(response.status, 503)
    assert.equal(calls, 0)
  }
})

test('tickets cannot cross datastore prefixes even when the signing secret is shared', async () => {
  const submissions: string[] = []
  const request: typeof fetch = async (_url, init) => {
    const command = JSON.parse(init!.body as string)
    // Rate gates use two keys too; submissions carry the :top key.
    if (command[0] === 'EVAL' && String(command[3]).endsWith(':top')) submissions.push(command[3])
    return Response.json({ result: 1 })
  }
  const preview = configuredHandler({ ...activation, ...kv, LEADERBOARD_PREFIX: 'test:preview' }, request)
  const production = configuredHandler({ ...activation, ...kv, LEADERBOARD_PREFIX: 'test:production' }, request)
  const send = (handler: ReturnType<typeof configuredHandler>, body: object) => handler(new Request('https://game.example/api/leaderboard', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
  const start = { action: 'start', ruleset: 'roadster-v1', debug: false, screenshot: false }
  for (const [source, other, prefix] of [[preview, production, 'test:preview'], [production, preview, 'test:production']] as const) {
    const { ticket } = await (await send(source, start)).json()
    const body = { ...start, action: 'submit', ticket, runId: ticket.split('.')[0], score: 1, distance: 0, durationMs: 1 }
    const before = submissions.length
    assert.equal((await send(other, body)).status, 400)
    assert.equal(submissions.length, before)
    assert.equal((await send(source, body)).status, 200)
    assert.equal(submissions.at(-1), `${prefix}:top`)
  }
})

test('name mode requires a separate identity secret and player API remains disabled otherwise', async () => {
  const { configuredPlayerHandler } = await import('../api/player.ts')
  let calls = 0
  const request: typeof fetch = async (_url, init) => {
    calls++
    const command = JSON.parse(init!.body as string)
    return Response.json({ result: command[0] === 'EVAL' ? 1 : [] })
  }
  const base = { ...activation, ...kv }
  assert.equal((await configuredPlayerHandler(base, request)(new Request('https://game.example/api/player'))).status, 503)
  assert.equal((await configuredHandler({ ...base, PLAYER_NAMES_ENABLED: 'true' }, request)(new Request('https://game.example/api/leaderboard'))).status, 503)
  assert.equal(calls, 0)
  const env = { ...base, PLAYER_NAMES_ENABLED: 'true', PLAYER_ID_SECRET: 'test-only-player-identity-secret-32-characters' }
  const response = await configuredHandler(env, request)(new Request('https://game.example/api/leaderboard'))
  assert.equal((await response.json()).usernamesEnabled, true)
  const player = await configuredPlayerHandler(env, request)(new Request('https://game.example/api/player'))
  assert.equal(player.status, 200)
  assert.deepEqual(await player.json(), { profile: null })
})

test('disabled name mode never resolves saved name profiles from Redis', async () => {
  const calls: string[] = []
  const entry = { runId: '11111111-1111-4111-8111-111111111111', alias: 'SavedName#1001', playerId: 'a'.repeat(64), score: 10, distance: 1 }
  const request: typeof fetch = async (_url, init) => {
    const command = JSON.parse(init!.body as string)
    calls.push(command[0])
    if (command[0] === 'EVAL') return Response.json({ result: 1 })
    if (command[0] === 'ZREVRANGE') return Response.json({ result: [`${entry.runId}|${JSON.stringify(entry)}`] })
    throw new Error('Unexpected profile resolution')
  }
  const response = await configuredHandler({ ...activation, ...kv, PLAYER_NAMES_ENABLED: 'false' }, request)(new Request('https://game.example/api/leaderboard'))
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.ok(!body.includes('SavedName'))
  assert.ok(!body.includes(entry.playerId))
  assert.deepEqual(calls, ['EVAL', 'ZREVRANGE'])
})
