import { createHmac } from 'node:crypto'
import { PLAYER_ID_PATTERN, REPORT_REASONS } from '../shared/player.ts'
import type { ReportReason } from '../shared/player.ts'
import type { PlayerStore } from './player-store.ts'
import type { Store } from './store.ts'
import { validateUsername } from './names.ts'
import { checkOrigin, exactFields, readBody, reply, RequestError } from './http.ts'

export interface Identity { id: string; moderator: boolean }
export type Authenticate = (req: Request) => Promise<Identity | null>
export function playerIdFor(id: string, secret: string): string {
  return createHmac('sha256', secret).update(`player:${id}`).digest('hex')
}
export interface PlayerServices { players: PlayerStore; authenticate: Authenticate; secret: string }
export function createPlayerHandler(store: (Store & PlayerStore) | null, services: PlayerServices | null, now = Date.now) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'GET' && req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
    if (!store || !services) return reply(503, { error: 'accounts_unavailable' })
    try {
      checkOrigin(req)
      const time = now()
      const ip = req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
      const bucket = playerIdFor(`ip:${Math.floor(time / 3600000)}:${ip}`, services.secret)
      if (!await store.allow(bucket, req.method === 'POST', time)) return reply(429, { error: 'rate_limit' })
      const identity = await services.authenticate(req)
      if (!identity) return reply(401, { error: 'sign_in_required' })
      const playerId = playerIdFor(identity.id, services.secret)
      // Account-based admission also prevents bypassing limits by rotating IPs.
      if (!await store.allow(`account:${playerId}`, req.method === 'POST', time)) return reply(429, { error: 'rate_limit' })
      if (req.method === 'GET') return reply(200, { profile: await store.profile(playerId), moderator: identity.moderator })
      const body = await readBody(req)
      if (body.action === 'claim') {
        exactFields(body, ['action', 'username'])
        const invalid = validateUsername(body.username)
        if (invalid) return reply(400, { error: `name_${invalid}` })
        const result = await store.claim(playerId, body.username as string, time)
        if (result !== 'claimed') return reply(409, { error: `name_${result}` })
        return reply(200, { profile: await store.profile(playerId) })
      }
      if (body.action === 'report') {
        exactFields(body, ['action', 'playerId', 'reason'])
        if (typeof body.playerId !== 'string' || !PLAYER_ID_PATTERN.test(body.playerId) || !REPORT_REASONS.includes(body.reason as ReportReason)) throw new RequestError(400, 'invalid_request')
        if (!await store.report(playerId, body.playerId, body.reason as ReportReason, time)) return reply(400, { error: 'invalid_report' })
        return reply(200, { reported: true })
      }
      if (body.action === 'reports' || body.action === 'moderate') {
        if (!identity.moderator) return reply(403, { error: 'forbidden' })
        exactFields(body, body.action === 'reports' ? ['action'] : ['action', 'playerId'])
        if (body.action === 'reports') {
          const reports = await store.reports()
          const profiles = await Promise.all(reports.map(report => store.profile(report.playerId)))
          return reply(200, { reports: reports.filter((report, i) => profiles[i]?.username === report.username && !profiles[i]?.needsRename) })
        }
        if (typeof body.playerId !== 'string' || !PLAYER_ID_PATTERN.test(body.playerId)) throw new RequestError(400, 'invalid_request')
        return reply(await store.moderate(body.playerId) ? 200 : 404, { moderated: true })
      }
      throw new RequestError(400, 'invalid_request')
    } catch (error) {
      if (error instanceof RequestError) return reply(error.status, { error: error.code })
      console.error('Player service unavailable')
      return reply(503, { error: 'accounts_unavailable' })
    }
  }
}
