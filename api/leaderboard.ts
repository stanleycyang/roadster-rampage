import { createHandler } from '../server/leaderboard.ts'
import { RedisStore } from '../server/store.ts'
// Disabled unless explicitly activated. All variables are server-only.
function handler() {
  const env = process.env
  if (env.LEADERBOARD_ENABLED !== 'true' || !env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN || !env.LEADERBOARD_SECRET || !env.LEADERBOARD_PREFIX) return createHandler(null, '')
  try {
    return createHandler(new RedisStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN, env.LEADERBOARD_PREFIX), env.LEADERBOARD_SECRET)
  } catch { return createHandler(null, '') }
}
export default { fetch: (request: Request) => handler()(request) }
