// Use a private environment variable; never place moderation secrets in arguments.
const [action, playerId] = process.argv.slice(2)
const endpoint = process.env.PLAYER_MODERATION_URL
const secret = process.env.PLAYER_MODERATION_SECRET
if (!endpoint || !secret || !['reports', 'moderate'].includes(action ?? '') || (action === 'moderate' && !/^[a-f0-9]{64}$/.test(playerId ?? ''))) {
  console.error('Set PLAYER_MODERATION_URL=https://your-domain/api/player and PLAYER_MODERATION_SECRET. Run: node scripts/moderate-names.ts reports | moderate <playerId>')
  process.exitCode = 1
} else {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.pathname !== '/api/player' || url.username || url.password || url.search || url.hash) throw new Error('Use the exact HTTPS /api/player endpoint')
  const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'reports' ? { action } : { action, playerId }), signal: AbortSignal.timeout(10000) })
  if (!response.ok) { console.error(`Moderation request failed (${response.status})`); process.exitCode = 1 }
  else console.log(JSON.stringify(await response.json(), null, 2))
}
