import { createHmac } from 'node:crypto'
import { RedisPlayerStore } from './player-store.ts'
import type { PlayerServices } from './player.ts'

export function configuration(env: NodeJS.ProcessEnv, request: typeof fetch = fetch): { store: RedisPlayerStore; signingSecret: string; players?: PlayerServices } | null {
  const explicit = env.UPSTASH_REDIS_REST_URL !== undefined || env.UPSTASH_REDIS_REST_TOKEN !== undefined
  const url = explicit ? env.UPSTASH_REDIS_REST_URL : env.KV_REST_API_URL
  const token = explicit ? env.UPSTASH_REDIS_REST_TOKEN : env.KV_REST_API_TOKEN
  if (env.LEADERBOARD_ENABLED !== 'true' || !url || !token || !env.LEADERBOARD_SECRET || env.LEADERBOARD_SECRET.length < 32 || !env.LEADERBOARD_PREFIX) return null
  if (env.PLAYER_NAMES_ENABLED === 'true' && (!env.PLAYER_ID_SECRET || env.PLAYER_ID_SECRET.length < 32)) return null
  try {
    const store = new RedisPlayerStore(url, token, env.LEADERBOARD_PREFIX, request)
    const scope = (key: string, purpose: string) => createHmac('sha256', key).update(JSON.stringify([purpose, env.LEADERBOARD_PREFIX])).digest('hex')
    const signingSecret = scope(env.LEADERBOARD_SECRET, 'roadster-leaderboard:v1')
    const players = env.PLAYER_NAMES_ENABLED === 'true' ? {
      players: store, secret: scope(env.PLAYER_ID_SECRET!, 'roadster-players:v1'), moderationSecret: env.PLAYER_MODERATION_SECRET,
    } : undefined
    return { store, signingSecret, players }
  } catch { return null }
}
