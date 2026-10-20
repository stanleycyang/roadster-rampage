export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,15}$/
export const PLAYER_ID_PATTERN = /^[a-f0-9]{64}$/
export const TAG_PATTERN = /^[1-9][0-9]{3,11}$/
export const RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000
export const REPORT_REASONS = ['profanity', 'hate', 'impersonation', 'other'] as const
export type ReportReason = typeof REPORT_REASONS[number]
export interface PlayerProfile { username: string | null; tag: string; changedAt: number; needsRename: boolean }
export interface NameReport { playerId: string; username: string; tag: string; reason: ReportReason; createdAt: number }
export type ClaimResult = 'claimed' | 'blocked' | 'cooldown' | 'full'
export function isUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_PATTERN.test(value)
}
export function isProfile(value: unknown): value is PlayerProfile {
  if (!value || typeof value !== 'object') return false
  const p = value as PlayerProfile
  return (p.username === null || isUsername(p.username)) && typeof p.tag === 'string' && TAG_PATTERN.test(p.tag) && Number.isSafeInteger(p.changedAt) && p.changedAt >= 0 && typeof p.needsRename === 'boolean'
}
export function displayName(profile: PlayerProfile): string {
  return profile.username && !profile.needsRename ? `${profile.username}#${profile.tag}` : 'Name removed'
}
export function isTaggedName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const [name, tag, extra] = value.split('#')
  return extra === undefined && isUsername(name) && typeof tag === 'string' && TAG_PATTERN.test(tag)
}
