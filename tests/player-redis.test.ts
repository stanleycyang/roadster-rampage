import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RedisPlayerStore } from '../server/player-store.ts'
import { displayName, RENAME_COOLDOWN_MS } from '../shared/player.ts'
const exec = promisify(execFile)

test('Redis atomically protects claims, renames, moderation and named score writes', { skip: !process.env.REDIS_SERVER || !process.env.REDIS_CLI }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'roadster-names-'))
  const socket = join(dir, 'redis.sock')
  const redis = spawn(process.env.REDIS_SERVER!, ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Redis startup timeout')), 5000)
      redis.once('error', reject)
      redis.stdout.on('data', data => { if (String(data).toLowerCase().includes('ready to accept connections')) { clearTimeout(timeout); resolve() } })
    })
    const command = async (args: (string|number)[]) => JSON.parse((await exec(process.env.REDIS_CLI!, ['-s', socket, '--json', ...args.map(String)])).stdout)
    const request: typeof fetch = async (_url, options) => Response.json({ result: await command(JSON.parse(options!.body as string)) })
    const store = new RedisPlayerStore('https://mock.invalid', 'offline-only', 'test', request)
    const ids = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(64, '0'))
    const claims = await Promise.all(ids.map((id, i) => store.claim(id, i % 2 ? 'NightDriver' : 'nightdriver', 100)))
    assert.equal(claims.filter(result => result === 'claimed').length, 20)
    const tags = await Promise.all(ids.map(async id => (await store.profile(id))!.tag))
    assert.equal(new Set(tags).size, 20)
    const winner = ids[claims.indexOf('claimed')]!
    const profile = (await store.profile(winner))!
    assert.equal(await store.claim(winner, profile.username!, 200), 'claimed')
    assert.equal(await store.claim(winner, 'NewDriver', 200), 'cooldown')
    assert.equal(await store.claim(winner, 'NewDriver', RENAME_COOLDOWN_MS + 101), 'claimed')
    assert.equal(await store.claim(ids.find(id => id !== winner)!, 'NIGHTDRIVER', RENAME_COOLDOWN_MS + 102), 'claimed')
    const entry = { runId: randomUUID(), alias: displayName((await store.profile(winner))!), playerId: winner, score: 50, distance: 1 }
    assert.ok(await store.submit(entry, 100, 200))
    assert.equal((await store.list())[0]?.alias, entry.alias)
    const reporter = ids.find(id => id !== winner)!
    assert.ok(await store.report(reporter, winner, 'profanity', RENAME_COOLDOWN_MS + 200))
    assert.ok(await store.report(reporter, winner, 'hate', RENAME_COOLDOWN_MS + 201))
    assert.equal((await store.reports()).length, 1)
    assert.equal(await store.report(winner, winner, 'hate', RENAME_COOLDOWN_MS + 201), false)
    assert.equal(await store.claim(reporter, 'NewDriver', 2 * RENAME_COOLDOWN_MS + 500), 'claimed')
    assert.ok(await store.moderate(winner))
    assert.equal((await store.profile(reporter))?.needsRename, true)
    assert.equal(await store.claim(reporter, 'OtherSafeDriver', 2 * RENAME_COOLDOWN_MS + 501), 'claimed')
    assert.equal((await store.list())[0]?.alias, 'Name removed')
    await assert.rejects(store.submit({ ...entry, runId: randomUUID() }, 200, 201))
    assert.equal(await store.claim(winner, 'NewDriver', RENAME_COOLDOWN_MS + 300), 'blocked')
    assert.equal(await store.claim(winner, 'SafeDriver', RENAME_COOLDOWN_MS + 300), 'claimed')
    assert.equal((await store.list())[0]?.alias, `SafeDriver#${profile.tag}`)
    assert.equal((await store.profile(winner))!.tag, profile.tag)
    assert.ok(await store.submit({ ...entry, runId: randomUUID(), alias: `SafeDriver#${profile.tag}` }, 200, 201))
    // Retrying the original run cannot replace its score or consume another slot.
    assert.equal(await store.submit({ ...entry, alias: `SafeDriver#${profile.tag}`, score: 9999 }, 200, 201), false)
    assert.equal((await store.list()).length, 2)
    assert.ok((await store.list()).every(row => row.score === 50))
  } finally {
    const exited = new Promise<void>(resolve => redis.once('exit', () => resolve()))
    redis.kill('SIGTERM'); await exited
    await rm(dir, { recursive: true, force: true })
  }
})
