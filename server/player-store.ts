import { RedisStore } from './store.ts'
import type { ClaimResult, NameReport, PlayerProfile, ReportReason } from '../shared/player.ts'
import { RENAME_COOLDOWN_MS } from '../shared/player.ts'

export interface PlayerStore {
  profile(playerId: string): Promise<PlayerProfile | null>
  claim(playerId: string, username: string, now: number): Promise<ClaimResult>
  report(reporterId: string, playerId: string, reason: ReportReason, now: number): Promise<boolean>
  reports(): Promise<NameReport[]>
  moderate(playerId: string): Promise<boolean>
}
export const CLAIM_NAME = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
local profile = raw and cjson.decode(raw) or nil
local owner = redis.call('HGET', KEYS[2], string.lower(ARGV[2]))
if owner and owner ~= ARGV[1] then return 'taken' end
if profile and profile.username == ARGV[2] then return 'claimed' end
if profile and not profile.needsRename and tonumber(ARGV[3]) - profile.changedAt < tonumber(ARGV[4]) then return 'cooldown' end
redis.call('HSET', KEYS[2], string.lower(ARGV[2]), ARGV[1])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode({username=ARGV[2], changedAt=tonumber(ARGV[3]), needsRename=false}))
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
redis.call('HSET', KEYS[3], id, cjson.encode({playerId=ARGV[2], username=profile.username, reason=ARGV[3], createdAt=tonumber(ARGV[4])}))
return 1`
export const MODERATE_NAME = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local profile = cjson.decode(raw)
if profile.username and profile.username ~= cjson.null then redis.call('HSET', KEYS[2], string.lower(profile.username), 'reserved') end
profile.username = cjson.null
profile.needsRename = true
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(profile))
return 1`
export class RedisPlayerStore extends RedisStore implements PlayerStore {
  async profile(playerId: string): Promise<PlayerProfile | null> {
    const raw = await this.command(['HGET', `${this.prefix}:players`, playerId])
    return raw ? JSON.parse(String(raw)) as PlayerProfile : null
  }
  async claim(playerId: string, username: string, now: number): Promise<ClaimResult> {
    const result = await this.command(['EVAL', CLAIM_NAME, 2, `${this.prefix}:players`, `${this.prefix}:names`, playerId, username, now, RENAME_COOLDOWN_MS])
    if (result !== 'claimed' && result !== 'taken' && result !== 'cooldown') throw new Error('Storage unavailable')
    return result
  }
  async report(reporterId: string, playerId: string, reason: ReportReason, now: number): Promise<boolean> {
    return await this.command(['EVAL', REPORT_NAME, 3, `${this.prefix}:players`, `${this.prefix}:reports:time`, `${this.prefix}:reports:data`, reporterId, playerId, reason, now, now - RENAME_COOLDOWN_MS]) === 1
  }
  async reports(): Promise<NameReport[]> {
    const ids = await this.command(['ZREVRANGE', `${this.prefix}:reports:time`, 0, 99])
    if (!Array.isArray(ids)) throw new Error('Storage unavailable')
    if (!ids.length) return []
    const rows = await this.command(['HMGET', `${this.prefix}:reports:data`, ...ids.map(String)])
    if (!Array.isArray(rows)) throw new Error('Storage unavailable')
    return rows.filter(Boolean).map(row => JSON.parse(String(row)) as NameReport)
  }
  async moderate(playerId: string): Promise<boolean> {
    return await this.command(['EVAL', MODERATE_NAME, 2, `${this.prefix}:players`, `${this.prefix}:names`, playerId]) === 1
  }
}
