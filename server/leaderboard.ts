import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import { ANIMALS, COLORS, RULESET, TICKET_MS, isEntry } from '../shared/leaderboard.ts'
import type { Entry, RunResult } from '../shared/leaderboard.ts'
import type { Store } from './store.ts'
import { playerIdFor, readPlayerToken } from './identity.ts'
import { displayName } from '../shared/player.ts'
import type { PlayerServices } from './player.ts'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
class Invalid extends Error {}
function exact(body: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(body).sort().join(',') !== keys.sort().join(',')) throw new Invalid()
}
function integer(n: unknown, min: number, max: number): n is number { return Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max }
export function aliasFor(runId: string, secret: string): string {
  const bytes = createHmac('sha256', secret).update(`alias:${runId}`).digest()
  return `${COLORS[bytes[0]! % COLORS.length]} ${ANIMALS[bytes[1]! % ANIMALS.length]}`
}
export function createHandler(store: Store | null, secret: string, now = Date.now, players?: PlayerServices) {
  const sign = (text: string) => createHmac('sha256', secret).update(text).digest('hex')
  const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '3600' } : {}) } })
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'GET' && req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
    if (!store || secret.length < 32) return reply(503, { error: 'unavailable' })
    const origin = req.headers.get('origin')
    if ((origin && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') return reply(403, { error: 'origin' })
    try {
      const time = now()
      // Vercel overwrites this header at ingress. Never trust generic x-forwarded-for.
      const ip = req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
      const client = sign(`ip:${Math.floor(time / 3600000)}:${ip}`).slice(0, 32)
      if (!await store.allow(client, req.method === 'POST', time)) return reply(429, { error: 'rate_limit' })
      if (req.method === 'GET') {
        const entries = await store.list()
        if (!entries.every(isEntry)) throw new Error('Invalid stored data')
        return reply(200, { entries, ruleset: RULESET, usernamesEnabled: Boolean(players) })
      }
      if (req.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return reply(415, { error: 'content_type' })
      // Stream limit also covers chunked bodies without Content-Length.
      const reader = req.body?.getReader()
      if (!reader) throw new Invalid()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 2048) { await reader.cancel(); return reply(413, { error: 'body_too_large' }) }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      let body: Record<string, unknown>
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Invalid() }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Invalid()
      if (body.action === 'start') {
        exact(body, ['action', 'ruleset', 'debug', 'screenshot'])
        if (body.ruleset !== RULESET || body.debug !== false || body.screenshot !== false) throw new Invalid()
        const payload = `${randomUUID()}.${time}.${RULESET}`
        return reply(200, { ticket: `${payload}.${sign(payload)}` })
      }
      exact(body, ['action', 'ticket', 'runId', 'ruleset', 'debug', 'screenshot', 'score', 'distance', 'durationMs'])
      const run = body as unknown as RunResult
      if (body.action !== 'submit' || typeof body.ticket !== 'string' || body.ticket.length > 200 || typeof run.runId !== 'string' || !UUID.test(run.runId) || run.ruleset !== RULESET || run.debug !== false || run.screenshot !== false || !integer(run.score, 0, 1e9) || !integer(run.distance, 0, 1e6) || !integer(run.durationMs, 1, TICKET_MS)) throw new Invalid()
      const [id, issued, rules, mac, ...extra] = body.ticket.split('.')
      const issuedAt = Number(issued)
      if (extra.length || id !== run.runId || rules !== RULESET || !integer(issuedAt, 0, time) || time - issuedAt >= TICKET_MS || !mac || !/^[a-f0-9]{64}$/.test(mac) || !timingSafeEqual(Buffer.from(mac), Buffer.from(sign(`${id}.${issued}.${rules}`)))) throw new Invalid()
      if (run.durationMs > time - issuedAt + 10000 || run.distance > (run.durationMs / 1000) * 150 + 100) throw new Invalid()
      const entry: Entry = { runId: run.runId, alias: aliasFor(run.runId, secret), score: run.score, distance: run.distance }
      if (players) {
        const token = readPlayerToken(req)
        if (!token) return reply(409, { error: 'name_required' })
        const playerId = playerIdFor(token, players.secret)
        const profile = await players.players.profile(playerId)
        if (!profile?.username || profile.needsRename) return reply(409, { error: 'name_required' })
        entry.playerId = playerId
        entry.alias = displayName(profile)
      }
      const added = await store.submit(entry, issuedAt, time)
      return reply(200, { entry, duplicate: !added })
    } catch (err) {
      if (err instanceof Invalid) return reply(400, { error: 'invalid_run' })
      // Do not log request bodies, tokens, IPs, or datastore error payloads.
      console.error('Leaderboard storage unavailable')
      return reply(503, { error: 'unavailable' })
    }
  }
}
