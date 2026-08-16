const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

/**
 * Exact reviewed identity key. This intentionally performs only Unicode and
 * apostrophe canonicalization plus case folding; punctuation, spacing, and
 * wording are not fuzzily collapsed.
 */
export const normalizeItemAliasIdentity = (value: string): string => value
  .trim()
  .normalize('NFC')
  .replace(/[’]/g, "'")
  .toLocaleLowerCase('en-US')

export class ItemIdentityError extends Error {
  readonly code: 'missing' | 'ambiguous'

  constructor(code: ItemIdentityError['code'], message: string) {
    super(message)
    this.name = 'ItemIdentityError'
    this.code = code
  }
}

export interface ItemIdentityEntry {
  readonly canonicalId: string
  readonly aliases: readonly string[]
}

export interface ItemIdentityRegistry {
  readonly aliases: ReadonlyMap<string, string>
  resolve(value: string): string | null
  require(value: string): string
}

export const createItemIdentityRegistry = (
  entries: readonly ItemIdentityEntry[],
): ItemIdentityRegistry => {
  const aliases = new Map<string, string>()
  const canonicalIds = new Set<string>()
  for (const entry of entries) {
    if (!entry.canonicalId.trim() || CONTROL_CHARACTER_PATTERN.test(entry.canonicalId)) {
      throw new ItemIdentityError('missing', 'Item canonical IDs must be non-blank and free of control characters.')
    }
    if (canonicalIds.has(entry.canonicalId)) {
      throw new ItemIdentityError('ambiguous', `Canonical item identity ${entry.canonicalId} is duplicated.`)
    }
    canonicalIds.add(entry.canonicalId)
    for (const raw of [entry.canonicalId, ...entry.aliases]) {
      const key = normalizeItemAliasIdentity(raw)
      if (!key || CONTROL_CHARACTER_PATTERN.test(raw)) {
        throw new ItemIdentityError('missing', `Item alias for ${entry.canonicalId} must be non-blank and free of control characters.`)
      }
      const previous = aliases.get(key)
      if (previous && previous !== entry.canonicalId) {
        throw new ItemIdentityError('ambiguous', `Item alias ${raw} resolves to both ${previous} and ${entry.canonicalId}.`)
      }
      aliases.set(key, entry.canonicalId)
    }
  }
  const resolve = (value: string): string | null => aliases.get(normalizeItemAliasIdentity(value)) ?? null
  return {
    aliases,
    resolve,
    require: (value) => resolve(value) ?? (() => { throw new ItemIdentityError('missing', `Unknown canonical item identity: ${value}`) })(),
  }
}
