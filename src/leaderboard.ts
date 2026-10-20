import { PlayerNameForm, reportName } from './player.ts'
import { RULESET, LIMIT, isEntry } from '../shared/leaderboard.ts'
import type { Entry, RunResult } from '../shared/leaderboard.ts'

export async function leaderboardRequest(body?: object, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch('/api/leaderboard', {
    method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
  }).catch(() => { throw new Error('Global leaderboard unavailable. Check your connection or try again later; you can keep playing.') })
  if (response.status === 409) throw new Error('Choose and save a name before submitting. Allow this site’s cookies to remember your tag.')
  if (!response.ok) throw new Error(response.status === 429 ? 'Busy — please try again later.' : response.status === 400 ? 'This run cannot be submitted. Start a new run.' : 'Global leaderboard unavailable. You can keep playing.')
  return response.json()
}
export type Requester = typeof leaderboardRequest
export class CurrentRun {
  readonly id = crypto.randomUUID()
  private result: RunResult | null = null
  private ticket: Promise<string | null>
  readonly eligible: boolean
  constructor(eligible: boolean, request: Requester = leaderboardRequest) {
    this.eligible = eligible
    // Registration contains no score. No request at all for debug/screenshot runs.
    this.ticket = eligible ? request({ action: 'start', ruleset: RULESET, debug: false, screenshot: false }).then(data => typeof data.ticket === 'string' ? data.ticket : null).catch(() => null) : Promise.resolve(null)
  }
  finish(score: number, distance: number, durationMs: number): Readonly<RunResult> | null {
    if (!this.eligible) return null
    this.result ??= Object.freeze({ runId: this.id, ruleset: RULESET, debug: false, screenshot: false, score: Math.floor(score), distance: Math.floor(distance), durationMs: Math.max(1, Math.floor(durationMs)) })
    return this.result
  }
  async submission(): Promise<object> {
    const result = this.result
    const ticket = await this.ticket
    if (!result || !ticket) throw new Error('Global submission was unavailable when this run started. Try a new run; your local record is safe.')
    return { ...result, runId: ticket.split('.')[0], action: 'submit', ticket }
  }
}

export class Leaderboard {
  private readonly root = document.createElement('section')
  private readonly status = document.createElement('p')
  private readonly list = document.createElement('ol')
  private readonly refresh = document.createElement('button')
  private readonly submit = document.createElement('button')
  private readonly notice = document.createElement('p')
  private readonly intro = document.createElement('p')
  private readonly names = new PlayerNameForm()
  private namesEnabled = false
  private generation = 0
  private controller: AbortController | null = null
  private run: CurrentRun | null = null
  private sending = false
  private sent = new Set<string>()
  private request: Requester
  constructor(request: Requester = leaderboardRequest) {
    this.request = request
    this.root.className = 'leaderboard'
    this.root.dataset.ui = 'true'
    this.root.setAttribute('aria-label', 'Global leaderboard')
    const heading = document.createElement('h3')
    heading.textContent = 'Global top 100'
    this.intro.textContent = 'Casual, unverified scores · Family-friendly aliases assigned by the server.'
    this.status.setAttribute('role', 'status')
    this.notice.setAttribute('role', 'status')
    this.refresh.type = this.submit.type = 'button'
    this.refresh.textContent = 'Refresh leaderboard'
    this.submit.textContent = 'Submit this run'
    this.refresh.addEventListener('click', () => { void this.load() })
    this.submit.addEventListener('click', () => { void this.send() })
    this.root.append(heading, this.intro, this.status, this.list, this.refresh, this.names.root, this.submit, this.notice)
  }
  show(host: HTMLElement, run: CurrentRun | null): void {
    this.hide()
    this.run = run
    host.append(this.root)
    this.submit.hidden = !run || !run.eligible
    this.submit.disabled = true
    this.submit.textContent = 'Submit this run'
    this.notice.textContent = run && !run.eligible ? 'Debug and screenshot runs stay local.' : run ? 'Optional: share only this run. Personal records stay on this device.' : ''
    void this.load()
  }
  hide(): void {
    this.generation++
    this.names.hide()
    this.namesEnabled = false
    this.root.querySelector('dialog')?.remove()
    this.controller?.abort()
    this.controller = null
    this.root.remove()
    this.run = null
    this.sending = false
    this.sent.clear()
  }
  private async load(): Promise<void> {
    this.controller?.abort()
    const controller = this.controller = new AbortController()
    const generation = this.generation
    this.status.textContent = 'Loading global leaderboard…'
    this.list.replaceChildren()
    this.refresh.disabled = true
    try {
      const data = await this.request(undefined, controller.signal)
      if (generation !== this.generation || controller.signal.aborted) return
      if (data.ruleset !== RULESET || !Array.isArray(data.entries) || data.entries.length > LIMIT || !data.entries.every(isEntry)) throw new Error('Invalid leaderboard response. Please try again later.')
      this.namesEnabled = data.usernamesEnabled === true
      this.intro.textContent = this.namesEnabled ? 'Casual, unverified scores · Choose a name. Your unique #tag is assigned by the server.' : 'Casual, unverified scores · Family-friendly aliases assigned by the server.'
      const entries = data.entries as Entry[]
      this.list.replaceChildren(...entries.map(entry => {
        const row = document.createElement('li')
        row.textContent = `${entry.alias} — ${entry.score.toLocaleString()} pts · ${entry.distance.toLocaleString()} m`
        if (this.namesEnabled && entry.playerId && entry.alias !== 'Name removed') {
          const report = document.createElement('button')
          report.type = 'button'
          report.className = 'report-name'
          report.textContent = 'Report'
          report.setAttribute('aria-label', `Report ${entry.alias}`)
          report.addEventListener('click', () => {
            const dialog = reportName(entry.playerId!, entry.alias)
            this.root.append(dialog)
            dialog.showModal()
          })
          row.append(' ', report)
        }
        return row
      }))
      if (this.namesEnabled && this.run?.eligible && !this.names.active) await this.names.show(controller.signal)
      if (generation !== this.generation || controller.signal.aborted) return
      this.submit.disabled = this.sending || Boolean(this.run && this.sent.has(this.run.id))
      this.status.textContent = entries.length ? 'Highest scores first. Equal scores use a fixed run-ID order.' : 'No runs yet. Finish a run to be the first!'
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return
      this.status.textContent = navigator.onLine === false ? 'Offline — personal records and play still work.' : error instanceof Error ? error.message : 'Leaderboard unavailable.'
    } finally {
      if (generation === this.generation && !controller.signal.aborted) this.refresh.disabled = false
    }
  }
  private async send(): Promise<void> {
    const run = this.run
    if (!run || !run.eligible || this.sending || this.sent.has(run.id)) return
    const generation = this.generation
    this.sending = true
    this.submit.disabled = true
    this.notice.textContent = 'Submitting this run…'
    try {
      if (this.namesEnabled) await this.names.ensure()
      if (generation !== this.generation) return
      const payload = await run.submission()
      if (generation !== this.generation) return
      const data = await this.request(payload)
      if (generation !== this.generation) return
      if (!isEntry(data.entry)) throw new Error('Submission response unavailable. Retry safely.')
      this.sent.add(run.id)
      this.submit.textContent = 'Submitted'
      this.notice.textContent = `Submitted as ${data.entry.alias}. Only the top 100 runs appear.`
      void this.load()
    } catch (error) {
      if (generation === this.generation) this.notice.textContent = error instanceof Error ? error.message : 'Submission unavailable. Try again.'
    } finally {
      if (generation === this.generation) {
        this.sending = false
        this.submit.disabled = this.sent.has(run.id)
      }
    }
  }
}
