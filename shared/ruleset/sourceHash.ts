const sourceBytes = (sourceData: string | Uint8Array): Uint8Array<ArrayBuffer> => {
  if (typeof sourceData === 'string') return new TextEncoder().encode(sourceData)
  const copy = new Uint8Array(new ArrayBuffer(sourceData.byteLength))
  copy.set(sourceData)
  return copy
}

/** Compute a lowercase SHA-256 digest without retaining caller-owned bytes. */
export const computeRulesetSourceSha256 = async (
  sourceData: string | Uint8Array,
): Promise<string> => {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable in this runtime.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', sourceBytes(sourceData))
  return Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('')
}
