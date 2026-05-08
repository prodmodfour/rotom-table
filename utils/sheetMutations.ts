import { deepCloneJson } from './serialization'
import { pokemonHpSnapshot, trainerHpSnapshot } from './sheetSpawn'
import { clampHpValue } from './ptuHp'
import { COMBAT_STAT_STAGE_KEYS, normalizeCombatStages as normalizeCombatStageMap } from './combatStages'
import { normalizeConditionNames } from './statusConditions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetKind, SheetPlacement } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export type AnyLiveSheet = CharacterSheet | TrainerSheet

export interface SheetLookupMaps {
  pokemon: Map<string, CharacterSheet>
  trainer: Map<string, TrainerSheet>
}

export type PlacementSheetUpdater = (kind: SheetKind, sheet: AnyLiveSheet) => AnyLiveSheet

export type SheetUpdateContext =
  | {
    kind: 'pokemon'
    slug: string
    sheets: Map<string, CharacterSheet>
    original: CharacterSheet
    updated: CharacterSheet
  }
  | {
    kind: 'trainer'
    slug: string
    sheets: Map<string, TrainerSheet>
    original: TrainerSheet
    updated: TrainerSheet
  }

export const getSheetForPlacement = (
  placement: SheetPlacement,
  lookups: SheetLookupMaps,
): AnyLiveSheet | null => {
  if (placement.sheetKind === 'pokemon') return lookups.pokemon.get(placement.sheetSlug) ?? null
  return lookups.trainer.get(placement.sheetSlug) ?? null
}

export const createSheetUpdateForPlacement = (
  placement: SheetPlacement,
  lookups: SheetLookupMaps,
  update: PlacementSheetUpdater,
): SheetUpdateContext | null => {
  if (placement.sheetKind === 'pokemon') {
    const original = lookups.pokemon.get(placement.sheetSlug)
    if (!original) return null
    return {
      kind: 'pokemon',
      slug: placement.sheetSlug,
      sheets: lookups.pokemon,
      original,
      updated: update('pokemon', original) as CharacterSheet,
    }
  }

  const original = lookups.trainer.get(placement.sheetSlug)
  if (!original) return null
  return {
    kind: 'trainer',
    slug: placement.sheetSlug,
    sheets: lookups.trainer,
    original,
    updated: update('trainer', original) as TrainerSheet,
  }
}

export const commitSheetUpdate = (context: SheetUpdateContext): void => {
  if (context.kind === 'pokemon') context.sheets.set(context.slug, context.updated)
  else context.sheets.set(context.slug, context.updated)
}

export const rollbackSheetUpdate = (context: SheetUpdateContext): void => {
  if (context.kind === 'pokemon') context.sheets.set(context.slug, context.original)
  else context.sheets.set(context.slug, context.original)
}

export const applyHpToSheet = (
  kind: SheetKind,
  sheet: AnyLiveSheet,
  currentHp: number,
): AnyLiveSheet => {
  if (kind === 'pokemon') {
    const original = sheet as CharacterSheet
    const updated = deepCloneJson(original)
    updated.combat = {
      ...(updated.combat ?? {}),
      currentHp: clampHpValue(currentHp, pokemonHpSnapshot(original).maxHp),
    }
    return updated
  }

  const original = sheet as TrainerSheet
  const updated = deepCloneJson(original)
  updated.currentHp = clampHpValue(currentHp, trainerHpSnapshot(original).maxHp)
  return updated
}

export const applyCombatStagesToSheet = (
  kind: SheetKind,
  sheet: AnyLiveSheet,
  stages: CombatStageMap,
): AnyLiveSheet => {
  const normalized = normalizeCombatStageMap(stages)
  const updated = deepCloneJson(sheet)
  updated.stats = { ...(updated.stats ?? {}) }
  for (const key of COMBAT_STAT_STAGE_KEYS) {
    updated.stats[key] = { ...(updated.stats[key] ?? {}), stage: normalized[key] }
  }
  updated.combatStages = { ...(updated.combatStages ?? {}), acc: normalized.acc }
  return kind === 'pokemon' ? updated as CharacterSheet : updated as TrainerSheet
}

export const applyConditionsToSheet = (
  kind: SheetKind,
  sheet: AnyLiveSheet,
  conditions: string[],
): AnyLiveSheet => {
  const normalized = normalizeConditionNames(conditions)
  if (kind === 'pokemon') {
    const updated = deepCloneJson(sheet as CharacterSheet)
    updated.combat = { ...(updated.combat ?? {}), conditions: normalized }
    return updated
  }

  const updated = deepCloneJson(sheet as TrainerSheet)
  updated.conditions = normalized
  return updated
}

export const toPersistableSheetPayload = (sheet: AnyLiveSheet): Record<string, unknown> => {
  const payload: Record<string, unknown> = { ...(sheet as unknown as Record<string, unknown>) }
  delete payload.folder
  return payload
}
