import { PLAYER_ID_PATTERN, REPORT_REASONS, TAG_PATTERN, isUsername } from '../shared/player.ts'
import type { ReportReason, ModerationTarget } from '../shared/player.ts'
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
      // Verified moderator traffic has its own bounded quota and is never
      // admitted through player IP/global/daily gates.
      if (req.method === 'POST' && isModerator(req, services.moderationSecret)) {
        if (!await store.allowModeration(time)) return reply(429, { error: 'moderation_rate_limit' })
        const body = await readBody(req)
        if (body.action === 'reports') {
          exactFields(body, ['action'])
          return reply(200, { reports: await store.reports(time) })
        }
        if (body.action !== 'moderate') throw new RequestError(400, 'invalid_request')
        exactFields(body, ['action', 'playerId', 'username', 'tag', 'nameChangedAt'])
        if (typeof body.playerId !== 'string' || !PLAYER_ID_PATTERN.test(body.playerId) || !isUsername(body.username) || typeof body.tag !== 'string' || !TAG_PATTERN.test(body.tag) || !Number.isSafeInteger(body.nameChangedAt) || (body.nameChangedAt as number) < 0) throw new RequestError(400, 'invalid_request')
        const result = await store.moderate(body as unknown as ModerationTarget)
        return result === 'moderated' ? reply(200, { moderated: true }) : reply(result === 'stale' ? 409 : 404, { error: result === 'stale' ? 'name_version_changed' : 'player_not_found' })
      }
      const ip = req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
      const bucket = playerIdFor(`ip:${Math.floor(time / 3600000)}:${ip}`, services.secret)
      if (!await store.allow(bucket, req.method === 'POST', time)) return reply(429, { error: 'rate_limit' })
      const token = readPlayerToken(req)
      const playerId = token ? playerIdFor(token, services.secret) : null
      if (req.method === 'GET') return reply(200, { profile: playerId ? await store.profile(playerId) : null })
      const body = await readBody(req)
      if (body.action === 'reports' || body.action === 'moderate') return reply(403, { error: 'forbidden' })
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
