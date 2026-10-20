import { RedisStore } from './store.ts'
import type { ClaimResult, NameReport, PlayerProfile, ReportReason, ModerationTarget, ModerationResult } from '../shared/player.ts'
import { isProfile, RENAME_COOLDOWN_MS } from '../shared/player.ts'

export interface PlayerStore {
  profile(playerId: string): Promise<PlayerProfile | null>
  claim(playerId: string, username: string, now: number): Promise<ClaimResult>
  report(reporterId: string, playerId: string, reason: ReportReason, now: number): Promise<boolean>
  reports(now: number): Promise<NameReport[]>
  moderate(target: ModerationTarget): Promise<ModerationResult>
  allowModeration(now: number): Promise<boolean>
}
export const CLAIM_NAME = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
local profile = raw and cjson.decode(raw) or nil
if profile and profile.username ~= cjson.null and redis.call('HEXISTS', KEYS[2], string.lower(profile.username)) == 1 then profile.needsRename = true end
if redis.call('HEXISTS', KEYS[2], string.lower(ARGV[2])) == 1 then return 'blocked' end
if profile and profile.username == ARGV[2] and not profile.needsRename then return 'claimed' end
if profile and not profile.needsRename and tonumber(ARGV[3]) - profile.changedAt < tonumber(ARGV[4]) then return 'cooldown' end
if not profile then
  if redis.call('HLEN', KEYS[1]) >= 50000 then return 'full' end
  local tag = redis.call('INCR', KEYS[3]) + 1000
  if tag > 999999999999 then return 'full' end
  profile = {tag=tostring(tag)}
end
profile.username = ARGV[2]
profile.changedAt = tonumber(ARGV[3])
profile.needsRename = false
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(profile))
return 'claimed'`
export const REPORT_NAME = `
local raw = redis.call('HGET', KEYS[1], ARGV[2])
if ARGV[1] == ARGV[2] or not raw then return 0 end
local profile = cjson.decode(raw)
if profile.needsRename or profile.username == cjson.null then return 0 end
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[5])
for _, id in ipairs(expired) do redis.call('HDEL', KEYS[3], id) end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[5])
local id = ARGV[2] .. ':' .. ARGV[1] .. ':' .. profile.changedAt
if redis.call('ZSCORE', KEYS[2], id) then return 1 end
redis.call('ZADD', KEYS[2], ARGV[4], id)
redis.call('HSET', KEYS[3], id, cjson.encode({playerId=ARGV[2], username=profile.username, tag=profile.tag, nameChangedAt=profile.changedAt, reason=ARGV[3], createdAt=tonumber(ARGV[4])}))
return 1`
export const MODERATE_NAME = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 'missing' end
local profile = cjson.decode(raw)
if profile.needsRename or profile.username ~= ARGV[2] or profile.tag ~= ARGV[3] or profile.changedAt ~= tonumber(ARGV[4]) then return 'stale' end
if profile.username and profile.username ~= cjson.null then redis.call('HSET', KEYS[2], string.lower(profile.username), 'reserved') end
profile.username = cjson.null
profile.needsRename = true
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(profile))
return 'moderated'`
// Each read scans at most 200 reports and prunes obsolete records atomically.
// The caller advances by retained rows, so removals cannot skip older reports.
export const READ_REPORTS = `
local ids = redis.call('ZREVRANGE', KEYS[1], ARGV[1], tonumber(ARGV[1]) + 199)
local rows = {}
local retained = 0
local scanned = 0
for _, id in ipairs(ids) do
  scanned = scanned + 1
  local raw = redis.call('HGET', KEYS[2], id)
  local valid = false
  if raw then
    local report = cjson.decode(raw)
    local profileRaw = redis.call('HGET', KEYS[3], report.playerId)
    if profileRaw and report.nameChangedAt and report.createdAt > tonumber(ARGV[2]) then
      local profile = cjson.decode(profileRaw)
      valid = not profile.needsRename and profile.username == report.username and profile.tag == report.tag and profile.changedAt == report.nameChangedAt and redis.call('HEXISTS', KEYS[4], string.lower(report.username)) == 0
    end
  end
  if valid then
    table.insert(rows, raw)
    retained = retained + 1
    if retained >= tonumber(ARGV[3]) then break end
  else
    redis.call('ZREM', KEYS[1], id)
    redis.call('HDEL', KEYS[2], id)
  end
end
return {cjson.encode(rows), tonumber(ARGV[1]) + retained, scanned == #ids and #ids < 200 and 1 or 0}`
export const MODERATION_GATE = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= 120 then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 7200)
return 1`
export class RedisPlayerStore extends RedisStore implements PlayerStore {
  async profile(playerId: string): Promise<PlayerProfile | null> {
    const raw = await this.command(['HGET', `${this.prefix}:players`, playerId])
    if (!raw) return null
    const profile: unknown = JSON.parse(String(raw))
    if (!isProfile(profile)) throw new Error('Invalid player profile')
    if (profile.username && await this.command(['HEXISTS', `${this.prefix}:blocked-names`, profile.username.toLowerCase()]) === 1) return { ...profile, username: null, needsRename: true }
    return profile
  }
  async claim(playerId: string, username: string, now: number): Promise<ClaimResult> {
    const result = await this.command(['EVAL', CLAIM_NAME, 3, `${this.prefix}:players`, `${this.prefix}:blocked-names`, `${this.prefix}:next-tag`, playerId, username, now, RENAME_COOLDOWN_MS])
    if (result !== 'claimed' && result !== 'blocked' && result !== 'cooldown' && result !== 'full') throw new Error('Storage unavailable')
    return result
  }
  async report(reporterId: string, playerId: string, reason: ReportReason, now: number): Promise<boolean> {
    return await this.command(['EVAL', REPORT_NAME, 3, `${this.prefix}:players`, `${this.prefix}:reports:time`, `${this.prefix}:reports:data`, reporterId, playerId, reason, now, now - RENAME_COOLDOWN_MS]) === 1
  }
  async reports(now: number): Promise<NameReport[]> {
    const reports: NameReport[] = []
    let offset = 0
    while (reports.length < 100) {
      const page = await this.command(['EVAL', READ_REPORTS, 4, `${this.prefix}:reports:time`, `${this.prefix}:reports:data`, `${this.prefix}:players`, `${this.prefix}:blocked-names`, offset, now - RENAME_COOLDOWN_MS, 100 - reports.length])
      if (!Array.isArray(page) || page.length !== 3 || !Number.isSafeInteger(page[1]) || page[1] < offset) throw new Error('Storage unavailable')
      const rows: unknown = JSON.parse(String(page[0]))
      // Redis Lua encodes an empty table as {}; non-empty results are arrays.
      if (Array.isArray(rows)) reports.push(...rows.map(raw => JSON.parse(String(raw)) as NameReport))
      else if (!rows || typeof rows !== 'object' || Object.keys(rows).length) throw new Error('Storage unavailable')
      offset = page[1]
      if (page[2] === 1) break
    }
    return reports
  }
  async moderate(target: ModerationTarget): Promise<ModerationResult> {
    const result = await this.command(['EVAL', MODERATE_NAME, 2, `${this.prefix}:players`, `${this.prefix}:blocked-names`, target.playerId, target.username, target.tag, target.nameChangedAt])
    if (result !== 'moderated' && result !== 'stale' && result !== 'missing') throw new Error('Storage unavailable')
    return result
  }
  async allowModeration(now: number): Promise<boolean> {
    return await this.command(['EVAL', MODERATION_GATE, 1, `${this.prefix}:moderation:${Math.floor(now / 3600000)}`]) === 1
  }
}
