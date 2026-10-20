import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RedisStore } from '../server/store.ts'
const exec = promisify(execFile)
// Explicit opt-in: disposable Unix-socket-only Redis, no persistence, no cloud.
test('real Lua: concurrent dedup, stable ties, trimming, bounded rate fields and rejected-client isolation', { skip: !process.env.REDIS_SERVER || !process.env.REDIS_CLI }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'roadster-redis-test-'))
  const socket = join(dir, 'redis.sock')
  const redis = spawn(process.env.REDIS_SERVER!, ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Local Redis startup timeout')), 5000)
      redis.once('error', reject)
      redis.stdout.on('data', data => { if (String(data).toLowerCase().includes('ready to accept connections')) { clearTimeout(timeout); resolve() } })
    })
    const command = async (args: (string|number)[]) => JSON.parse((await exec(process.env.REDIS_CLI!, ['-s', socket, '--json', ...args.map(String)])).stdout)
    const request: typeof fetch = async (_url, options) => Response.json({ result: await command(JSON.parse(options!.body as string)) })
    const store = new RedisStore('https://mock.invalid', 'not-a-real-token', 'test', request)
    const entry = { runId: randomUUID(), alias: 'Amber Otter', score: 1, distance: 1 }
    const added = await Promise.all(Array.from({ length: 40 }, () => store.submit(entry, 100, 101)))
    assert.equal(added.filter(Boolean).length, 1)
    const entries = Array.from({ length: 110 }, () => ({ ...entry, runId: randomUUID(), score: 2 }))
    await Promise.all(entries.map(e => store.submit(e, 100, 101)))
    assert.deepEqual((await store.list()).map(e => e.runId), entries.map(e => e.runId).sort().reverse().slice(0, 20))
    assert.equal(await store.submit({ ...entry, score: 99999 }, 100, 101), false)
    assert.equal(await command(['ZCARD', 'test:top']), 100)
    assert.equal(await command(['ZCARD', 'test:seen']), 111)
    for (let i = 0; i < 20; i++) assert.ok(await store.allow('capped', true, 1))
    const blocked = await Promise.all(Array.from({ length: 60 }, () => store.allow('capped', true, 1)))
    assert.ok(blocked.every(x => !x))
    assert.equal(await command(['HGET', 'test:rate:0', 'total']), '20')
    assert.ok(await store.allow('other-player', true, 1))
    await command(['HSET', 'test:rate:0', 'total', 5000])
    const fields = await command(['HLEN', 'test:rate:0'])
    assert.equal(await store.allow('new-player', false, 1), false)
    assert.equal(await command(['HLEN', 'test:rate:0']), fields)
    assert.ok(await command(['TTL', 'test:rate:0']) > 0)
    await command(['SET', 'test:daily:0', 2000])
    assert.equal(await store.allow('new-hour', true, 3600001), false)
  } finally {
    const exited = new Promise<void>(resolve => redis.once('exit', () => resolve()))
    redis.kill('SIGTERM')
    await exited
    await rm(dir, { recursive: true, force: true })
  }
})
