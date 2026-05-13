import type { CharacterSheetMove } from '~/types/characterSheet'

export const BASE_STRUGGLE_MOVE_NAME = 'Struggle'

export interface StruggleCapabilityVariant {
  capability: string
  aliases?: readonly string[]
  moveName: string
}

export const STRUGGLE_CAPABILITY_VARIANTS: readonly StruggleCapabilityVariant[] = [
  { capability: 'Firestarter', moveName: 'Struggle (Firestarter)' },
  { capability: 'Fountain', moveName: 'Struggle (Fountain)' },
  { capability: 'Freezer', moveName: 'Struggle (Freezer)' },
  { capability: 'Guster', moveName: 'Struggle (Guster)' },
  { capability: 'Materializer', aliases: ['Materialiser'], moveName: 'Struggle (Materializer)' },
  { capability: 'Telekinetic', moveName: 'Struggle (Telekinetic)' },
  { capability: 'Zapper', moveName: 'Struggle (Zapper)' },
]

const stripCapabilityParams = (raw: string): string =>
  raw
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+\d+(?:\/\d+)?\s*$/g, '')
    .trim()

const normalizeToken = (raw: string): string =>
  raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

const normalizeCapabilityKey = (raw: string): string => {
  const key = normalizeToken(stripCapabilityParams(raw))
  return key === 'materialiser' ? 'materializer' : key
}

const normalizeMoveKey = (raw: string): string => {
  const key = normalizeToken(raw)
  return key.replace('materialiser', 'materializer')
}

export const struggleMoveNamesForCapabilities = (
  capabilities: readonly string[] | undefined,
): string[] => {
  const capabilityKeys = new Set((capabilities ?? []).map(normalizeCapabilityKey).filter(Boolean))
  const moveNames = [BASE_STRUGGLE_MOVE_NAME]

  for (const variant of STRUGGLE_CAPABILITY_VARIANTS) {
    const keys = [variant.capability, ...(variant.aliases ?? [])].map(normalizeCapabilityKey)
    if (keys.some((key) => capabilityKeys.has(key))) moveNames.push(variant.moveName)
  }

  return moveNames
}

export const makeAutomaticStruggleMoves = <T extends Pick<CharacterSheetMove, 'name'> = CharacterSheetMove>(
  capabilities: readonly string[] | undefined,
  existingMoves: readonly Pick<T, 'name'>[] | undefined,
): T[] => {
  const existingMoveKeys = new Set(
    (existingMoves ?? []).map((move) => normalizeMoveKey(move.name ?? '')).filter(Boolean),
  )

  return struggleMoveNamesForCapabilities(capabilities)
    .filter((name) => !existingMoveKeys.has(normalizeMoveKey(name)))
    .map((name) => ({ name }) as T)
}
