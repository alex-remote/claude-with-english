// The keys of the caches and the word book: a text's hash, so a key never
// depends on whether a `requestId` or `uuid` survives `/resume`
// (docs/dev-plan.md, 状态和存储). Synchronous, unlike `crypto.subtle`, so
// code that must not wait (a render, prompt.edit's 50 ms) can make a key.

/** cyrb53: two 32-bit lanes of multiply-xor, 53 bits of them kept. */
export function cyrb53(text: string, seed = 0): { high: number; low: number } {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return { high: (h2 >>> 0) & 0x1fffff, low: h1 >>> 0 }
}

/**
 * A text's hash as 14 hex digits. The 32-bit lane comes first, so the
 * first two digits, which name a cache's subfolder, spread evenly.
 */
export function hash(text: string, seed = 0): string {
  const { high, low } = cyrb53(text, seed)
  return low.toString(16).padStart(8, '0') + high.toString(16).padStart(6, '0')
}

/** One hash of several values: ('a', 'bc') and ('ab', 'c') differ. */
export function hashParts(parts: readonly string[], seed = 0): string {
  return hash(JSON.stringify(parts), seed)
}
