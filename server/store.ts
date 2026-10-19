import type { Entry } from '../shared/leaderboard.ts'
import { LIMIT, TICKET_MS } from '../shared/leaderboard.ts'
export interface Store {
  allow(client: string, write: boolean, now: number): Promise<boolean>
  list(): Promise<Entry[]>
  submit(entry: Entry, issuedAt: number, now: number): Promise<boolean>
}
// One atomic gate, with global limits BEFORE allocating per-client fields.
// Expiring hourly hashes and daily counters; no raw IP addresses stored.
export const GATE = `
local field = ARGV[1] .. ':' .. ARGV[2]
local cap = ARGV[2] == 'write' and 20 or 120
local n = tonumber(redis.call('HGET', KEYS[1], field) or '0')
if n >= cap then return 0 end
local count = tonumber(redis.call('HGET', KEYS[1], 'total') or '0')
if count >= 5000 then return 0 end
redis.call('HINCRBY', KEYS[1], 'total', 1)
redis.call('EXPIRE', KEYS[1], 7200)
redis.call('HINCRBY', KEYS[1], field, 1)
if ARGV[2] == 'write' then
  local daily = tonumber(redis.call('GET', KEYS[2]) or '0')
  if daily >= 2000 then return 0 end
  redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], 172800)
end
return 1`
export const SUBMIT = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[4])
if redis.call('ZSCORE', KEYS[2], ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
redis.call('EXPIRE', KEYS[2], 43200)
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[5])
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -101)
return 1`
export class RedisStore implements Store {
  private url: string
  private token: string
  private prefix: string
  private request: typeof fetch
  constructor(url: string, token: string, prefix: string, request: typeof fetch = fetch) {
    this.url = url
    this.token = token
    this.prefix = prefix
    this.request = request
    if (!url.startsWith('https://') || !/^[a-z0-9:_-]{1,64}$/i.test(prefix)) throw new Error('Invalid Redis configuration')
  }
  private async command(args: (string | number)[]): Promise<unknown> {
    const response = await this.request(this.url, {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(3000), redirect: 'error',
    })
    if (!response.ok) throw new Error('Storage unavailable')
    const body = await response.json() as { result?: unknown; error?: unknown }
    if (body.error || !('result' in body)) throw new Error('Storage unavailable')
    return body.result
  }
  async allow(client: string, write: boolean, now: number): Promise<boolean> {
    return await this.command(['EVAL', GATE, 2, `${this.prefix}:rate:${Math.floor(now / 3600000)}`, `${this.prefix}:daily:${Math.floor(now / 86400000)}`, client, write ? 'write' : 'read']) === 1
  }
  async list(): Promise<Entry[]> {
    const rows = await this.command(['ZREVRANGE', `${this.prefix}:top`, 0, LIMIT - 1])
    if (!Array.isArray(rows)) throw new Error('Storage unavailable')
    return rows.map(row => JSON.parse(String(row).slice(37)) as Entry)
  }
  async submit(entry: Entry, issuedAt: number, now: number): Promise<boolean> {
    return await this.command(['EVAL', SUBMIT, 2, `${this.prefix}:top`, `${this.prefix}:seen`, entry.runId, entry.score, issuedAt, now - TICKET_MS, `${entry.runId}|${JSON.stringify(entry)}`]) === 1
  }
}
