import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateUsername } from '../server/names.ts'
import { createPlayerHandler } from '../server/player.ts'
import { playerIdFor, readPlayerToken } from '../server/identity.ts'
import { RENAME_COOLDOWN_MS } from '../shared/player.ts'
import type { PlayerProfile, NameReport, ReportReason, ClaimResult } from '../shared/player.ts'
import type { PlayerStore } from '../server/player-store.ts'
import { MemoryStore } from './memory-store.ts'

const secret = 'offline-only-player-service-test-secret'
const moderationSecret = 'offline-only-moderation-secret-not-for-deployment'
const targetToken = 'a'.repeat(64)
const otherToken = 'b'.repeat(64)
const targetId = playerIdFor(targetToken, secret)
const cookie = (token: string) => `__Host-Http-roadster-player=${token}`
class Players extends MemoryStore implements PlayerStore {
  profiles = new Map<string, PlayerProfile>([[targetId, { username: 'NightDriver', tag: '1001', changedAt: 1, needsRename: false }]])
  reported: NameReport[] = []
  async profile(id: string) { return this.profiles.get(id) ?? null }
  async claim(id: string, username: string, now: number): Promise<ClaimResult> {
    const previous = this.profiles.get(id)
    this.profiles.set(id, { username, tag: previous?.tag ?? String(1001 + this.profiles.size), changedAt: now, needsRename: false }); return 'claimed'
  }
  async report(_reporter: string, id: string, reason: ReportReason, now: number) {
    const profile = this.profiles.get(id)!
    this.reported.push({ playerId: id, username: profile.username!, tag: profile.tag, reason, createdAt: now }); return true
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
  for (const name of ['a', 'a'.repeat(17), '1racer', 'bad name', '<script>', 'Ｒacer', 'Rаcer', 'Race\u200br', 'Racer!', 'Racer#1001']) assert.equal(validateUsername(name), 'format', name)
  for (const name of ['admin', 'AdMiN', 'Official_Racer', 'moderator', 'support123']) assert.equal(validateUsername(name), 'reserved', name)
  for (const name of ['fuck', 'f_u_c_k', 'Fuuuuck', 'Sh1tDriver', 'N4zi', 'f4gg0t', 'cunt', 'b1tch']) assert.equal(validateUsername(name), 'profanity', name)
})

test('anonymous names issue private cookies, allow duplicate names and reject forged identity/tag fields', async () => {
  const store = new Players()
  const handler = createPlayerHandler(store, { players: store, secret, moderationSecret }, () => RENAME_COOLDOWN_MS + 1)
  const send = (body?: object, headers: Record<string,string> = {}) => handler(new Request('https://game.example/api/player', {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  }))
  const anonymous = await send()
  assert.equal((await anonymous.json()).profile, null)
  assert.equal(anonymous.headers.get('set-cookie'), null)
  for (const field of ['tag', 'playerId', 'userId', 'moderator']) assert.equal((await send({ action: 'claim', username: 'Racer', [field]: targetId })).status, 400)
  assert.equal((await send({ action: 'claim', username: 'Racer' }, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await send({ action: 'claim', username: 'Sh1tDriver' })).status, 400)
  const claim = await send({ action: 'claim', username: 'NightDriver' })
  assert.equal(claim.status, 200)
  const session = claim.headers.get('set-cookie')!
  assert.match(session, /^__Host-Http-roadster-player=[a-f0-9]{64};/)
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=31536000']) assert.ok(session.includes(flag))
  assert.ok(!session.includes('Domain='))
  const data = await claim.json()
  assert.equal(data.profile.username, 'NightDriver')
  assert.notEqual(data.profile.tag, '1001')
  assert.ok(!JSON.stringify(data).includes(session.split('=')[1]!.split(';')[0]!))
  const remembered = await send(undefined, { Cookie: session.split(';')[0]! })
  assert.deepEqual((await remembered.json()).profile, data.profile)
  // A public ID is not the browser credential and cannot impersonate its owner.
  assert.equal((await (await send(undefined, { Cookie: cookie(targetId) })).json()).profile, null)
  assert.equal((await send({ action: 'moderate', playerId: targetId })).status, 403)
  assert.equal((await send({ action: 'reports' }, { Cookie: cookie(targetToken) })).status, 403)
  assert.equal((await send({ action: 'reports' }, { Authorization: 'Bearer forged' })).status, 403)
  assert.equal((await send({ action: 'report', playerId: targetId, reason: 'hate' })).status, 409)
  await send({ action: 'claim', username: 'OtherDriver' }, { Cookie: cookie(otherToken) })
  assert.equal((await send({ action: 'report', playerId: targetId, reason: 'hate' }, { Cookie: cookie(otherToken) })).status, 200)
  assert.equal((await send({ action: 'report', playerId: targetId, reason: '<script>' }, { Cookie: cookie(otherToken) })).status, 400)
  const admin = { Authorization: `Bearer ${moderationSecret}` }
  assert.equal((await (await send({ action: 'reports' }, admin)).json()).reports.length, 1)
  assert.equal((await send({ action: 'moderate', playerId: targetId }, admin)).status, 200)
  assert.equal((await (await send({ action: 'reports' }, admin)).json()).reports.length, 0)
  assert.equal((await store.profile(targetId))?.needsRename, true)
  store.allowed = false
  assert.equal((await send()).status, 429)
})

test('cookie identity rejects malformed/duplicate cookies and stays isolated by secret', () => {
  const req = (value: string) => new Request('https://game.example/api/player', { headers: { Cookie: value } })
  assert.equal(readPlayerToken(req(cookie(targetToken))), targetToken)
  assert.equal(readPlayerToken(req(`${cookie(targetToken)}; ${cookie(otherToken)}`)), null)
  assert.equal(readPlayerToken(req(cookie('x'.repeat(64)))), null)
  assert.equal(readPlayerToken(req(`roadster-player-local=${targetToken}`)), null)
  assert.notEqual(playerIdFor(targetToken, secret), playerIdFor(targetToken, secret + 'preview'))
})

test('named submissions use only browser identity and server-assigned name/tag', async () => {
  const { createHandler } = await import('../server/leaderboard.ts')
  const store = new Players()
  const handler = createHandler(store, secret, () => 1800000000000, { players: store, secret })
  const send = (body?: object, token?: string) => handler(new Request('https://game.example/api/leaderboard', {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: cookie(token) } : {}) }, body: body ? JSON.stringify(body) : undefined,
  }))
  assert.equal((await (await send()).json()).usernamesEnabled, true)
  const { ticket } = await (await send({ action: 'start', ruleset: 'roadster-v1', debug: false, screenshot: false })).json()
  const body = { action: 'submit', ticket, runId: ticket.split('.')[0], ruleset: 'roadster-v1', debug: false, screenshot: false, score: 100, distance: 0, durationMs: 1 }
  assert.equal((await send(body)).status, 409)
  assert.equal((await send(body, otherToken)).status, 409)
  for (const field of ['alias', 'playerId', 'username', 'tag']) assert.equal((await send({ ...body, [field]: targetId }, targetToken)).status, 400)
  const response = await send(body, targetToken)
  assert.equal(response.status, 200)
  const { entry } = await response.json()
  assert.equal(entry.alias, 'NightDriver#1001')
  assert.equal(entry.playerId, targetId)
  assert.ok(!JSON.stringify(entry).includes(targetToken))
  await store.moderate(targetId)
  assert.equal((await send(body, targetToken)).status, 409)
})

test('unconfigured player service fails closed', async () => {
  assert.equal((await createPlayerHandler(null, null)(new Request('https://game.example'))).status, 503)
})
