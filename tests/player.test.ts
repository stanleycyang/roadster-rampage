import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateUsername } from '../server/names.ts'
import { createPlayerHandler, playerIdFor } from '../server/player.ts'
import { RENAME_COOLDOWN_MS } from '../shared/player.ts'
import type { PlayerProfile, NameReport, ReportReason, ClaimResult } from '../shared/player.ts'
import type { PlayerStore } from '../server/player-store.ts'
import { MemoryStore } from './memory-store.ts'

const secret = 'offline-only-player-service-test-secret'
const targetId = playerIdFor('target', secret)
class Players extends MemoryStore implements PlayerStore {
  profiles = new Map<string, PlayerProfile>([[targetId, { username: 'NightDriver', changedAt: 1, needsRename: false }]])
  reported: NameReport[] = []
  async profile(id: string) { return this.profiles.get(id) ?? null }
  async claim(id: string, username: string, now: number): Promise<ClaimResult> {
    if ([...this.profiles.entries()].some(([other, p]) => other !== id && p.username?.toLowerCase() === username.toLowerCase())) return 'taken'
    this.profiles.set(id, { username, changedAt: now, needsRename: false }); return 'claimed'
  }
  async report(_reporter: string, id: string, reason: ReportReason, now: number) {
    this.reported.push({ playerId: id, username: this.profiles.get(id)!.username!, reason, createdAt: now }); return true
  }
  async reports() { return this.reported }
  async moderate(id: string) {
    const p = this.profiles.get(id)
    if (!p) return false
    this.profiles.set(id, { ...p, username: null, needsRename: true }); return true
  }
}

test('username policy catches reserved names, disguised profanity and unsafe characters', () => {
  for (const name of ['NightDriver', 'Coral_Otter', 'Racer123', 'Scunthorpe', 'Assassin', 'ModestRacer']) assert.equal(validateUsername(name), null, name)
  for (const name of ['a', 'a'.repeat(17), '1racer', 'bad name', '<script>', 'Ｒacer', 'Rаcer', 'Race\u200br', 'Racer!']) assert.equal(validateUsername(name), 'format', name)
  for (const name of ['admin', 'AdMiN', 'Official_Racer', 'moderator', 'support123']) assert.equal(validateUsername(name), 'reserved', name)
  for (const name of ['fuck', 'f_u_c_k', 'Fuuuuck', 'Sh1tDriver', 'N4zi', 'f4gg0t', 'cunt', 'b1tch']) assert.equal(validateUsername(name), 'profanity', name)
})

test('name API requires identity, rejects forged fields and protects moderation', async () => {
  const store = new Players()
  let identity: {id: string; moderator: boolean} | null = null
  const handler = createPlayerHandler(store, { players: store, secret, authenticate: async () => identity }, () => RENAME_COOLDOWN_MS + 1)
  const send = (body?: object, headers: Record<string,string> = {}) => handler(new Request('https://game.example/api/player', {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  }))
  assert.equal((await send({ action: 'claim', username: 'Racer' })).status, 401)
  identity = { id: 'attacker', moderator: false }
  assert.equal((await send({ action: 'claim', username: 'Racer', userId: 'target' })).status, 400)
  assert.equal((await send({ action: 'claim', username: 'Racer', playerId: targetId })).status, 400)
  assert.equal((await send({ action: 'claim', username: 'Racer' }, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await send({ action: 'claim', username: 'nightdriver' })).status, 409)
  assert.equal((await send({ action: 'claim', username: 'Sh1tDriver' })).status, 400)
  assert.equal((await send({ action: 'claim', username: 'Racer' })).status, 200)
  assert.equal((await (await send()).json()).profile.username, 'Racer')
  assert.equal((await send({ action: 'moderate', playerId: targetId })).status, 403)
  assert.equal((await send({ action: 'reports' })).status, 403)
  assert.equal((await send({ action: 'report', playerId: targetId, reason: 'hate' })).status, 200)
  assert.equal((await send({ action: 'report', playerId: targetId, reason: '<script>' })).status, 400)
  identity = { id: 'moderator', moderator: true }
  assert.equal((await (await send({ action: 'reports' })).json()).reports.length, 1)
  assert.equal((await send({ action: 'moderate', playerId: targetId })).status, 200)
  assert.equal((await (await send({ action: 'reports' })).json()).reports.length, 0)
  assert.equal((await store.profile(targetId))?.needsRename, true)
  store.allowed = false
  assert.equal((await send()).status, 429)
})

test('unconfigured and failed authentication fail closed without leaking errors', async () => {
  assert.equal((await createPlayerHandler(null, null)(new Request('https://game.example'))).status, 503)
  const store = new Players()
  const handler = createPlayerHandler(store, { players: store, secret, authenticate: async () => { throw new Error('private provider detail') } })
  const response = await handler(new Request('https://game.example/api/player'))
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes('private'))
})

test('named leaderboard submissions derive identity and name exclusively on the server', async () => {
  const { createHandler } = await import('../server/leaderboard.ts')
  const store = new Players()
  let identity: {id: string; moderator: boolean} | null = null
  const handler = createHandler(store, secret, () => 1800000000000, { players: store, secret, authenticate: async () => identity })
  const send = (body?: object) => handler(new Request('https://game.example/api/leaderboard', {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }))
  assert.equal((await (await send()).json()).usernamesEnabled, true)
  const { ticket } = await (await send({ action: 'start', ruleset: 'roadster-v1', debug: false, screenshot: false })).json()
  const body = { action: 'submit', ticket, runId: ticket.split('.')[0], ruleset: 'roadster-v1', debug: false, screenshot: false, score: 100, distance: 0, durationMs: 1 }
  assert.equal((await send(body)).status, 401)
  identity = { id: 'unclaimed', moderator: false }
  assert.equal((await send(body)).status, 409)
  identity = { id: 'target', moderator: false }
  assert.equal((await send({ ...body, alias: 'Impersonator' })).status, 400)
  assert.equal((await send({ ...body, playerId: playerIdFor('attacker', secret) })).status, 400)
  const response = await send(body)
  assert.equal(response.status, 200)
  const { entry } = await response.json()
  assert.equal(entry.alias, 'NightDriver')
  assert.equal(entry.playerId, targetId)
  assert.ok(!JSON.stringify(entry).includes('target'))
  await store.moderate(targetId)
  assert.equal((await send(body)).status, 409)
})
