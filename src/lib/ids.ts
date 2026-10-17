/**
 * Client-generated idempotency ids.
 *
 * A request id is generated once per submission attempt and reused for every
 * retry of that attempt, so a lost response can never charge a team twice.
 * It must satisfy the server pattern `^[A-Za-z0-9_-]{8,72}$`.
 */

export function newRequestId(): string {
  const globalCrypto = typeof crypto !== 'undefined' ? crypto : undefined
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return `req_${globalCrypto.randomUUID().replace(/-/g, '')}`
  }
  const bytes = new Uint8Array(16)
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    globalCrypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `req_${Date.now().toString(36)}${hex}`
}
