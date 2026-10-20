import type { Entry } from '../shared/leaderboard.ts'
import { LIMIT, TICKET_MS } from '../shared/leaderboard.ts'
import type { Store } from '../server/store.ts'
// Test-only adapter. Never imported by the deployed function.
export class MemoryStore implements Store {
  entries = new Map<string, Entry>()
  seen = new Map<string, number>()
  allowed = true
  async allow(): Promise<boolean> { return this.allowed }
  async list(): Promise<Entry[]> {
    return [...this.entries.values()].sort((a, b) => b.score - a.score || (a.runId < b.runId ? 1 : -1)).slice(0, LIMIT)
  }
  async submit(entry: Entry, issued: number, now: number): Promise<boolean> {
    for (const [id, time] of this.seen) if (time <= now - TICKET_MS) this.seen.delete(id)
    if (this.seen.has(entry.runId)) return false
    this.seen.set(entry.runId, issued)
    this.entries.set(entry.runId, entry)
    const top = [...this.entries.values()].sort((a, b) => b.score - a.score || (a.runId < b.runId ? 1 : -1)).slice(0, 100)
    this.entries = new Map(top.map(e => [e.runId, e]))
    return true
  }
}
