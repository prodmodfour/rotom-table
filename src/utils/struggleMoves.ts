import type { CharacterSheetMove } from '~/types/characterSheet'

export const BASE_STRUGGLE_MOVE_NAME = 'Struggle'

export interface StruggleCapabilityVariant {
  capability: string
  aliases?: readonly string[]
  moveNames: readonly string[]
}

const physicalAndSpecialStruggleMoveNames = (capability: string): readonly string[] => [
  `Struggle (${capability} Physical)`,
  `Struggle (${capability} Special)`,
]

export const STRUGGLE_CAPABILITY_VARIANTS: readonly StruggleCapabilityVariant[] = [
  { capability: 'Firestarter', moveNames: physicalAndSpecialStruggleMoveNames('Firestarter') },
  { capability: 'Fountain', moveNames: physicalAndSpecialStruggleMoveNames('Fountain') },
  { capability: 'Freezer', moveNames: physicalAndSpecialStruggleMoveNames('Freezer') },
  { capability: 'Guster', moveNames: physicalAndSpecialStruggleMoveNames('Guster') },
  { capability: 'Materializer', aliases: ['Materialiser'], moveNames: physicalAndSpecialStruggleMoveNames('Materializer') },
  { capability: 'Telekinetic', moveNames: physicalAndSpecialStruggleMoveNames('Telekinetic') },
  { capability: 'Zapper', moveNames: physicalAndSpecialStruggleMoveNames('Zapper') },
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

const LEGACY_SPECIAL_STRUGGLE_MOVE_KEYS: Record<string, string> = {
  strugglefirestarter: 'strugglefirestarterspecial',
  strugglefountain: 'strugglefountainspecial',
  strugglefreezer: 'strugglefreezerspecial',
  struggleguster: 'strugglegusterspecial',
  strugglematerializer: 'strugglematerializerspecial',
  struggletelekinetic: 'struggletelekineticspecial',
  strugglezapper: 'strugglezapperspecial',
}

const normalizeMoveKey = (raw: string): string => {
  const key = normalizeToken(raw).replace('materialiser', 'materializer')
  return LEGACY_SPECIAL_STRUGGLE_MOVE_KEYS[key] ?? key
}

export const struggleMoveNamesForCapabilities = (
  capabilities: readonly string[] | undefined,
): string[] => {
  const capabilityKeys = new Set((capabilities ?? []).map(normalizeCapabilityKey).filter(Boolean))
  const moveNames = [BASE_STRUGGLE_MOVE_NAME]

  for (const variant of STRUGGLE_CAPABILITY_VARIANTS) {
    const keys = [variant.capability, ...(variant.aliases ?? [])].map(normalizeCapabilityKey)
    if (keys.some((key) => capabilityKeys.has(key))) moveNames.push(...variant.moveNames)
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
