import { createHandler } from '../server/leaderboard.ts'
import { configuration } from '../server/configuration.ts'
export function configuredHandler(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const config = configuration(env, request)
  return config ? createHandler(config.store, config.signingSecret, Date.now, config.players) : createHandler(null, '')
}
export default { fetch: (request: Request) => configuredHandler()(request) }
