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
