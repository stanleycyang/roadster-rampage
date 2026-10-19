export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,15}$/
export const PLAYER_ID_PATTERN = /^[a-f0-9]{64}$/
export const RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000
export const REPORT_REASONS = ['profanity', 'hate', 'impersonation', 'other'] as const
export type ReportReason = typeof REPORT_REASONS[number]
export interface PlayerProfile { username: string | null; changedAt: number; needsRename: boolean }
export interface NameReport { playerId: string; username: string; reason: ReportReason; createdAt: number }
export type ClaimResult = 'claimed' | 'taken' | 'cooldown'
export function isUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_PATTERN.test(value)
}
