import spriteManifestJson from '~~/data/itemSpriteManifest.json'
import { findItem, toSlug } from '~~/data/ptuReference'
import type { PtuItem } from '~/types/ptuReference'

const spriteManifest = spriteManifestJson as Record<string, string>

const present = (value: string | null | undefined): value is string => Boolean(value?.trim())

const stripInventoryCount = (raw: string): string => raw
  .replace(/^\s*\d+\s*[×x]\s*/i, '')
  .replace(/\s*[×x]\s*\d+\s*$/i, '')
  .trim()

const pluralAlternates = (raw: string): string[] => {
  const trimmed = raw.trim()
  if (!trimmed) return []
  const alternates: string[] = []
  if (/\bBerries$/i.test(trimmed)) alternates.push(trimmed.replace(/\bBerries$/i, 'Berry'))
  if (/\bApricorns$/i.test(trimmed)) alternates.push(trimmed.replace(/\bApricorns$/i, 'Apricorn'))
  return alternates
}

const lookupSprite = (raw: string | null | undefined): string | null => {
  if (!present(raw)) return null
  return spriteManifest[toSlug(raw)] ?? null
}

export type ItemSpriteInput = string | PtuItem | null | undefined

export const itemSpriteUrl = (item: ItemSpriteInput): string | null => {
  const rawName = typeof item === 'string' ? item : item?.name
  const cleanedName = present(rawName) ? stripInventoryCount(rawName) : ''

  const directCandidates = [rawName, cleanedName, ...pluralAlternates(cleanedName)]
    .filter(present)

  for (const candidate of directCandidates) {
    const direct = lookupSprite(candidate)
    if (direct) return direct
  }

  const reference = typeof item === 'string'
    ? (present(cleanedName) ? findItem(cleanedName) : null)
    : item

  if (!reference) return null

  const referenceCandidates = [reference.name, ...(reference.aliases ?? [])]
  for (const candidate of referenceCandidates) {
    const sprite = lookupSprite(candidate)
    if (sprite) return sprite
  }

  return null
}
