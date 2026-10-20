import { createPlayerHandler } from '../server/player.ts'
import { configuration } from '../server/configuration.ts'
export function configuredPlayerHandler(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const config = configuration(env, request)
  return config?.players ? createPlayerHandler(config.store, config.players) : createPlayerHandler(null, null)
}
export default { fetch: (request: Request) => configuredPlayerHandler()(request) }
