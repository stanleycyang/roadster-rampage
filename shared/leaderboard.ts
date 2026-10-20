import { isTaggedName, PLAYER_ID_PATTERN } from './player.ts'
export const RULESET = 'roadster-v1'
export const LIMIT = 20
export const TICKET_MS = 6 * 60 * 60 * 1000
export const COLORS = ['Amber', 'Azure', 'Coral', 'Golden', 'Mint', 'Silver'] as const
export const ANIMALS = ['Badger', 'Falcon', 'Otter', 'Panda', 'Robin', 'Turtle'] as const
export interface RunResult {
  readonly runId: string
  readonly score: number
  readonly distance: number
  readonly durationMs: number
  readonly ruleset: typeof RULESET
  readonly debug: false
  readonly screenshot: false
}
export interface Entry { runId: string; alias: string; score: number; distance: number; playerId?: string }
export function isAlias(value: unknown): value is string {
  return typeof value === 'string' && COLORS.some(c => ANIMALS.some(a => value === `${c} ${a}`))
}
export function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false
  const e = value as Entry
  return /^[0-9a-f-]{36}$/.test(e.runId) && (e.playerId === undefined ? isAlias(e.alias) : PLAYER_ID_PATTERN.test(e.playerId) && (isTaggedName(e.alias) || e.alias === 'Name removed')) && Number.isSafeInteger(e.score) && e.score >= 0 && e.score <= 1e9 && Number.isSafeInteger(e.distance) && e.distance >= 0 && e.distance <= 1e6
}
