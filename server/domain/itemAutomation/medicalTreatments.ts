import { createHash } from 'node:crypto'
import {
  ITEM_MEDICAL_TREATMENT_DURATION_MINUTES,
  ITEM_MEDICAL_TREATMENT_MAX_ENTRIES,
  ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION,
  ITEM_MEDICAL_TREATMENT_TICK_MINUTES,
  activeItemMedicalTreatment,
  parseItemMedicalTreatmentProjection,
  parseItemMedicalTreatmentState,
  type ItemMedicalTreatmentProjectionV1,
  type ItemMedicalTreatmentV1,
} from '#shared/itemAutomation/medicalTreatments'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import {
  computePokemonHealingVitals,
  computeTrainerHealingVitals,
  healPokemonHp,
  healTrainerHp,
  healingFractionAmount,
  removePokemonInjuries,
  removeTrainerInjuries,
} from '~/utils/sheets/healing'

export type MedicalTreatmentSheet = CharacterSheet | TrainerSheet

const minute = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a safe non-negative campaign minute.`)
  return value
}

const sheetHp = (kind: SheetKind, sheet: MedicalTreatmentSheet): number => kind === 'pokemon'
  ? computePokemonHealingVitals(sheet as CharacterSheet).currentHp
  : computeTrainerHealingVitals(sheet as TrainerSheet).currentHp

const stateOn = (sheet: MedicalTreatmentSheet) => parseItemMedicalTreatmentState(sheet.itemMedicalTreatments)

export const itemMedicalTreatmentId = (input: {
  readonly operationId: string
  readonly targetKind: SheetKind
  readonly targetSlug: string
}): string => `item-treatment:v1:${createHash('sha256')
  .update(`${input.operationId}\u0000${input.targetKind}\u0000${input.targetSlug}`)
  .digest('hex').slice(0, 32)}`

export const applyBandageTreatment = (input: {
  readonly sheetKind: SheetKind
  readonly sheet: MedicalTreatmentSheet
  readonly targetSlug: string
  readonly operationId: string
  readonly canonicalItemId?: 'Bandages' | 'Poultices'
  readonly canonicalDefinitionSha256: string
  readonly campaignMinute: number
}): MedicalTreatmentSheet => {
  const appliedAt = minute(input.campaignMinute, 'Bandage treatment campaign minute')
  if (input.sheet.slug !== input.targetSlug) throw new Error('Bandage treatment target does not match the authoritative sheet.')
  const state = stateOn(input.sheet)
  if (activeItemMedicalTreatment(state)) throw new Error('This target already has an active medical treatment.')
  // Accepted item-operation receipts retain immutable origin evidence. Keep the
  // sheet-local lifecycle projection bounded by dropping only the oldest
  // terminal rows; an active row is never pruned or replaced.
  const retainedEntries = state.entries.length < ITEM_MEDICAL_TREATMENT_MAX_ENTRIES
    ? [...state.entries]
    : [...state.entries]
        .sort((left, right) => left.appliedAtCampaignMinute - right.appliedAtCampaignMinute
          || left.treatmentId.localeCompare(right.treatmentId))
        .slice(-(ITEM_MEDICAL_TREATMENT_MAX_ENTRIES - 1))
  const treatment: ItemMedicalTreatmentV1 = {
    schemaVersion: ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION,
    treatmentId: itemMedicalTreatmentId({
      operationId: input.operationId,
      targetKind: input.sheetKind,
      targetSlug: input.targetSlug,
    }),
    revision: 0,
    canonicalItemId: input.canonicalItemId ?? 'Bandages',
    canonicalDefinitionSha256: input.canonicalDefinitionSha256,
    sourceOperationId: input.operationId,
    target: { kind: input.sheetKind, slug: input.targetSlug },
    status: 'active',
    appliedAtCampaignMinute: appliedAt,
    nextTickCampaignMinute: appliedAt + ITEM_MEDICAL_TREATMENT_TICK_MINUTES,
    endsAtCampaignMinute: appliedAt + ITEM_MEDICAL_TREATMENT_DURATION_MINUTES,
    healedThroughCampaignMinute: appliedAt,
    ticksApplied: 0,
    hitPointsRestored: 0,
    injuryRemoved: false,
    terminalReason: null,
    terminalCampaignMinute: null,
  }
  const next = deepCloneJson(input.sheet)
  next.itemMedicalTreatments = parseItemMedicalTreatmentState({
    schemaVersion: ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION,
    entries: [...retainedEntries, treatment],
  })
  return next
}

export interface AdvanceBandageTreatmentResult {
  readonly sheet: MedicalTreatmentSheet
  readonly changed: boolean
  readonly ticksApplied: number
  readonly hitPointsRestored: number
  readonly injuriesRemoved: number
  readonly completedTreatmentIds: readonly string[]
}

/**
 * Materialize every due half-hour boundary. The caller owns campaign-clock and
 * sheet revision revalidation and must commit this result in the same transaction.
 * A due tick is counted even at the HP cap or while 5+ Injuries prohibit natural healing.
 */
export const advanceBandageTreatmentsToCampaignMinute = (input: {
  readonly sheetKind: SheetKind
  readonly sheet: MedicalTreatmentSheet
  readonly campaignMinute: number
}): AdvanceBandageTreatmentResult => {
  const now = minute(input.campaignMinute, 'Medical treatment settlement minute')
  const state = stateOn(input.sheet)
  const active = state.entries.find(entry => entry.status === 'active')
  if (!active || now < active.nextTickCampaignMinute) return Object.freeze({
    sheet: deepCloneJson(input.sheet), changed: false, ticksApplied: 0,
    hitPointsRestored: 0, injuriesRemoved: 0, completedTreatmentIds: Object.freeze([]),
  })
  if (active.target.kind !== input.sheetKind || active.target.slug !== input.sheet.slug) {
    throw new Error('Medical treatment target evidence does not match its containing sheet.')
  }
  const targetTickCount = Math.min(
    ITEM_MEDICAL_TREATMENT_DURATION_MINUTES / ITEM_MEDICAL_TREATMENT_TICK_MINUTES,
    Math.floor((Math.min(now, active.endsAtCampaignMinute) - active.appliedAtCampaignMinute)
      / ITEM_MEDICAL_TREATMENT_TICK_MINUTES),
  )
  if (targetTickCount <= active.ticksApplied) return Object.freeze({
    sheet: deepCloneJson(input.sheet), changed: false, ticksApplied: 0,
    hitPointsRestored: 0, injuriesRemoved: 0, completedTreatmentIds: Object.freeze([]),
  })
  const next = deepCloneJson(input.sheet)
  const dueTicks = targetTickCount - active.ticksApplied
  let restored = 0
  for (let index = 0; index < dueTicks; index += 1) {
    const vitals = input.sheetKind === 'pokemon'
      ? computePokemonHealingVitals(next as CharacterSheet)
      : computeTrainerHealingVitals(next as TrainerSheet)
    if (vitals.injuries >= 5) continue
    const amount = healingFractionAmount(vitals.fullMaxHp, 8)
    const before = vitals.currentHp
    if (input.sheetKind === 'pokemon') healPokemonHp(next as CharacterSheet, amount)
    else healTrainerHp(next as TrainerSheet, amount)
    restored += Math.max(0, sheetHp(input.sheetKind, next) - before)
  }
  const completed = targetTickCount === ITEM_MEDICAL_TREATMENT_DURATION_MINUTES
    / ITEM_MEDICAL_TREATMENT_TICK_MINUTES
  let injuriesRemoved = 0
  if (completed) {
    injuriesRemoved = input.sheetKind === 'pokemon'
      ? removePokemonInjuries(next as CharacterSheet, 1)
      : removeTrainerInjuries(next as TrainerSheet, 1)
  }
  const updated: ItemMedicalTreatmentV1 = {
    ...active,
    revision: active.revision + 1,
    status: completed ? 'completed' : 'active',
    nextTickCampaignMinute: active.appliedAtCampaignMinute
      + ITEM_MEDICAL_TREATMENT_TICK_MINUTES * (targetTickCount + 1),
    healedThroughCampaignMinute: active.appliedAtCampaignMinute
      + ITEM_MEDICAL_TREATMENT_TICK_MINUTES * targetTickCount,
    ticksApplied: targetTickCount,
    hitPointsRestored: active.hitPointsRestored + restored,
    injuryRemoved: active.injuryRemoved || injuriesRemoved > 0,
    terminalReason: completed ? 'full-duration' : null,
    terminalCampaignMinute: completed ? active.endsAtCampaignMinute : null,
  }
  next.itemMedicalTreatments = parseItemMedicalTreatmentState({
    schemaVersion: ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION,
    entries: state.entries.map(entry => entry.treatmentId === active.treatmentId ? updated : entry),
  })
  return Object.freeze({
    sheet: next,
    changed: true,
    ticksApplied: dueTicks,
    hitPointsRestored: restored,
    injuriesRemoved,
    completedTreatmentIds: Object.freeze(completed ? [active.treatmentId] : []),
  })
}

/** Apply the canonical immediate-stop boundary to a server-authored HP loss. */
export const cancelBandageTreatmentOnHpLoss = (input: {
  readonly sheetKind: SheetKind
  readonly previousSheet: MedicalTreatmentSheet
  readonly nextSheet: MedicalTreatmentSheet
  readonly campaignMinute: number
}): MedicalTreatmentSheet => {
  const now = minute(input.campaignMinute, 'Medical treatment cancellation minute')
  const state = stateOn(input.previousSheet)
  const active = state.entries.find(entry => entry.status === 'active')
  if (!active || sheetHp(input.sheetKind, input.nextSheet) >= sheetHp(input.sheetKind, input.previousSheet)) {
    const unchanged = deepCloneJson(input.nextSheet)
    if (state.entries.length) unchanged.itemMedicalTreatments = state
    else delete unchanged.itemMedicalTreatments
    return unchanged
  }
  if (now >= active.endsAtCampaignMinute) {
    throw new Error('Medical treatment time must be materialized before committing later HP loss.')
  }
  const cancelled: ItemMedicalTreatmentV1 = {
    ...active,
    revision: active.revision + 1,
    status: 'cancelled',
    terminalReason: 'hp-loss',
    terminalCampaignMinute: now,
  }
  const next = deepCloneJson(input.nextSheet)
  next.itemMedicalTreatments = parseItemMedicalTreatmentState({
    schemaVersion: ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION,
    entries: state.entries.map(entry => entry.treatmentId === active.treatmentId ? cancelled : entry),
  })
  return next
}

export const projectItemMedicalTreatments = (input: {
  readonly sheet: MedicalTreatmentSheet
  readonly campaignMinute: number
}): readonly ItemMedicalTreatmentProjectionV1[] => {
  const now = minute(input.campaignMinute, 'Medical treatment projection minute')
  return Object.freeze(stateOn(input.sheet).entries.map((entry) => parseItemMedicalTreatmentProjection({
    schemaVersion: ITEM_MEDICAL_TREATMENT_SCHEMA_VERSION,
    treatmentId: entry.treatmentId,
    revision: entry.revision,
    itemLabel: entry.canonicalItemId,
    status: entry.status,
    appliedAtCampaignMinute: entry.appliedAtCampaignMinute,
    nextTickCampaignMinute: entry.status === 'active' ? entry.nextTickCampaignMinute : null,
    endsAtCampaignMinute: entry.endsAtCampaignMinute,
    elapsedMinutes: Math.max(0, Math.min(ITEM_MEDICAL_TREATMENT_DURATION_MINUTES, now - entry.appliedAtCampaignMinute)),
    remainingMinutes: entry.status === 'active'
      ? Math.max(0, entry.endsAtCampaignMinute - now)
      : 0,
    ticksApplied: entry.ticksApplied,
    hitPointsRestored: entry.hitPointsRestored,
    injuryRemoved: entry.injuryRemoved,
    terminalMessage: entry.status === 'completed'
      ? `Bandages completed after 6 hours; ${entry.injuryRemoved ? '1 Injury was removed.' : 'the daily Injury limit or current state prevented Injury removal.'}`
      : entry.status === 'cancelled'
        ? 'Bandages stopped when the target lost HP.'
        : null,
  })))
}
