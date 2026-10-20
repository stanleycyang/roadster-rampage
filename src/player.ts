import { displayName, isProfile, isUsername, REPORT_REASONS } from '../shared/player.ts'
import type { PlayerProfile, ReportReason } from '../shared/player.ts'

const messages: Record<string, string> = {
  name_format: 'Use 3–16 letters, numbers or underscores, starting with a letter.',
  name_profanity: 'Please choose a different, family-friendly name.',
  name_reserved: 'That name is reserved. Please choose another.',
  name_blocked: 'That name was removed by a moderator. Please choose another.',
  name_cooldown: 'You can change your display name once every 30 days.',
  name_required: 'Choose a name before submitting. If cookies are blocked, allow them for this site.',
  rate_limit: 'Too many requests. Please try again later.',
  invalid_report: 'This name cannot be reported.',
}
export async function playerRequest(body?: object, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch('/api/player', {
    method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
  })
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object') throw new Error('Names are unavailable. You can keep playing.')
  const record = data as Record<string, unknown>
  if (!response.ok) throw new Error(messages[String(record.error)] ?? 'Names are unavailable. Please try again later; you can keep playing.')
  return record
}
export type PlayerRequester = typeof playerRequest

export class PlayerNameForm {
  readonly root = document.createElement('form')
  private readonly input = document.createElement('input')
  private readonly status = document.createElement('p')
  private readonly save = document.createElement('button')
  private profile: PlayerProfile | null = null
  private generation = 0
  private controller: AbortController | null = null
  private pending: Promise<void> | null = null
  private request: PlayerRequester
  constructor(request: PlayerRequester = playerRequest) {
    this.request = request
    this.root.className = 'player-name-form'
    this.root.hidden = true
    const label = document.createElement('label')
    label.textContent = 'Your display name '
    this.input.type = 'text'
    this.input.name = 'display-name'
    this.input.maxLength = 16
    this.input.minLength = 3
    this.input.pattern = '[A-Za-z][A-Za-z0-9_]{2,15}'
    this.input.required = true
    this.input.autocomplete = 'off'
    this.input.spellcheck = false
    this.input.placeholder = 'NightDriver'
    label.append(this.input)
    const help = document.createElement('p')
    help.textContent = 'No signup. We add a unique #tag. Your name stays in this browser; clearing cookies or using another browser creates a new tag. Name changes are limited to once every 30 days.'
    this.status.setAttribute('role', 'status')
    this.save.type = 'submit'
    this.save.textContent = 'Save name'
    this.root.append(label, help, this.save, this.status)
    this.root.addEventListener('submit', event => {
      event.preventDefault()
      void this.ensure().catch(error => { if (!this.root.hidden) this.status.textContent = error instanceof Error ? error.message : 'Could not save your name.' })
    })
  }
  get active(): boolean { return !this.root.hidden }
  async show(signal: AbortSignal): Promise<void> {
    const generation = this.generation
    this.root.hidden = false
    this.controller = new AbortController()
    this.save.disabled = true
    this.input.disabled = true
    this.status.textContent = 'Loading your name…'
    try {
      const data = await this.request(undefined, AbortSignal.any([signal, this.controller.signal]))
      if (generation !== this.generation) return
      if (data.profile !== null && !isProfile(data.profile)) throw new Error('Could not load your name. Please try again.')
      this.profile = data.profile as PlayerProfile | null
      this.input.value = this.profile?.username ?? ''
      this.status.textContent = this.profile?.needsRename ? 'Your previous name was removed. Choose a new one to submit.' : this.profile ? `Playing as ${displayName(this.profile)}` : 'Choose a family-friendly name. Your tag is assigned when you save.'
    } catch (error) {
      if (generation === this.generation) this.status.textContent = error instanceof Error ? error.message : 'Could not load your name.'
    } finally {
      if (generation === this.generation) { this.save.disabled = false; this.input.disabled = false }
    }
  }
  hide(): void {
    this.generation++
    this.controller?.abort()
    this.controller = null
    this.root.hidden = true
    this.input.value = ''
    this.input.disabled = false
    this.profile = null
    this.pending = null
  }
  ensure(): Promise<void> {
    if (this.pending) return this.pending
    const generation = this.generation
    this.pending = this.claim(generation).finally(() => { if (generation === this.generation) this.pending = null })
    return this.pending
  }
  private async claim(generation: number): Promise<void> {
    if (!isUsername(this.input.value)) { this.input.focus(); throw new Error(messages.name_format) }
    if (this.profile?.username === this.input.value && !this.profile.needsRename) return
    this.save.disabled = true
    this.input.disabled = true
    this.status.textContent = 'Saving your name…'
    try {
      const data = await this.request({ action: 'claim', username: this.input.value }, this.controller?.signal)
      if (generation !== this.generation) return
      if (!isProfile(data.profile) || !data.profile.username || data.profile.needsRename) throw new Error('Name response unavailable. Please try again.')
      this.profile = data.profile
      this.input.value = this.profile.username ?? ''
      this.status.textContent = `Playing as ${displayName(this.profile)}`
    } catch (error) {
      if (generation === this.generation) this.status.textContent = error instanceof Error ? error.message : 'Could not save your name.'
      throw error
    } finally { if (generation === this.generation) { this.save.disabled = false; this.input.disabled = false } }
  }
}

export function reportName(playerId: string, alias: string, request: PlayerRequester = playerRequest): HTMLDialogElement {
  const dialog = document.createElement('dialog')
  dialog.className = 'name-report-dialog'
  dialog.setAttribute('aria-label', `Report ${alias}`)
  const heading = document.createElement('h3')
  heading.textContent = `Report ${alias}`
  const label = document.createElement('label')
  label.textContent = 'Reason '
  const reason = document.createElement('select')
  for (const value of REPORT_REASONS) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = ({ profanity: 'Profanity', hate: 'Hate or harassment', impersonation: 'Impersonation', other: 'Other inappropriate name' })[value]
    reason.append(option)
  }
  label.append(reason)
  const status = document.createElement('p')
  status.setAttribute('role', 'status')
  const send = document.createElement('button')
  send.type = 'button'
  send.textContent = 'Send report'
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  send.addEventListener('click', () => {
    send.disabled = true
    void request({ action: 'report', playerId, reason: reason.value as ReportReason }).then(() => {
      status.textContent = 'Report sent. Thank you.'
    }).catch(error => { status.textContent = error instanceof Error ? error.message : 'Could not send report.'; send.disabled = false })
  })
  dialog.append(heading, label, send, close, status)
  return dialog
}
