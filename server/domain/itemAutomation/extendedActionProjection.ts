import type { AuthRole } from '#shared/auth'
import { parseItemExtendedActionProjection, type ItemExtendedActionProjectionV1 } from '#shared/itemAutomation/extendedActions'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { computePokemonHealingVitals, computeTrainerHealingVitals } from '~/utils/sheets/healing'
import { resolvePokemonVitaminSummary } from '~/utils/sheets/pokemonVitamins'
import { computePokemonTutorPointsEarnedForSheet } from '~/utils/sheets/pokemonTutorPoints'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { sheetConditionNames } from '~/utils/sheetConditions'
import type { PersistedSheet } from '../../storage/sheetRepository'
import type { StoredItemExtendedActionRecord } from '../../storage/itemExtendedActionRepository'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'

export interface BuildItemExtendedActionProjectionInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly record: StoredItemExtendedActionRecord
  readonly sheets?: readonly PersistedSheet[]
  readonly unavailableReason?: string | null
}

export const canAccessItemExtendedAction = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly record: StoredItemExtendedActionRecord
}): boolean => input.role === 'gm' || playerProfileCanControlTokenSheet(
  input.playerProfile,
  'trainer',
  input.record.initialItemCommand.actorSheet.slug,
)

const displayLabel = (sheet: PersistedSheet | undefined, fallback: string): string => {
  if (!sheet) return fallback
  if (sheet.kind === 'trainer') return (sheet.sheet as unknown as TrainerSheet).name?.trim() || fallback
  const pokemon = sheet.sheet as unknown as CharacterSheet
  return pokemon.nickname?.trim() || pokemon.species?.trim() || fallback
}

const targetSummary = (
  sheet: PersistedSheet | undefined,
  permanentAdvancement: boolean,
  machineMoveLearning: boolean,
  dowsingSearch: boolean,
): string | null => {
  if (!sheet || dowsingSearch) return null
  try {
    if (machineMoveLearning && sheet.kind === 'pokemon') {
      const pokemon = sheet.sheet as unknown as CharacterSheet
      const available = computePokemonTutorPointsEarnedForSheet(pokemon) - (pokemon.tutorPoints?.spent ?? 0)
      return `${pokemon.movelist?.length ?? 0} active Moves · ${available} Tutor Points available`
    }
    if (permanentAdvancement && sheet.kind === 'pokemon') {
      const pokemon = sheet.sheet as unknown as CharacterSheet
      const summary = resolvePokemonVitaminSummary(pokemon)
      return `Level ${pokemon.level} · ${summary.vitaminSlotsUsed} / 5 vitamins used`
    }
    const vitals = sheet.kind === 'trainer'
      ? computeTrainerHealingVitals(sheet.sheet as unknown as TrainerSheet)
      : computePokemonHealingVitals(sheet.sheet as unknown as CharacterSheet)
    return `HP ${vitals.currentHp} / ${vitals.maxHp}`
  }
  catch { return null }
}

const targetConditions = (sheet: PersistedSheet | undefined): readonly string[] => {
  if (!sheet) return Object.freeze([])
  try {
    return Object.freeze(normalizeConditionNames(sheetConditionNames(
      sheet.kind,
      sheet.sheet as unknown as CharacterSheet | TrainerSheet,
    )).slice(0, 32))
  }
  catch { return Object.freeze([]) }
}

const completionCosts = (record: StoredItemExtendedActionRecord): readonly string[] => {
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(record.canonicalItemId)
  if (!definition || definition.definitionSha256 !== record.canonicalDefinitionSha256) {
    return Object.freeze(['Current reviewed definition required'])
  }
  const costs: string[] = []
  const skillCheck = definition.spec.effects.find(effect => (
    effect.operation === 'heal-hp' && effect.restoration.amount.kind === 'skill-check'
  ))
  if (skillCheck?.operation === 'heal-hp' && skillCheck.restoration.amount.kind === 'skill-check') {
    const labels: Readonly<Record<string, string>> = Object.freeze({ medicineEd: 'Medicine Education' })
    costs.push(`${labels[skillCheck.restoration.amount.skillId] ?? skillCheck.restoration.amount.skillId} check`)
  }
  for (const cost of definition.spec.costs) {
    if (cost.kind === 'ap') costs.push(`${cost.amount} AP on completion`)
    else costs.push(`${cost.label} on completion`)
  }
  const machine = definition.spec.effects.find(effect => effect.operation === 'learn-machine-move')
  const dowsing = definition.spec.effects.find(effect => effect.operation === 'search-for-shards')
  if (dowsing?.operation === 'search-for-shards') {
    costs.push(`${dowsing.searchMinutes} campaign minutes · reusable Dowsing Rod`)
  }
  else if (machine?.operation === 'learn-machine-move' && machine.machineKind === 'HM') {
    costs.push('Reusable HM · one use per campaign day')
  }
  else if (definition.spec.consumption.reusable) costs.push('Reusable kit')
  else if (definition.spec.consumption.phase === 'extended-action-completion') {
    costs.push(`${definition.spec.consumption.quantity} ${definition.spec.presentation.label} on completion`)
  }
  return Object.freeze(costs)
}

export const buildItemExtendedActionProjection = (
  input: BuildItemExtendedActionProjectionInput,
): ItemExtendedActionProjectionV1 => {
  if (!canAccessItemExtendedAction(input)) throw new Error('The selected player profile does not control this item Extended Action.')
  const targetSnapshot = input.record.targetSnapshots[0]
  if (!targetSnapshot || input.record.targetSnapshots.length !== 1) {
    throw new Error('Item Extended Action projection requires one durable target snapshot.')
  }
  const sheets = input.sheets ?? []
  const actorSheet = sheets.find(sheet => sheet.kind === 'trainer'
    && sheet.slug === input.record.initialItemCommand.actorSheet.slug)
  const targetSheet = sheets.find(sheet => sheet.kind === targetSnapshot.sheetKind
    && sheet.slug === targetSnapshot.sheetSlug)
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(input.record.canonicalItemId)
  const definitionCurrent = Boolean(definition
    && definition.definitionSha256 === input.record.canonicalDefinitionSha256)
  const unavailableReason = input.record.status === 'in-progress'
    ? input.unavailableReason ?? (!definitionCurrent
      ? 'The reviewed item definition changed. Refresh after the campaign data is repaired.'
      : null)
    : null
  const appliesTimedTreatment = definitionCurrent && definition!.spec.effects.some(effect => (
    effect.operation === 'apply-medical-treatment'
  ))
  const treatmentWorkflow = definitionCurrent && definition!.spec.effects.some(effect => (
    effect.operation === 'apply-medical-treatment' || effect.operation === 'heal-hp'
  ))
  const appliesPermanentAdvancement = definitionCurrent && definition!.spec.effects.some(effect => [
    'modify-base-stat', 'grant-tutor-points', 'increase-move-frequency', 'gain-next-level-experience',
  ].includes(effect.operation))
  const appliesMachineMoveLearning = definitionCurrent && definition!.spec.effects.some(effect => (
    effect.operation === 'learn-machine-move'
  ))
  const appliesDowsingSearch = definitionCurrent && definition!.spec.effects.some(effect => (
    effect.operation === 'search-for-shards'
  ))
  const itemLabel = definitionCurrent ? definition!.spec.presentation.label : input.record.sourceDisplayLabel
  const guidedPending = input.record.result?.status === 'completed'
    && input.record.result.itemResult.status === 'pending'
  const terminal = input.record.status === 'completed'
    ? {
        kind: 'completed' as const,
        message: guidedPending
          ? `${itemLabel} preparation completed. The exact item is reserved for bounded GM adjudication; no healing, Loyalty, or inventory change has applied yet.`
          : appliesTimedTreatment
          ? 'Bandages applied. Timed healing is now active and will stop if the target loses HP.'
          : appliesPermanentAdvancement
            ? `${itemLabel} applied. The permanent sheet change and exact item consumption were accepted together.`
            : appliesMachineMoveLearning
              ? `${itemLabel} training completed. The Move, Tutor Points, usage receipt, and inventory settlement were accepted together.`
              : appliesDowsingSearch
                ? 'Dowsing search completed. The daily use, server roll, and color-preserving Shard awards were accepted together.'
                : treatmentWorkflow ? 'Treatment completed.' : `${itemLabel} completed.`,
      }
    : input.record.status === 'interrupted'
      ? {
          kind: 'interrupted' as const,
          message: treatmentWorkflow
            ? 'Treatment interrupted before any item mechanics were applied.'
            : appliesDowsingSearch
              ? 'Dowsing search interrupted before any roll, daily use, Shard, or inventory change was applied.'
              : `${itemLabel} interrupted before any item mechanics were applied.`,
        }
      : null
  return parseItemExtendedActionProjection({
    schemaVersion: 1,
    activityId: input.record.activityId,
    revision: input.record.revision,
    status: input.record.status,
    item: {
      canonicalId: input.record.canonicalItemId,
      label: itemLabel,
    },
    actor: {
      sheetKind: 'trainer',
      sheetSlug: input.record.initialItemCommand.actorSheet.slug,
      label: displayLabel(actorSheet, input.record.actorDisplayLabel),
      href: `/sheets/trainers/${encodeURIComponent(input.record.initialItemCommand.actorSheet.slug)}`,
    },
    target: {
      sheetKind: targetSnapshot.sheetKind,
      sheetSlug: targetSnapshot.sheetSlug,
      label: displayLabel(targetSheet, targetSnapshot.displayLabel),
      href: targetSnapshot.sheetKind === 'trainer'
        ? `/sheets/trainers/${encodeURIComponent(targetSnapshot.sheetSlug)}`
        : `/sheets/${encodeURIComponent(targetSnapshot.sheetSlug)}`,
      summary: targetSummary(targetSheet, appliesPermanentAdvancement, appliesMachineMoveLearning, appliesDowsingSearch),
      conditionLabels: appliesDowsingSearch ? [] : targetConditions(targetSheet),
    },
    startedAtCampaignMinute: input.record.startedAtCampaignMinute,
    updatedAtCampaignMinute: input.record.updatedAtCampaignMinute,
    completion: {
      costs: completionCosts(input.record),
      sourceNotice: definition?.spec.consumption.phase === 'gm-adjudication'
        ? 'The exact source item is reserved at completed preparation and consumed only with GM acceptance; cancellation releases it unchanged.'
        : appliesMachineMoveLearning && definition?.spec.consumption.reusable
        ? 'The HM remains in inventory; this source records its once-per-campaign-day use only at accepted completion.'
        : appliesDowsingSearch
          ? 'The Dowsing Rod remains in inventory after accepted completion.'
          : definition?.spec.consumption.reusable
            ? 'The kit remains in inventory after accepted completion.'
            : definition?.spec.consumption.phase === 'extended-action-completion'
              ? 'One exact source item is consumed only with accepted completion.'
              : 'Any source change is applied only with accepted completion.',
      safePendingNotice: definition?.spec.consumption.phase === 'gm-adjudication'
        ? 'No HP, condition, Loyalty, treatment, or inventory change applies until bounded GM acceptance.'
        : appliesPermanentAdvancement || appliesMachineMoveLearning
        ? 'No Move, Tutor Point, usage, sheet, or inventory change has been applied yet.'
        : appliesDowsingSearch
          ? 'No Dowsing roll, daily use, Shard award, or inventory change has been applied yet.'
          : 'No roll, AP, HP, condition, or inventory change has been applied yet.',
    },
    permissions: input.record.status === 'in-progress'
      ? {
          canComplete: unavailableReason === null,
          canInterrupt: true,
          unavailableReason,
        }
      : { canComplete: false, canInterrupt: false, unavailableReason: null },
    terminal,
  })
}
