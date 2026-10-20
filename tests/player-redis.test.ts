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
    assert.deepEqual(await store.profile(winner), profile)
    assert.equal(await store.claim(winner, 'NewDriver', 200), 'cooldown')
    assert.equal(await store.claim(winner, 'NewDriver', RENAME_COOLDOWN_MS + 101), 'claimed')
    assert.equal(await store.claim(ids.find(id => id !== winner)!, 'NIGHTDRIVER', RENAME_COOLDOWN_MS + 102), 'claimed')
    const entry = { runId: randomUUID(), alias: displayName((await store.profile(winner))!), playerId: winner, score: 50, distance: 1 }
    assert.ok(await store.submit(entry, 100, 200))
    assert.equal((await store.list())[0]?.alias, entry.alias)
    const reporter = ids.find(id => id !== winner)!
    assert.ok(await store.report(reporter, winner, 'profanity', RENAME_COOLDOWN_MS + 200))
    assert.ok(await store.report(reporter, winner, 'hate', RENAME_COOLDOWN_MS + 201))
    assert.equal((await store.reports(RENAME_COOLDOWN_MS + 201)).length, 1)
    assert.equal(await store.report(winner, winner, 'hate', RENAME_COOLDOWN_MS + 201), false)
    assert.equal(await store.claim(reporter, 'NewDriver', 2 * RENAME_COOLDOWN_MS + 500), 'claimed')
    assert.equal(await store.moderate({ playerId: winner, username: 'NewDriver', tag: profile.tag, nameChangedAt: RENAME_COOLDOWN_MS + 101 }), 'moderated')
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
    const queue = new RedisPlayerStore('https://mock.invalid', 'offline-only', 'queue', request)
    const time = 10 * RENAME_COOLDOWN_MS
    const target = 'a'.repeat(64)
    await queue.claim(target, 'OldDriver', time - 2 * RENAME_COOLDOWN_MS)
    const oldProfile = (await queue.profile(target))!
    await queue.report('b'.repeat(64), target, 'profanity', time - 1000)
    const [oldReport] = await queue.reports(time)
    assert.ok(oldReport)
    await queue.claim(target, 'SafeDriver', time)
    assert.equal(await queue.moderate(oldReport!), 'stale')
    assert.equal((await queue.profile(target))?.username, 'SafeDriver')
    // A rejected moderation must not globally block the replacement name.
    assert.equal(await queue.claim('c'.repeat(64), 'SafeDriver', time + 1), 'claimed')
    await queue.claim(target, 'OldDriver', time + RENAME_COOLDOWN_MS + 1)
    assert.equal(await queue.moderate({ ...oldReport!, tag: oldProfile.tag }), 'stale')
    const current = (await queue.profile(target))!
    const reviewed = { playerId: target, username: current.username!, tag: current.tag, nameChangedAt: current.changedAt }
    // Seed > one page of obsolete records ahead of one valid old report.
    const live = { ...reviewed, reason: 'hate', createdAt: time + RENAME_COOLDOWN_MS + 5 }
    const stale = Array.from({ length: 450 }, (_, i) => ({ ...live, username: 'PreviousName', createdAt: live.createdAt + i + 1 }))
    await command(['HSET', 'queue:reports:data', 'live', JSON.stringify(live), ...stale.flatMap((report, i) => [`stale:${i}`, JSON.stringify(report)])])
    await command(['ZADD', 'queue:reports:time', live.createdAt, 'live', ...stale.flatMap((report, i) => [report.createdAt, `stale:${i}`])])
    const pending = await queue.reports(live.createdAt + 1000)
    assert.deepEqual(pending, [live])
    assert.equal(await command(['ZCARD', 'queue:reports:time']), 1)
    assert.equal(await command(['HLEN', 'queue:reports:data']), 1)
    assert.equal(await queue.moderate(reviewed), 'moderated')
    assert.deepEqual(await queue.reports(live.createdAt + 1000), [])
    // The read limit applies after filtering, and repeated calls advance as
    // already-reviewed profiles are removed rather than starving old reports.
    const profiles = Array.from({ length: 130 }, (_, i) => ({ username: `Driver${i}`, tag: String(2000 + i), changedAt: time, needsRename: false }))
    const reports = profiles.map((profile, i) => ({ playerId: i.toString(16).padStart(64, '0'), username: profile.username, tag: profile.tag, nameChangedAt: profile.changedAt, reason: 'hate', createdAt: live.createdAt + i }))
    await command(['HSET', 'queue:players', ...profiles.flatMap((profile, i) => [reports[i]!.playerId, JSON.stringify(profile)])])
    await command(['HSET', 'queue:reports:data', ...reports.flatMap((report, i) => [`batch:${i}`, JSON.stringify(report)])])
    await command(['ZADD', 'queue:reports:time', ...reports.flatMap((report, i) => [report.createdAt, `batch:${i}`])])
    const firstBatch = await queue.reports(live.createdAt + 1000)
    assert.equal(firstBatch.length, 100)
    await Promise.all(firstBatch.map(report => queue.moderate(report)))
    assert.equal((await queue.reports(live.createdAt + 1000)).length, 30)
    assert.deepEqual(await queue.reports(live.createdAt + RENAME_COOLDOWN_MS + 1000), [])
    // Real moderation admission stays available with all public caps exhausted.
    await command(['SET', `queue:daily:${Math.floor(time / 86400000)}`, 2000])
    await command(['HSET', `queue:rate:${Math.floor(time / 3600000)}`, 'total', 5000])
    assert.equal(await queue.allow('public', true, time), false)
    for (let i = 0; i < 120; i++) assert.equal(await queue.allowModeration(time), true)
    assert.equal(await queue.allowModeration(time), false)
    assert.equal(await queue.allowModeration(time + 3600000), true)
  } finally {
    const exited = new Promise<void>(resolve => redis.once('exit', () => resolve()))
    redis.kill('SIGTERM'); await exited
    await rm(dir, { recursive: true, force: true })
  }
})
