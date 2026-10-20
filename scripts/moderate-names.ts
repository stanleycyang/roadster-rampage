import { readFile } from 'node:fs/promises'
import { isUsername, PLAYER_ID_PATTERN, TAG_PATTERN } from '../shared/player.ts'
// Use a private environment variable; never place moderation secrets in arguments.
const [action, reportFile] = process.argv.slice(2)
const endpoint = process.env.PLAYER_MODERATION_URL
const secret = process.env.PLAYER_MODERATION_SECRET
if (!endpoint || !secret || !['reports', 'moderate'].includes(action ?? '') || (action === 'moderate' && !reportFile)) {
  console.error('Set PLAYER_MODERATION_URL=https://your-domain/api/player and PLAYER_MODERATION_SECRET. Run: node scripts/moderate-names.ts reports | moderate <reviewed-report.json>')
  process.exitCode = 1
} else {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.pathname !== '/api/player' || url.username || url.password || url.search || url.hash) throw new Error('Use the exact HTTPS /api/player endpoint')
  let body: object = { action }
  if (action === 'moderate') {
    const report = JSON.parse(await readFile(reportFile!, 'utf8'))
    if (!report || typeof report !== 'object' || typeof report.playerId !== 'string' || !PLAYER_ID_PATTERN.test(report.playerId) || !isUsername(report.username) || typeof report.tag !== 'string' || !TAG_PATTERN.test(report.tag) || !Number.isSafeInteger(report.nameChangedAt) || report.nameChangedAt < 0) throw new Error('Use one complete, reviewed report object from the reports response')
    body = { action, playerId: report.playerId, username: report.username, tag: report.tag, nameChangedAt: report.nameChangedAt }
  }
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
  if (!response.ok) { console.error(response.status === 409 ? 'The player changed names after this report. Review the current queue before taking action.' : `Moderation request failed (${response.status})`); process.exitCode = 1 }
  else console.log(JSON.stringify(await response.json(), null, 2))
}
