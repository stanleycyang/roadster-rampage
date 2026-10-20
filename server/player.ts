import { PLAYER_ID_PATTERN, REPORT_REASONS, RENAME_COOLDOWN_MS } from '../shared/player.ts'
import type { ReportReason } from '../shared/player.ts'
import type { PlayerStore } from './player-store.ts'
import type { Store } from './store.ts'
import { validateUsername } from './names.ts'
import { checkOrigin, exactFields, readBody, reply, RequestError } from './http.ts'
import { isModerator, newPlayerToken, playerIdFor, readPlayerToken, rememberPlayer } from './identity.ts'

export interface PlayerServices { players: PlayerStore; secret: string; moderationSecret?: string }
export function createPlayerHandler(store: (Store & PlayerStore) | null, services: PlayerServices | null, now = Date.now) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'GET' && req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
    if (!store || !services) return reply(503, { error: 'names_unavailable' })
    try {
      checkOrigin(req)
      const time = now()
      const ip = req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
      const bucket = playerIdFor(`ip:${Math.floor(time / 3600000)}:${ip}`, services.secret)
      if (!await store.allow(bucket, req.method === 'POST', time)) return reply(429, { error: 'rate_limit' })
      const token = readPlayerToken(req)
      const playerId = token ? playerIdFor(token, services.secret) : null
      if (req.method === 'GET') return reply(200, { profile: playerId ? await store.profile(playerId) : null })
      const body = await readBody(req)
      if (body.action === 'reports' || body.action === 'moderate') {
        if (!isModerator(req, services.moderationSecret)) return reply(403, { error: 'forbidden' })
        exactFields(body, body.action === 'reports' ? ['action'] : ['action', 'playerId'])
        if (body.action === 'reports') {
          const reports = await store.reports()
          const profiles = await Promise.all(reports.map(report => store.profile(report.playerId)))
          return reply(200, { reports: reports.filter((report, i) => report.createdAt > time - RENAME_COOLDOWN_MS && profiles[i]?.username === report.username && !profiles[i]?.needsRename) })
        }
        if (typeof body.playerId !== 'string' || !PLAYER_ID_PATTERN.test(body.playerId)) throw new RequestError(400, 'invalid_request')
        const moderated = await store.moderate(body.playerId)
        return reply(moderated ? 200 : 404, { moderated })
      }
      if (body.action === 'claim') {
        exactFields(body, ['action', 'username'])
        const invalid = validateUsername(body.username)
        if (invalid) return reply(400, { error: `name_${invalid}` })
        // A tag is assigned atomically; users never submit or select it.
        const credential = token ?? newPlayerToken()
        const id = playerIdFor(credential, services.secret)
        if (!await store.allow(`player:${id}`, true, time)) return reply(429, { error: 'rate_limit' })
        const result = await store.claim(id, body.username as string, time)
        if (result !== 'claimed') return reply(result === 'full' ? 503 : 409, { error: `name_${result}` })
        return rememberPlayer(req, reply(200, { profile: await store.profile(id) }), credential)
      }
      if (body.action === 'report') {
        exactFields(body, ['action', 'playerId', 'reason'])
        if (typeof body.playerId !== 'string' || !PLAYER_ID_PATTERN.test(body.playerId) || !REPORT_REASONS.includes(body.reason as ReportReason)) throw new RequestError(400, 'invalid_request')
        if (!playerId || !await store.profile(playerId)) return reply(409, { error: 'name_required' })
        if (!await store.allow(`player:${playerId}`, true, time)) return reply(429, { error: 'rate_limit' })
        if (!await store.report(playerId, body.playerId, body.reason as ReportReason, time)) return reply(400, { error: 'invalid_report' })
        return reply(200, { reported: true })
      }
      throw new RequestError(400, 'invalid_request')
    } catch (error) {
      if (error instanceof RequestError) return reply(error.status, { error: error.code })
      console.error('Player service unavailable')
      return reply(503, { error: 'names_unavailable' })
    }
  }
}
