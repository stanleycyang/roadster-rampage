import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto'

export function playerIdFor(token: string, secret: string): string {
  return createHmac('sha256', secret).update(`anonymous-player:v1:${token}`).digest('hex')
}
function cookieName(req: Request): string {
  const url = new URL(req.url)
  // The insecure variant is strictly for loopback development.
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  return local ? 'roadster-player-local' : '__Host-Http-roadster-player'
}
export function readPlayerToken(req: Request): string | null {
  const name = cookieName(req)
  const matches = (req.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`))
  if (matches.length !== 1) return null
  const token = matches[0]!.slice(name.length + 1)
  return /^[a-f0-9]{64}$/.test(token) ? token : null
}
export function newPlayerToken(): string { return randomBytes(32).toString('hex') }
export function rememberPlayer(req: Request, response: Response, token: string): Response {
  const name = cookieName(req)
  response.headers.set('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${name.startsWith('__Host-') ? '; Secure' : ''}`)
  return response
}
export function isModerator(req: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return false
  const supplied = req.headers.get('authorization')
  if (!supplied?.startsWith('Bearer ') || supplied.length > 512) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(supplied.slice(7)), digest(secret))
}
