import { createHandler } from '../server/leaderboard.ts'
import { RedisStore } from '../server/store.ts'
// Disabled unless explicitly activated. All variables are server-only.
export function configuredHandler(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  // Select a complete pair; never combine credentials from different bindings.
  // Even an empty explicit binding prevents fallback to the legacy KV pair.
  const explicit = env.UPSTASH_REDIS_REST_URL !== undefined || env.UPSTASH_REDIS_REST_TOKEN !== undefined
  const url = explicit ? env.UPSTASH_REDIS_REST_URL : env.KV_REST_API_URL
  const token = explicit ? env.UPSTASH_REDIS_REST_TOKEN : env.KV_REST_API_TOKEN
  if (env.LEADERBOARD_ENABLED !== 'true' || !url || !token || !env.LEADERBOARD_SECRET || !env.LEADERBOARD_PREFIX) return createHandler(null, '')
  try {
    return createHandler(new RedisStore(url, token, env.LEADERBOARD_PREFIX, request), env.LEADERBOARD_SECRET)
  } catch { return createHandler(null, '') }
}
export default { fetch: (request: Request) => configuredHandler()(request) }
