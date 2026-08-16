import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import { stableJsonStringify } from '../serialization'

type DerivedSheetRuntimeField =
  | 'folder'
  | 'sessionPlayerAccessible'
  | 'playerProfileAccessible'
  | 'equipmentProjection'
  | 'equipmentContributionProjection'
  | 'itemMedicalTreatmentProjection'
  | 'itemExplorationProjection'

const DERIVED_SHEET_RUNTIME_FIELDS = [
  'folder',
  'sessionPlayerAccessible',
  'playerProfileAccessible',
  'equipmentProjection',
  'equipmentContributionProjection',
  'itemMedicalTreatmentProjection',
  'itemExplorationProjection',
] as const satisfies readonly DerivedSheetRuntimeField[]

/**
 * Sheet `folder` values, temporary player-access markers, and safe equipment
 * projections, equipment contribution inspectors, and medical treatment status are derived from runtime
 * API context and must not be persisted.
 * Historical `abilities[].activated` bytes remain readable on load, but AA-110
 * retired that browser-owned mechanic and all current write paths strip it.
 * The source sheet and its nested Ability rows are never mutated.
 */
export const stripDerivedSheetRuntimeFields = <T extends object>(sheet: T): Omit<T, DerivedSheetRuntimeField> => {
  const payload = { ...sheet } as Record<string, unknown>
  for (const field of DERIVED_SHEET_RUNTIME_FIELDS) delete payload[field]
  if (Array.isArray(payload.abilities)) {
    payload.abilities = payload.abilities.map((ability) => {
      if (ability === null || typeof ability !== 'object' || Array.isArray(ability)) return ability
      const persisted = { ...(ability as Record<string, unknown>) }
      delete persisted.activated
      return persisted
    })
  }
  return payload as Omit<T, DerivedSheetRuntimeField>
}

export const stripDerivedSheetFolder = stripDerivedSheetRuntimeFields

export const toPersistableSheetPayload = <T extends object>(sheet: T): Record<string, unknown> => {
  const payload = stripDerivedSheetRuntimeFields(sheet) as Record<string, unknown>
  payload.revision = normalizeRevision(payload.revision)
  return payload
}

export const toNextRevisionSheetPayload = <T extends object>(sheet: T): Record<string, unknown> => {
  const payload = toPersistableSheetPayload(sheet)
  payload.revision = nextRevision(payload.revision as number)
  return payload
}

export const stablePersistableSheetJson = <T extends object>(sheet: T): string =>
  stableJsonStringify(toPersistableSheetPayload(sheet))
