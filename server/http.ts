export class RequestError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code }
}
export function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(status === 429 ? { 'Retry-After': '3600' } : {}),
  } })
}
export function checkOrigin(req: Request): void {
  const origin = req.headers.get('origin')
  if ((origin && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') throw new RequestError(403, 'origin')
}
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') throw new RequestError(415, 'content_type')
  const reader = req.body?.getReader()
  if (!reader) throw new RequestError(400, 'invalid_request')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2048) { await reader.cancel(); throw new RequestError(413, 'body_too_large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid')
    return body as Record<string, unknown>
  } catch { throw new RequestError(400, 'invalid_request') }
}
export function exactFields(body: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(body).sort().join(',') !== [...fields].sort().join(',')) throw new RequestError(400, 'invalid_request')
}
