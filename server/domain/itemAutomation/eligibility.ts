import type {
  EncounterAvailabilityReasonCode,
  EncounterParticipantPresentationRef,
} from '#shared/encounterPresentation'
import type { ItemActionCostSpec, ItemPrerequisiteSpec, ItemRuntimeDefinition, ItemTargetSpec } from '#shared/itemAutomation/spec'
import type {
  ItemExecutableContextKind,
  ItemNonEncounterExecutionSnapshotV1,
} from '#shared/itemAutomation/nonEncounter'
import { sheetItemTargetId } from '#shared/itemAutomation/sheetActions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createMoveAutomationLineOfSightResolver } from '../moveAutomation/lineOfSight'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { placementToSpawned } from '~/utils/placement'
import { sheetConditionNames } from '~/utils/sheetConditions'
import { conditionBaseName, normalizeConditionNames } from '~/utils/statusConditions'
import { resolveSkills } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { computePokemonHealingVitals, computeTrainerHealingVitals } from '~/utils/sheets/healing'
import { authoritativeAbilityHealingBlocked } from '../abilityAutomation/healingPrevention'
import { resolvePokemonSheetTypes } from '~/utils/sheets/pokemonTypes'
import { capabilityActorIsFainted } from '../capabilityAutomation/actionEligibility'
import { itemHealingPreviewDescription, previewItemHpRestoration, type ItemHealingPreview } from './healing'
import {
  previewItemConditionRemoval,
  type ItemConditionRemovalPreview,
} from './conditionRemoval'
import { previewItemRevival, type ItemRevivalPreview } from './revival'
import {
  itemCombatStagePreviewDescription,
  itemTemporaryEffectPreviewDescription,
  resolveItemCombatStageModification,
  type ItemCombatStageResolution,
} from './combatEffects'
import { itemDigestionBuffPreviewDescription, resolveAuthoritativeDigestionBuffStorage } from './digestionBuffs'
import { previewItemApDrain } from './ap'
import { activeItemMedicalTreatment } from '#shared/itemAutomation/medicalTreatments'
import {
  previewPermanentItemAdvancement,
  type ItemPermanentAdvancementPreview,
} from './permanentAdvancement'
import {
  previewMachineMoveLearning,
  type ItemMoveLearningPreview,
} from './moveLearning'
import {
  previewItemEvolution,
  type ItemEvolutionPreview,
} from './evolution'
import { hasEffectiveFeature } from '../featureAutomation/effectiveFeatures'
import { linkedPokemonSlugSet } from '~/utils/pokeballCapture'
import {
  dowsingDailyUsage,
  dowsingSkillStuntOptions,
  dowsingTerrainOptions,
  explorationUseModeOptions,
  ITEM_DOWSING_SKILL_STUNT_CHOICE_ID,
  ITEM_DOWSING_TERRAIN_CHOICE_ID,
  ITEM_EXPLORATION_USE_MODE_CHOICE_ID,
  type ItemExplorationChoiceOption,
} from './exploration'
import { parseItemExplorationState } from '#shared/itemAutomation/exploration'
import type {
  AuthoritativeItemExecutionContext,
  AuthoritativeItemExecutionSheet,
  AuthoritativeItemExecutionTarget,
} from './executionContext'

export interface ItemEligibilityReason {
  readonly code: EncounterAvailabilityReasonCode
  readonly label: string
  readonly diagnosticDetail: string | null
}

export interface ItemLegalTarget {
  readonly targetId: string
  readonly participantId: string
  readonly label: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly description: string | null
  readonly healingPreview: ItemHealingPreview | null
  readonly conditionRemovalPreview: ItemConditionRemovalPreview | null
  readonly revivalPreview: ItemRevivalPreview | null
  readonly combatStagePreview: ItemCombatStageResolution | null
  readonly permanentAdvancementPreview: ItemPermanentAdvancementPreview | null
  readonly machineMoveLearningPreview: ItemMoveLearningPreview | null
  readonly itemEvolutionPreview: ItemEvolutionPreview | null
  readonly explorationChoices: readonly {
    readonly choiceId: string
    readonly label: string
    readonly minimum: number
    readonly maximum: number
    readonly options: readonly ItemExplorationChoiceOption[]
  }[]
}

export interface ItemTargetOption extends ItemLegalTarget {
  /** Null only when this exact participant is currently legal for selection. */
  readonly unavailableReason: ItemEligibilityReason | null
}

export interface AuthoritativeItemEligibility {
  readonly available: boolean
  readonly reasons: readonly ItemEligibilityReason[]
  readonly legalTargets: readonly ItemLegalTarget[]
  /** Safe target cards, including contextually meaningful unavailable candidates. */
  readonly targetOptions: readonly ItemTargetOption[]
  readonly selectedTargets: readonly AuthoritativeItemExecutionTarget[]
}

export interface ProjectEncounterItemEligibilityInput {
  readonly definition: ItemRuntimeDefinition
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actor: EncounterParticipantPresentationRef
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly sourceQuantity: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  /** Reviewed delivery modifier attached only by an active Wonder Launcher grant. */
  readonly wonderLauncherDelivery?: boolean
}

export interface ProjectSheetItemEligibilityInput {
  readonly definition: ItemRuntimeDefinition
  readonly actorSheetKind: SheetKind
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly sourceQuantity: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  /** Server-owned boundary for AP grant expiry checks. */
  readonly evaluatedAt: number
  /** Exact reusable-source identity used by HM campaign-day authority. */
  readonly sourceInstanceId: string
  /** Server-authenticated GM authority for reviewed confirmation-gated sheet offers. */
  readonly gmAuthority?: boolean
  /** Current authoritative campaign minute. */
  readonly campaignMinute: number
}

const reason = (
  code: EncounterAvailabilityReasonCode,
  label: string,
  diagnosticDetail: string | null = null,
): ItemEligibilityReason => Object.freeze({ code, label, diagnosticDetail })

const sheetMap = (
  pokemonSheets: readonly CharacterSheet[],
  trainerSheets: readonly TrainerSheet[],
): ReadonlyMap<string, AuthoritativeItemExecutionSheet> => {
  const values = new Map<string, AuthoritativeItemExecutionSheet>()
  for (const sheet of pokemonSheets) values.set(`pokemon:${sheet.slug}`, Object.freeze({
    kind: 'pokemon', slug: sheet.slug, revision: Number(sheet.revision ?? 0), sheet,
  }))
  for (const sheet of trainerSheets) values.set(`trainer:${sheet.slug}`, Object.freeze({
    kind: 'trainer', slug: sheet.slug, revision: Number(sheet.revision ?? 0), sheet,
  }))
  return values
}

const targetDisplayName = (sheet: AuthoritativeItemExecutionSheet): string => sheet.kind === 'pokemon'
  ? (sheet.sheet as CharacterSheet).nickname?.trim() || (sheet.sheet as CharacterSheet).species?.trim() || sheet.slug
  : (sheet.sheet as TrainerSheet).name?.trim() || sheet.slug

const normalizedConditions = (sheet: AuthoritativeItemExecutionSheet): ReadonlySet<string> => new Set(
  normalizeConditionNames(sheetConditionNames(sheet.kind, sheet.sheet)).flatMap(value => [value, conditionBaseName(value) ?? value]),
)

const hasCondition = (sheet: AuthoritativeItemExecutionSheet, values: readonly string[]): boolean => {
  const conditions = normalizedConditions(sheet)
  return normalizeConditionNames(values).some(value => conditions.has(value) || conditions.has(conditionBaseName(value) ?? value))
}

const relationshipMatches = (input: {
  readonly requirement: ItemTargetSpec
  readonly actor: SheetPlacement
  readonly target: SheetPlacement
  readonly map: TabletopMap
  readonly controlledTargetIds: ReadonlySet<string>
}): boolean => {
  const relationship = input.requirement.relationship
  if (relationship === 'any') return true
  if (relationship === 'self') return input.target.id === input.actor.id
  if (relationship === 'controlled' || relationship === 'owned') return input.controlledTargetIds.has(input.target.id)
  if (relationship === 'ally') return Boolean(input.actor.sideId && input.target.sideId === input.actor.sideId)
  if (relationship === 'foe') return Boolean(input.actor.sideId && input.target.sideId && input.target.sideId !== input.actor.sideId)
  return false
}

const footprintFor = (input: {
  readonly placement: SheetPlacement
  readonly map: TabletopMap
  readonly sheets: { readonly pokemon: Map<string, CharacterSheet>, readonly trainer: Map<string, TrainerSheet> }
}) => {
  const token = placementToSpawned(input.placement, input.sheets, input.map)
  return {
    position: input.placement.position,
    base: Math.max(1, token?.base ?? 1),
    clearance: Math.max(1, token?.clearance ?? 1),
  }
}

const healingEffect = (definition: ItemRuntimeDefinition) => {
  const healing = definition.spec.effects.filter(effect => effect.operation === 'heal-hp')
  return healing.length === 1 ? healing[0] : null
}

const conditionRemovalEffect = (definition: ItemRuntimeDefinition) => {
  const removal = definition.spec.effects.filter(effect => effect.operation === 'remove-conditions')
  return removal.length === 1 ? removal[0] : null
}

const revivalEffect = (definition: ItemRuntimeDefinition) => {
  const revival = definition.spec.effects.filter(effect => effect.operation === 'revive')
  return revival.length === 1 ? revival[0] : null
}

const combatStageEffect = (definition: ItemRuntimeDefinition) => {
  const stages = definition.spec.effects.filter(effect => effect.operation === 'modify-stage')
  return stages.length === 1 ? stages[0] : null
}

const temporaryCombatEffect = (definition: ItemRuntimeDefinition) => {
  const effects = definition.spec.effects.filter(effect => effect.operation === 'temporary-combat-effect')
  return effects.length === 1 ? effects[0] : null
}

const digestionBuffEffect = (definition: ItemRuntimeDefinition) => {
  const effects = definition.spec.effects.filter(effect => (
    effect.operation === 'store-digestion-buff' || effect.operation === 'use-snack-or-bait'
  ))
  return effects.length === 1 ? effects[0] : null
}

const medicalTreatmentEffect = (definition: ItemRuntimeDefinition) => {
  const effects = definition.spec.effects.filter(effect => effect.operation === 'apply-medical-treatment')
  return effects.length === 1 ? effects[0] : null
}

const permanentAdvancementEffect = (definition: ItemRuntimeDefinition) => {
  const effects = definition.spec.effects.filter(effect => [
    'modify-base-stat', 'grant-tutor-points', 'increase-move-frequency', 'gain-next-level-experience',
  ].includes(effect.operation))
  return effects.length === 1 ? effects[0] : null
}

const machineMoveLearningEffect = (definition: ItemRuntimeDefinition) => {
  const effects = definition.spec.effects.filter(effect => effect.operation === 'learn-machine-move')
  return effects.length === 1 ? effects[0] : null
}

const explorationEffect = (definition: ItemRuntimeDefinition) => {
  const effects = definition.spec.effects.filter(effect => [
    'use-bait', 'start-route-lure', 'use-snack-or-bait', 'use-repel', 'search-for-shards',
  ].includes(effect.operation))
  return effects.length === 1 ? effects[0] : null
}

const itemEvolutionEffect = (definition: ItemRuntimeDefinition) => {
  const effects = definition.spec.effects.filter(effect => effect.operation === 'evolve-pokemon')
  return effects.length === 1 ? effects[0] : null
}

const legalTargetCandidates = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly context: ItemExecutableContextKind
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: AuthoritativeItemExecutionSheet
  readonly sheets: ReadonlyMap<string, AuthoritativeItemExecutionSheet>
  readonly controlledTargetIds: ReadonlySet<string>
  readonly selectedChoices?: ReadonlyMap<string, readonly string[]>
  readonly sourceInstanceId?: string
  readonly campaignMinute?: number
  readonly wonderLauncherDelivery?: boolean
}): readonly ItemLegalTarget[] => {
  if (input.definition.spec.targets.length > 1) return []
  const targetSpec = input.definition.spec.targets[0]
  if (!targetSpec) return []
  if (targetSpec.kind !== 'participant' && targetSpec.kind !== 'self') return []
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const sheet of input.sheets.values()) {
    if (sheet.kind === 'pokemon') pokemon.set(sheet.slug, sheet.sheet as CharacterSheet)
    else trainer.set(sheet.slug, sheet.sheet as TrainerSheet)
  }
  const querySheets = { pokemon, trainer }
  const placements = input.map.placements.flatMap((placement) => {
    const footprint = footprintFor({ placement, map: input.map, sheets: querySheets })
    return [{ id: placement.id, position: placement.position, base: footprint.base, clearance: footprint.clearance }]
  })
  const sight = targetSpec.requiresLineOfSight
    ? createMoveAutomationLineOfSightResolver({ voxels: input.map.voxels, placements })
    : null
  const actorFootprint = footprintFor({ placement: input.actorPlacement, map: input.map, sheets: querySheets })
  const exploration = explorationEffect(input.definition)
  const linkedPokemon = linkedPokemonSlugSet(trainer.values())
  let actorExplorationState: ReturnType<typeof parseItemExplorationState> | null = null
  try {
    actorExplorationState = input.actorSheet.kind === 'trainer'
      ? parseItemExplorationState((input.actorSheet.sheet as TrainerSheet).serverPrivate?.itemExploration)
      : null
  }
  catch { return Object.freeze([]) }
  const unresolvedRouteLure = actorExplorationState?.routeLures.some(activity => (
    activity.status === 'active' || activity.status === 'awaiting-encounter'
  )) ?? false
  const rows: ItemLegalTarget[] = []
  for (const placement of input.map.placements) {
    const sheet = input.sheets.get(`${placement.sheetKind}:${placement.sheetSlug}`)
    if (!sheet || !relationshipMatches({
      requirement: targetSpec,
      actor: input.actorPlacement,
      target: placement,
      map: input.map,
      controlledTargetIds: input.controlledTargetIds,
    })) continue
    const wildPokemon = placement.sheetKind === 'pokemon' && !linkedPokemon.has(placement.sheetSlug)
    const self = placement.id === input.actorPlacement.id
    if (exploration) {
      if (input.actorSheet.kind !== 'trainer') continue
      if (exploration.operation === 'use-bait' || exploration.operation === 'use-repel') {
        if (input.context === 'encounter' ? !wildPokemon : !self) continue
        if (exploration.operation === 'use-repel' && wildPokemon
          && Number((sheet.sheet as CharacterSheet).level ?? 0) > exploration.maximumAffectedWildLevel) continue
      }
      else if (exploration.operation === 'start-route-lure' || exploration.operation === 'search-for-shards') {
        if (!self) continue
      }
    }
    const targetFootprint = footprintFor({ placement, map: input.map, sheets: querySheets })
    const rangeMeters = input.wonderLauncherDelivery ? 8 : targetSpec.rangeMeters
    if (rangeMeters !== null
      && ptuGridDistanceBetweenFootprints(actorFootprint, targetFootprint) > rangeMeters) continue
    if (sight && !sight.resolve(input.actorPlacement.id, placement.id).targetable) continue
    if (!targetPrerequisitesSatisfied(input.definition.spec.prerequisites, sheet)) continue
    const digestion = digestionBuffEffect(input.definition)
    const honeySnack = exploration?.operation === 'use-snack-or-bait'
    let snackAvailable = false
    if (digestion || honeySnack) {
      try {
        const storage = resolveAuthoritativeDigestionBuffStorage({
          kind: sheet.kind,
          sheet: sheet.sheet,
          placement,
          map: input.map,
        })
        snackAvailable = storage.names.length < storage.capacity
        const hasAlternateExplorationMode = honeySnack && (
          (input.context === 'encounter' && wildPokemon)
          || (input.context !== 'encounter' && self && !unresolvedRouteLure)
        )
        if (!snackAvailable && !hasAlternateExplorationMode) continue
      }
      catch {
        const hasAlternateExplorationMode = honeySnack && (
          (input.context === 'encounter' && wildPokemon)
          || (input.context !== 'encounter' && self && !unresolvedRouteLure)
        )
        if (!hasAlternateExplorationMode) continue
      }
    }
    if (exploration?.operation === 'start-route-lure' && unresolvedRouteLure) continue
    if (exploration?.operation === 'use-bait' && input.context !== 'encounter' && unresolvedRouteLure) continue
    if (exploration?.operation === 'search-for-shards') {
      const rank = resolveTrainerSkills(input.actorSheet.sheet as TrainerSheet)
        .find(skill => skill.key === 'occultEd')?.rankValue ?? 0
      const usage = dowsingDailyUsage({
        state: actorExplorationState,
        sourceInstanceId: input.sourceInstanceId ?? '',
        campaignMinute: input.campaignMinute ?? -1,
        occultEducationRank: rank,
      })
      if (usage.maximum < 1 || usage.used >= usage.maximum) continue
    }
    if (exploration?.operation === 'use-repel' && input.context !== 'encounter') {
      const campaignMinute = input.campaignMinute ?? -1
      const expires = campaignMinute + exploration.durationMinutes
      if (actorExplorationState?.repels.some(effect => effect.expiresAtCampaignMinute > campaignMinute
        && effect.maximumAffectedWildLevel >= exploration.maximumAffectedWildLevel
        && effect.expiresAtCampaignMinute >= expires)) continue
    }
    const medicalTreatment = medicalTreatmentEffect(input.definition)
    if (medicalTreatment) {
      try {
        if (activeItemMedicalTreatment(sheet.sheet.itemMedicalTreatments)) continue
      }
      catch { continue }
    }
    const permanentAdvancement = permanentAdvancementEffect(input.definition)
    let permanentAdvancementPreview: ItemPermanentAdvancementPreview | null = null
    if (permanentAdvancement) {
      try {
        permanentAdvancementPreview = previewPermanentItemAdvancement({
          definition: input.definition,
          sheetKind: sheet.kind,
          sheet: sheet.sheet,
        })
      }
      catch { continue }
    }
    const machineMoveLearning = machineMoveLearningEffect(input.definition)
    let machineMoveLearningPreview: ItemMoveLearningPreview | null = null
    if (machineMoveLearning) {
      try {
        machineMoveLearningPreview = previewMachineMoveLearning({
          definition: input.definition,
          sheetKind: sheet.kind,
          sheet: sheet.sheet,
          actorKind: input.actorSheet.kind,
          actorSheet: input.actorSheet.sheet,
          sourceInstanceId: input.sourceInstanceId ?? '',
          campaignMinute: input.campaignMinute ?? -1,
          ...(input.selectedChoices ? { selectedChoices: input.selectedChoices } : {}),
        })
      }
      catch { continue }
    }
    const itemEvolution = itemEvolutionEffect(input.definition)
    let itemEvolutionPreview: ItemEvolutionPreview | null = null
    if (itemEvolution) {
      try {
        itemEvolutionPreview = previewItemEvolution({
          definition: input.definition,
          sheetKind: sheet.kind,
          sheet: sheet.sheet as CharacterSheet,
          actorKind: input.actorSheet.kind,
          sourceInstanceId: input.sourceInstanceId ?? '',
          ...(input.selectedChoices ? { selectedChoices: input.selectedChoices } : {}),
        })
      }
      catch { continue }
    }
    const revival = revivalEffect(input.definition)
    if (revival && sheet.kind !== revival.revival.targetKind) continue
    if (revival && !capabilityActorIsFainted(sheet.sheet)) continue
    let revivalPreview: ItemRevivalPreview | null = null
    if (revival) {
      try {
        revivalPreview = previewItemRevival({
          revival: revival.revival, sheetKind: sheet.kind, sheet: sheet.sheet,
        })
      }
      catch { continue }
    }
    const healing = healingEffect(input.definition)
    const healingPreview = healing ? previewItemHpRestoration({
      restoration: healing.restoration,
      sheetKind: sheet.kind,
      sheet: sheet.sheet,
      actorSheetKind: input.actorSheet.kind,
      actorSheet: input.actorSheet.sheet,
    }) : null
    const removal = conditionRemovalEffect(input.definition)
    const conditionRemovalPreview = removal ? previewItemConditionRemoval({
      spec: removal,
      sheetKind: sheet.kind,
      sheet: sheet.sheet,
    }) : null
    const stageEffect = combatStageEffect(input.definition)
    const combatStagePreview = stageEffect ? resolveItemCombatStageModification({
      sheetKind: sheet.kind,
      sheet: sheet.sheet,
      stat: stageEffect.stat,
      amount: stageEffect.amount,
    }) : null
    // A capped direct stage boost is a no-op and must never consume the item.
    if (combatStagePreview?.appliedDelta === 0) continue
    const temporaryEffect = temporaryCombatEffect(input.definition)
    // Both reviewed replacement and refresh policies create new durable source
    // evidence (and refresh resets the authoritative duration), so unlike a
    // capped stage they remain eligible while an older instance is active.
    // Ordinary HP restoration never doubles as revival. Fainted is authoritative
    // from either retained condition state or non-positive HP. Healing prevention
    // also rejects the whole compound effect so a cure cannot smuggle in HP.
    if (healingPreview && capabilityActorIsFainted(sheet.sheet)) continue
    if (healingPreview && authoritativeAbilityHealingBlocked({ map: input.map, placementId: placement.id })) continue
    // A compound restorative is useful when at least one reviewed effect changes
    // state. Thus Full Restore may cure at full HP or heal without an affliction,
    // while a pure healing/cure item still rejects a no-op target.
    const healingApplicable = Boolean(healingPreview && !healingPreview.fullHealth)
    const removalApplicable = Boolean(conditionRemovalPreview?.hasApplicableCondition)
    if ((healingPreview || conditionRemovalPreview) && !healingApplicable && !removalApplicable) continue
    const explorationChoices: ItemLegalTarget['explorationChoices'] = exploration
      ? exploration.operation === 'search-for-shards'
        ? Object.freeze([
            Object.freeze({
              choiceId: ITEM_DOWSING_TERRAIN_CHOICE_ID,
              label: 'GM-confirmed search terrain', minimum: 1, maximum: 1,
              options: dowsingTerrainOptions(),
            }),
            Object.freeze({
              choiceId: ITEM_DOWSING_SKILL_STUNT_CHOICE_ID,
              label: 'Skill Stunt — Dowsing', minimum: 0, maximum: 1,
              options: dowsingSkillStuntOptions(input.actorSheet.sheet as TrainerSheet),
            }),
          ])
        : exploration.operation === 'start-route-lure'
          ? Object.freeze([])
          : Object.freeze([Object.freeze({
              choiceId: ITEM_EXPLORATION_USE_MODE_CHOICE_ID,
              label: 'Use mode', minimum: 1, maximum: 1,
              options: explorationUseModeOptions({ definition: input.definition, context: input.context })
                .filter(option => exploration.operation !== 'use-snack-or-bait' || (
                  option.optionId === 'snack' ? snackAvailable
                    : option.optionId === 'wild-distraction' ? input.context === 'encounter' && wildPokemon
                      : option.optionId === 'route-lure' ? input.context !== 'encounter' && self && !unresolvedRouteLure
                        : false
                )),
            })])
      : Object.freeze([])
    if (explorationChoices.some(choice => choice.minimum > choice.options.length)) continue
    rows.push(Object.freeze({
      targetId: targetSpec.targetId,
      participantId: placement.id,
      label: targetDisplayName(sheet),
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      description: [
        healingPreview ? itemHealingPreviewDescription(healingPreview) : null,
        conditionRemovalPreview?.description ?? null,
        revivalPreview?.description ?? null,
        combatStagePreview ? itemCombatStagePreviewDescription(combatStagePreview) : null,
        temporaryEffect ? itemTemporaryEffectPreviewDescription({
          family: temporaryEffect.family,
          amount: temporaryEffect.amount,
          duration: input.definition.spec.duration,
        }) : null,
        digestion ? itemDigestionBuffPreviewDescription(input.definition) : null,
        medicalTreatment ? 'Apply for 6 hours · 1/8 Max HP each half hour · 1 Injury at completion · stops on HP loss' : null,
        permanentAdvancementPreview?.description ?? null,
        machineMoveLearningPreview?.description ?? null,
        itemEvolutionPreview?.description ?? null,
      ].filter(Boolean).join(' · ') || null,
      healingPreview,
      conditionRemovalPreview,
      revivalPreview,
      combatStagePreview,
      permanentAdvancementPreview,
      machineMoveLearningPreview,
      itemEvolutionPreview,
      explorationChoices,
    }))
  }
  return Object.freeze(rows)
}

const projectedTargetOptions = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly context: ItemExecutableContextKind
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: AuthoritativeItemExecutionSheet
  readonly sheets: ReadonlyMap<string, AuthoritativeItemExecutionSheet>
  readonly controlledTargetIds: ReadonlySet<string>
  readonly legalTargets: readonly ItemLegalTarget[]
  readonly selectedChoices?: ReadonlyMap<string, readonly string[]>
  readonly sourceInstanceId?: string
  readonly campaignMinute?: number
  readonly wonderLauncherDelivery?: boolean
}): readonly ItemTargetOption[] => {
  const targetSpec = input.definition.spec.targets[0]
  if (!targetSpec || input.definition.spec.targets.length !== 1
    || (targetSpec.kind !== 'participant' && targetSpec.kind !== 'self')) return Object.freeze([])
  const legalById = new Map(input.legalTargets.map(target => [target.participantId, target]))
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const sheet of input.sheets.values()) {
    if (sheet.kind === 'pokemon') pokemon.set(sheet.slug, sheet.sheet as CharacterSheet)
    else trainer.set(sheet.slug, sheet.sheet as TrainerSheet)
  }
  const querySheets = { pokemon, trainer }
  const placements = input.map.placements.map((placement) => {
    const footprint = footprintFor({ placement, map: input.map, sheets: querySheets })
    return { id: placement.id, position: placement.position, base: footprint.base, clearance: footprint.clearance }
  })
  const sight = targetSpec.requiresLineOfSight
    ? createMoveAutomationLineOfSightResolver({ voxels: input.map.voxels, placements })
    : null
  const actorFootprint = footprintFor({ placement: input.actorPlacement, map: input.map, sheets: querySheets })
  const options: ItemTargetOption[] = []
  for (const placement of input.map.placements) {
    const sheet = input.sheets.get(`${placement.sheetKind}:${placement.sheetSlug}`)
    if (!sheet || !relationshipMatches({
      requirement: targetSpec,
      actor: input.actorPlacement,
      target: placement,
      map: input.map,
      controlledTargetIds: input.controlledTargetIds,
    })) continue
    const legal = legalById.get(placement.id)
    if (legal) {
      options.push(Object.freeze({ ...legal, unavailableReason: null }))
      continue
    }
    const targetFootprint = footprintFor({ placement, map: input.map, sheets: querySheets })
    const prerequisiteReason = targetPrerequisiteUnavailableReason(input.definition.spec.prerequisites, sheet)
    const rangeMeters = input.wonderLauncherDelivery ? 8 : targetSpec.rangeMeters
    let unavailable = rangeMeters !== null
      && ptuGridDistanceBetweenFootprints(actorFootprint, targetFootprint) > rangeMeters
      ? reason('target.out-of-range', `Outside the reviewed ${rangeMeters} m range.`)
      : sight && !sight.resolve(input.actorPlacement.id, placement.id).targetable
        ? reason('target.geometry-blocked', 'Line of sight is blocked.')
        : prerequisiteReason
    let healingPreview: ItemHealingPreview | null = null
    let conditionRemovalPreview: ItemConditionRemovalPreview | null = null
    let revivalPreview: ItemRevivalPreview | null = null
    let combatStagePreview: ItemCombatStageResolution | null = null
    let permanentAdvancementPreview: ItemPermanentAdvancementPreview | null = null
    let machineMoveLearningPreview: ItemMoveLearningPreview | null = null
    let itemEvolutionPreview: ItemEvolutionPreview | null = null
    const medicalTreatment = medicalTreatmentEffect(input.definition)
    const permanentAdvancement = permanentAdvancementEffect(input.definition)
    const machineMoveLearning = machineMoveLearningEffect(input.definition)
    const itemEvolution = itemEvolutionEffect(input.definition)
    if (!unavailable) {
      const digestion = digestionBuffEffect(input.definition)
      if (digestion) {
        try {
          const storage = resolveAuthoritativeDigestionBuffStorage({
            kind: sheet.kind, sheet: sheet.sheet, placement, map: input.map,
          })
          if (storage.names.length >= storage.capacity) unavailable = reason('target.invalid', 'Digestion Buff capacity is full.')
        }
        catch { unavailable = reason('target.invalid', 'Digestion Buff eligibility is unavailable.') }
      }
    }
    if (!unavailable && medicalTreatment) {
      try {
        if (activeItemMedicalTreatment(sheet.sheet.itemMedicalTreatments)) {
          unavailable = reason('target.invalid', 'This target already has active Bandages.')
        }
      }
      catch { unavailable = reason('target.invalid', 'Medical treatment authority is malformed.') }
    }
    if (!unavailable && permanentAdvancement) {
      try {
        permanentAdvancementPreview = previewPermanentItemAdvancement({
          definition: input.definition,
          sheetKind: sheet.kind,
          sheet: sheet.sheet,
        })
      }
      catch (error) {
        unavailable = reason(
          'target.invalid',
          error instanceof Error ? error.message : 'Permanent advancement is not currently applicable.',
        )
      }
    }
    if (!unavailable && machineMoveLearning) {
      try {
        machineMoveLearningPreview = previewMachineMoveLearning({
          definition: input.definition,
          sheetKind: sheet.kind,
          sheet: sheet.sheet,
          actorKind: input.actorSheet.kind,
          actorSheet: input.actorSheet.sheet,
          sourceInstanceId: input.sourceInstanceId ?? '',
          campaignMinute: input.campaignMinute ?? -1,
          ...(input.selectedChoices ? { selectedChoices: input.selectedChoices } : {}),
        })
      }
      catch (error) {
        unavailable = reason(
          'target.invalid',
          error instanceof Error ? error.message : 'Machine Move learning is not currently applicable.',
        )
      }
    }
    if (!unavailable && itemEvolution) {
      try {
        itemEvolutionPreview = previewItemEvolution({
          definition: input.definition,
          sheetKind: sheet.kind,
          sheet: sheet.sheet as CharacterSheet,
          actorKind: input.actorSheet.kind,
          sourceInstanceId: input.sourceInstanceId ?? '',
          ...(input.selectedChoices ? { selectedChoices: input.selectedChoices } : {}),
        })
      }
      catch (error) {
        unavailable = reason(
          'target.invalid',
          error instanceof Error ? error.message : 'Item evolution is not currently applicable.',
        )
      }
    }
    const revival = revivalEffect(input.definition)
    if (!unavailable && revival && sheet.kind !== revival.revival.targetKind) {
      unavailable = reason('target.invalid', `This item requires a ${revival.revival.targetKind} target.`)
    }
    if (!unavailable && revival && !capabilityActorIsFainted(sheet.sheet)) {
      unavailable = reason('target.invalid', 'Target is not Fainted.')
    }
    if (!unavailable && revival) {
      try { revivalPreview = previewItemRevival({ revival: revival.revival, sheetKind: sheet.kind, sheet: sheet.sheet }) }
      catch { unavailable = reason('target.invalid', 'Revival is not currently applicable.') }
    }
    const healing = healingEffect(input.definition)
    const removal = conditionRemovalEffect(input.definition)
    if (healing && (!unavailable || unavailable.label === 'At full HP.')) {
      try {
        healingPreview = previewItemHpRestoration({
          restoration: healing.restoration,
          sheetKind: sheet.kind,
          sheet: sheet.sheet,
          actorSheetKind: input.actorSheet.kind,
          actorSheet: input.actorSheet.sheet,
        })
      }
      catch {
        if (!unavailable) unavailable = reason('target.invalid', 'Healing eligibility is unavailable.')
      }
    }
    if (!unavailable && removal) {
      try { conditionRemovalPreview = previewItemConditionRemoval({ spec: removal, sheetKind: sheet.kind, sheet: sheet.sheet }) }
      catch { unavailable = reason('target.invalid', 'Condition-removal eligibility is unavailable.') }
    }
    if (!unavailable && healingPreview && capabilityActorIsFainted(sheet.sheet)) {
      unavailable = reason('condition.fainted', 'Fainted targets require a revival item.')
    }
    if (!unavailable && healingPreview
      && authoritativeAbilityHealingBlocked({ map: input.map, placementId: placement.id })) {
      unavailable = reason('condition.disabled', 'Healing is currently prevented.')
    }
    if (!unavailable && (healingPreview || conditionRemovalPreview)
      && Boolean(healingPreview && !healingPreview.fullHealth) === false
      && Boolean(conditionRemovalPreview?.hasApplicableCondition) === false) {
      unavailable = healingPreview?.fullHealth
        ? reason('target.invalid', 'At full HP.')
        : reason('target.invalid', 'No condition is within this item’s reviewed cure scope.')
    }
    const stage = combatStageEffect(input.definition)
    if (!unavailable && stage) {
      try {
        combatStagePreview = resolveItemCombatStageModification({
          sheetKind: sheet.kind, sheet: sheet.sheet, stat: stage.stat, amount: stage.amount,
        })
        if (combatStagePreview.appliedDelta === 0) unavailable = reason('target.invalid', 'The relevant combat stage is already at its limit.')
      }
      catch { unavailable = reason('target.invalid', 'Combat-stage eligibility is unavailable.') }
    }
    options.push(Object.freeze({
      targetId: targetSpec.targetId,
      participantId: placement.id,
      label: targetDisplayName(sheet),
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      description: [
        healingPreview ? itemHealingPreviewDescription(healingPreview) : null,
        conditionRemovalPreview?.description ?? null,
        revivalPreview?.description ?? null,
        combatStagePreview ? itemCombatStagePreviewDescription(combatStagePreview) : null,
        medicalTreatment ? 'Apply for 6 hours · 1/8 Max HP each half hour · 1 Injury at completion · stops on HP loss' : null,
        permanentAdvancementPreview?.description ?? null,
        machineMoveLearningPreview?.description ?? null,
        itemEvolutionPreview?.description ?? null,
      ].filter(Boolean).join(' · ') || null,
      healingPreview,
      conditionRemovalPreview,
      revivalPreview,
      combatStagePreview,
      permanentAdvancementPreview,
      machineMoveLearningPreview,
      itemEvolutionPreview,
      explorationChoices: Object.freeze([]),
      unavailableReason: unavailable ?? reason('target.invalid', 'Not currently eligible for this item.'),
    }))
  }
  return Object.freeze(options)
}

const actorKindMatches = (values: readonly string[], kind: SheetKind): boolean => values.length === 0
  || values.some(value => value.toLowerCase() === kind)

const targetPrerequisitesSatisfied = (
  prerequisites: readonly ItemPrerequisiteSpec[],
  sheet: AuthoritativeItemExecutionSheet,
): boolean => prerequisites.every((prerequisite) => {
  if (prerequisite.kind === 'target-kind') return actorKindMatches(prerequisite.values, sheet.kind)
  if (prerequisite.kind === 'type') {
    return sheet.kind === 'pokemon' && prerequisite.values.some(required => (
      resolvePokemonSheetTypes(sheet.sheet as CharacterSheet)
        .some(type => type.toLocaleLowerCase('en-US') === required.toLocaleLowerCase('en-US'))
    ))
  }
  if (prerequisite.kind === 'condition') {
    const requiresFainted = normalizeConditionNames(prerequisite.values).includes('Fainted')
    return (requiresFainted && capabilityActorIsFainted(sheet.sheet)) || hasCondition(sheet, prerequisite.values)
  }
  if (prerequisite.kind === 'not-condition') return !hasCondition(sheet, prerequisite.values)
  if (prerequisite.kind === 'hp-state') {
    const state = prerequisite.values.map(value => value.toLowerCase())
    const fainted = capabilityActorIsFainted(sheet.sheet)
    if (state.includes('fainted') && !fainted) return false
    if (state.includes('conscious') && fainted) return false
    if (state.includes('below-effective-maximum')) {
      const preview = sheet.kind === 'pokemon'
        ? computePokemonHealingVitals(sheet.sheet as CharacterSheet)
        : computeTrainerHealingVitals(sheet.sheet as TrainerSheet)
      if (preview.currentHp >= preview.maxHp) return false
    }
  }
  return true
})

const targetPrerequisiteUnavailableReason = (
  prerequisites: readonly ItemPrerequisiteSpec[],
  sheet: AuthoritativeItemExecutionSheet,
): ItemEligibilityReason | null => {
  for (const prerequisite of prerequisites) {
    if (targetPrerequisitesSatisfied([prerequisite], sheet)) continue
    if (prerequisite.kind === 'hp-state') {
      const states = prerequisite.values.map(value => value.toLowerCase())
      if (states.includes('below-effective-maximum')) return reason('target.invalid', 'At full HP.')
      if (states.includes('fainted')) return reason('target.invalid', 'Target is not Fainted.')
      if (states.includes('conscious')) return reason('condition.fainted', 'Target is Fainted.')
    }
    if (prerequisite.kind === 'condition') {
      if (normalizeConditionNames(prerequisite.values).includes('Fainted')) {
        return reason('target.invalid', 'Target is not Fainted.')
      }
      return reason('target.invalid', `Target does not have ${prerequisite.values.join(' or ')}.`)
    }
    if (prerequisite.kind === 'not-condition') {
      return reason('target.invalid', `Target has ${prerequisite.values.join(' or ')}.`)
    }
    if (prerequisite.kind === 'target-kind') {
      return reason('target.invalid', `This item requires a ${prerequisite.values.join(' or ')} target.`)
    }
    if (prerequisite.kind === 'type') {
      return reason('target.invalid', `This item requires a ${prerequisite.values.join(' or ')}-type target.`)
    }
    return reason('target.invalid', 'This participant does not satisfy the item’s reviewed target prerequisites.')
  }
  return null
}

const actorPrerequisiteReason = (
  prerequisite: ItemPrerequisiteSpec,
  actorSheet: AuthoritativeItemExecutionSheet,
  gmConfirmation?: ItemNonEncounterExecutionSnapshotV1['gmConfirmation'] | null,
): ItemEligibilityReason | null => {
  if (prerequisite.kind === 'actor-kind' && !actorKindMatches(prerequisite.values, actorSheet.kind)) {
    return reason('condition.disabled', prerequisite.unavailableReason, `Actor kind ${actorSheet.kind} was not eligible.`)
  }
  if (prerequisite.kind === 'gm') return gmConfirmation?.status === 'confirmed'
    ? null
    : reason('permission.gm-only', prerequisite.unavailableReason)
  if (prerequisite.kind === 'condition' && !hasCondition(actorSheet, prerequisite.values)) {
    return reason('condition.disabled', prerequisite.unavailableReason)
  }
  if (prerequisite.kind === 'not-condition' && hasCondition(actorSheet, prerequisite.values)) {
    return reason('condition.disabled', prerequisite.unavailableReason)
  }
  if (prerequisite.kind === 'equipped') {
    const equipped = actorSheet.kind === 'pokemon'
      ? [(actorSheet.sheet as CharacterSheet).items?.held]
      : Object.values((actorSheet.sheet as TrainerSheet).equipmentSlots ?? {})
    if (!prerequisite.values.some(value => equipped.some(item => item?.trim().toLowerCase() === value.trim().toLowerCase()))) {
      return reason('source.item-required', prerequisite.unavailableReason)
    }
  }
  if (prerequisite.kind === 'feature') {
    if (actorSheet.kind !== 'trainer') return reason('source.capability-required', prerequisite.unavailableReason)
    const trainer = actorSheet.sheet as TrainerSheet
    if (!prerequisite.values.some(value => hasEffectiveFeature(trainer, value))) {
      return reason('source.capability-required', prerequisite.unavailableReason)
    }
  }
  if (prerequisite.kind === 'capability') {
    const capabilities = actorSheet.kind === 'trainer'
      ? (actorSheet.sheet as TrainerSheet).capabilities?.other ?? []
      : (actorSheet.sheet as CharacterSheet).capabilities?.other ?? []
    if (!prerequisite.values.some(value => capabilities.some(capability => capability.trim().toLowerCase() === value.trim().toLowerCase()))) {
      return reason('source.capability-required', prerequisite.unavailableReason)
    }
  }
  if (prerequisite.kind === 'skill-rank') {
    const [skillId, minimumRaw] = prerequisite.values
    const minimum = Number(minimumRaw)
    const ranks = actorSheet.kind === 'pokemon'
      ? resolveSkills(actorSheet.sheet as CharacterSheet).map(row => [row.key, Number.parseInt(row.value, 10)] as const)
      : resolveTrainerSkills(actorSheet.sheet as TrainerSheet).map(row => [row.key, row.rankValue] as const)
    if (!skillId || !Number.isFinite(minimum) || (new Map(ranks).get(skillId as never) ?? 0) < minimum) {
      return reason('source.capability-required', prerequisite.unavailableReason)
    }
  }
  return null
}

const timingReasons = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly context: ItemExecutableContextKind
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
}): readonly ItemEligibilityReason[] => {
  const spec = input.definition.spec
  if (!spec.contexts.includes(input.context)) {
    const contextLabel = input.context === 'encounter' ? 'an encounter'
      : input.context === 'sheet' ? 'a sheet'
        : input.context === 'campaign' ? 'the campaign context'
          : input.context === 'workshop' ? 'a workshop' : 'an extended action'
    return [reason('action.unsupported', `This item cannot be used from ${contextLabel}.`)]
  }
  if (input.context !== 'encounter') return []
  if (!input.map.activeScene && ['priority', 'interrupt', 'reaction'].includes(spec.timing)) {
    return [reason('timing.no-active-scene', 'Start a scene before using this item at reactive timing.')]
  }
  if (['standard', 'shift', 'full'].includes(spec.timing)
    && input.map.initiative?.activeId
    && input.map.initiative.activeId !== input.actorPlacement.id) {
    return [reason('timing.not-actors-turn', 'Wait for this participant’s turn.')]
  }
  const ledger = input.map.encounterState?.turnResources[input.actorPlacement.id]
  const action = ledger?.actions[spec.timing as 'standard' | 'shift' | 'swift' | 'full']
  const effectiveSpent = action && (spec.timing === 'standard' || spec.timing === 'shift')
    ? action.spent + (ledger?.actions.full.spent ?? 0)
    : action?.spent ?? 0
  const fullBlocked = spec.timing === 'full' && ledger
    ? (ledger.actions.standard.spent > 0 || ledger.actions.shift.spent > 0)
    : false
  if (action && ((action.budget !== null && effectiveSpent >= action.budget) || fullBlocked)) {
    const code = spec.timing === 'standard' ? 'economy.standard-spent'
      : spec.timing === 'shift' ? 'economy.shift-spent'
        : spec.timing === 'swift' ? 'economy.swift-spent' : 'economy.full-action-unavailable'
    return [reason(code, `${spec.presentation.label} cannot spend its required action.`)]
  }
  if ((spec.timing === 'interrupt' || spec.timing === 'reaction') && ledger && !ledger.reaction.available) {
    return [reason('timing.reaction-window-closed', 'The response window has closed.')]
  }
  return []
}

const evaluate = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly context: ItemExecutableContextKind
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: AuthoritativeItemExecutionSheet
  readonly sourceQuantity: number
  readonly sheets: ReadonlyMap<string, AuthoritativeItemExecutionSheet>
  readonly controlledTargetIds: ReadonlySet<string>
  readonly selectedTargetIds?: readonly string[]
  readonly selectedChoices?: ReadonlyMap<string, readonly string[]>
  readonly allowIncompleteSelections?: boolean
  readonly includeUnavailableTargetOptions?: boolean
  readonly sourceInstanceId?: string
  readonly campaignMinute?: number
  /** Declaration validates every current prerequisite without pretending the activity has completed. */
  readonly allowExtendedActionDeclaration?: boolean
  readonly nonEncounter?: ItemNonEncounterExecutionSnapshotV1 | null
  readonly wonderLauncherDelivery?: boolean
  readonly gmAuthority?: boolean
}): AuthoritativeItemEligibility => {
  const reasons: ItemEligibilityReason[] = []
  if (input.definition.spec.implementationState !== 'native'
    && input.definition.spec.implementationState !== 'guided') {
    reasons.push(reason('action.unsupported', 'No reviewed item action is available.'))
  }
  if (capabilityActorIsFainted(input.actorSheet.sheet)) {
    reasons.push(reason('condition.fainted', 'Fainted participants cannot use items.'))
  }
  if (input.sourceQuantity < input.definition.spec.consumption.quantity) reasons.push(reason('source.item-unavailable', 'The source stack has insufficient quantity.'))
  reasons.push(...timingReasons(input))
  if (input.nonEncounter?.extendedAction.mode === 'extended'
    && input.nonEncounter.extendedAction.phase !== 'completion'
    && !(input.allowExtendedActionDeclaration
      && input.nonEncounter.extendedAction.phase === 'declaration')) {
    reasons.push(reason(
      'action.parameters-required',
      input.nonEncounter.extendedAction.phase === 'declaration'
        ? 'Start this Extended Action before resolving the item.'
        : 'This Extended Action is still in progress.',
    ))
  }
  if (input.nonEncounter?.gmConfirmation.required
    && input.nonEncounter.gmConfirmation.status !== 'confirmed') {
    reasons.push(reason('permission.gm-only', 'Current GM confirmation is required before this item can resolve.'))
  }
  const apCosts: readonly ItemActionCostSpec[] = [
    ...input.definition.spec.costs.filter(candidate => candidate.kind === 'ap'),
    ...(input.wonderLauncherDelivery ? [{
      kind: 'ap' as const,
      resourceId: 'drain',
      amount: 1,
      label: '1 AP to activate Wonder Launcher',
    }] : []),
  ]
  for (const cost of apCosts) {
    if (input.actorSheet.kind !== 'trainer') {
      reasons.push(reason('source.capability-required', 'This item requires a Trainer actor with authoritative AP.'))
      continue
    }
    try {
      previewItemApDrain({
        sheet: input.actorSheet.sheet as TrainerSheet,
        cost,
        now: Number.isSafeInteger(input.map.updatedAt) ? Number(input.map.updatedAt) : 0,
        round: input.map.initiative?.round ?? null,
      })
    }
    catch (error) {
      reasons.push(reason(
        'economy.action-points-insufficient',
        error instanceof Error ? error.message : 'The item actor does not have enough available AP.',
      ))
    }
  }
  for (const prerequisite of input.definition.spec.prerequisites) {
    if (input.definition.spec.targets.length > 0
      && ['target-kind', 'condition', 'not-condition', 'hp-state', 'type'].includes(prerequisite.kind)) continue
    const failed = actorPrerequisiteReason(
      prerequisite,
      input.actorSheet,
      input.nonEncounter?.gmConfirmation ?? (input.gmAuthority
        ? { required: true, status: 'confirmed', evidenceId: 'projection-gm-authority' }
        : null),
    )
    if (failed) reasons.push(failed)
  }
  const legalTargets = legalTargetCandidates(input)
  const targetOptions = input.includeUnavailableTargetOptions
    ? projectedTargetOptions({ ...input, legalTargets })
    : Object.freeze(legalTargets.map(target => Object.freeze({ ...target, unavailableReason: null })))
  const legalIds = new Set(legalTargets.map(target => target.participantId))
  const targetSpec = input.definition.spec.targets[0]
  const selectedIds = input.selectedTargetIds ?? []
  if (input.definition.spec.targets.length > 1) reasons.push(reason('action.parameters-required', 'This item requires a pending multi-step target decision.'))
  if (targetSpec && input.selectedTargetIds !== undefined && !input.allowIncompleteSelections) {
    if (selectedIds.length < targetSpec.minimum || selectedIds.length > targetSpec.maximum) {
      reasons.push(reason('target.required', `Choose ${targetSpec.minimum === targetSpec.maximum ? targetSpec.minimum : `${targetSpec.minimum}–${targetSpec.maximum}`} legal target(s).`))
    }
    if (selectedIds.some(id => !legalIds.has(id))) reasons.push(reason('target.invalid', 'One or more selected targets are no longer eligible.'))
  }
  if (targetSpec && targetSpec.minimum > 0 && legalTargets.length < targetSpec.minimum) {
    const removal = conditionRemovalEffect(input.definition)
    reasons.push(reason(
      'target.invalid',
      removal
        ? 'No legal target has a condition within this item’s reviewed cure scope.'
        : 'No legal target currently satisfies this item.',
    ))
  }
  const declaredChoices = input.selectedChoices ?? new Map<string, readonly string[]>()
  for (const choice of input.definition.spec.choices) {
    const selected = declaredChoices.get(choice.choiceId) ?? []
    const deferredGuidedGmChoice = input.allowExtendedActionDeclaration === true
      && input.definition.spec.implementationState === 'guided'
      && choice.kind === 'gm-adjudication'
    if (input.selectedChoices && !input.allowIncompleteSelections && !deferredGuidedGmChoice
      && (selected.length < choice.minimum || selected.length > choice.maximum)) {
      reasons.push(reason('action.parameters-required', `Choice ${choice.choiceId} is incomplete.`))
    }
    if (choice.optionSource === 'spec') {
      const legalOptions = new Set(choice.options.map(option => option.optionId))
      if (selected.some(optionId => !legalOptions.has(optionId))) reasons.push(reason('target.invalid', `Choice ${choice.choiceId} contains an unavailable option.`))
      continue
    }
    const effectId = choice.kind === 'condition' && choice.choiceId.startsWith('condition:')
      ? choice.choiceId.slice('condition:'.length)
      : null
    const removal = effectId
      ? input.definition.spec.effects.find(effect => effect.operation === 'remove-conditions'
        && effect.effectId === effectId && effect.selection === 'choose-one')
      : null
    const selectedTarget = selectedIds.length === 1
      ? legalTargets.find(target => target.participantId === selectedIds[0])
      : null
    const advancementChoice = selectedTarget?.permanentAdvancementPreview?.choices
      .find(candidate => candidate.choiceId === choice.choiceId)
    const machineChoice = selectedTarget?.machineMoveLearningPreview?.choices
      .find(candidate => candidate.choiceId === choice.choiceId)
    const evolutionChoice = selectedTarget?.itemEvolutionPreview?.choices
      .find(candidate => candidate.choiceId === choice.choiceId)
    const explorationChoice = selectedTarget?.explorationChoices
      ?.find(candidate => candidate.choiceId === choice.choiceId)
    const authoritativeChoice = advancementChoice ?? machineChoice ?? evolutionChoice
    const authoritativeOptions = removal && selectedTarget
      ? selectedTarget.conditionRemovalPreview?.options.map(option => option.conditionId) ?? []
      : explorationChoice?.options.map(option => option.optionId)
        ?? authoritativeChoice?.options.map(option => option.optionId) ?? []
    if (selected.some(optionId => !authoritativeOptions.includes(optionId))) {
      reasons.push(reason('target.invalid', `Choice ${choice.choiceId} contains an unavailable option.`))
    }
    if (input.selectedChoices
      && (removal || choice.kind === 'move' || choice.kind === 'stat' || choice.kind === 'destination'
        || choice.choiceId === ITEM_EXPLORATION_USE_MODE_CHOICE_ID
        || choice.choiceId === ITEM_DOWSING_TERRAIN_CHOICE_ID
        || choice.choiceId === ITEM_DOWSING_SKILL_STUNT_CHOICE_ID) && !selectedTarget) {
      reasons.push(reason('target.required', 'Choose an eligible target before completing this item choice.'))
    }
    if (input.selectedChoices && !removal && !authoritativeChoice && !explorationChoice) {
      reasons.push(reason('action.parameters-required', `Choice ${choice.choiceId} has no registered authority provider.`))
    }
  }
  if (input.selectedChoices && [...declaredChoices.keys()].some(choiceId => (
    !input.definition.spec.choices.some(choice => choice.choiceId === choiceId)
    && choiceId !== targetSpec?.targetId
  ))) reasons.push(reason('target.invalid', 'The item command contains an unknown choice identity.'))
  const selectedTargets = selectedIds.flatMap(id => {
    const target = legalTargets.find(value => value.participantId === id)
    if (!target) return []
    const placement = input.map.placements.find(value => value.id === id)!
    const sheet = input.sheets.get(`${target.sheetKind}:${target.sheetSlug}`)!
    return [{ participantId: id, placement, sheet }]
  })
  return Object.freeze({
    available: reasons.length === 0,
    reasons: Object.freeze([...new Map(reasons.map(value => [`${value.code}:${value.label}`, value])).values()]),
    legalTargets,
    targetOptions,
    selectedTargets: Object.freeze(selectedTargets),
  })
}

/** Derive safe offer availability and legal targets from a projection snapshot. */
export const projectEncounterItemEligibility = (
  input: ProjectEncounterItemEligibilityInput,
): AuthoritativeItemEligibility => {
  const sheets = sheetMap(input.pokemonSheets, input.trainerSheets)
  const actorSheet = sheets.get(`${input.actorPlacement.sheetKind}:${input.actorPlacement.sheetSlug}`)
  if (!actorSheet) return Object.freeze({
    available: false,
    reasons: Object.freeze([reason('source.missing', 'The item actor sheet is unavailable.')]),
    legalTargets: Object.freeze([]),
    targetOptions: Object.freeze([]),
    selectedTargets: Object.freeze([]),
  })
  return evaluate({
    definition: input.definition,
    context: 'encounter',
    map: input.map,
    actorPlacement: input.actorPlacement,
    actorSheet,
    sourceQuantity: input.sourceQuantity,
    sheets,
    controlledTargetIds: new Set([input.actorPlacement.id]),
    includeUnavailableTargetOptions: true,
    wonderLauncherDelivery: input.wonderLauncherDelivery,
  })
}

const sheetEvaluationEnvironment = (input: {
  readonly actorSheet: AuthoritativeItemExecutionSheet
  readonly sheets: ReadonlyMap<string, AuthoritativeItemExecutionSheet>
  readonly evaluatedAt: number
}): { readonly map: TabletopMap, readonly actorPlacement: SheetPlacement } => {
  if (!Number.isSafeInteger(input.evaluatedAt) || input.evaluatedAt < 0) {
    throw new Error('Sheet item eligibility requires a valid server time boundary.')
  }
  const orderedSheets = [input.actorSheet, ...[...input.sheets.values()]
    .filter(sheet => sheet.kind !== input.actorSheet.kind || sheet.slug !== input.actorSheet.slug)
    .sort((left, right) => `${left.kind}:${left.slug}`.localeCompare(`${right.kind}:${right.slug}`))]
  const placements: SheetPlacement[] = orderedSheets.map((sheet) => ({
    id: sheetItemTargetId(sheet.kind, sheet.slug),
    sheetKind: sheet.kind,
    sheetSlug: sheet.slug,
    // Sheet actions deliberately carry no spatial authority. Supported common
    // actions have no range/line-of-sight requirement; co-location is only an
    // adapter for the shared target/prerequisite evaluator.
    position: { x: 0, y: 0, z: 0 },
  }))
  const actorPlacement = placements[0]!
  return Object.freeze({
    actorPlacement,
    map: Object.freeze({
      schemaVersion: 2 as const,
      slug: 'sheet-item-authority',
      name: 'Sheet item authority',
      dimensions: { x: 1, y: 1, z: 1 },
      voxels: [],
      placements,
      activeScene: null,
      updatedAt: input.evaluatedAt,
    }),
  })
}

const actorOwnedTargetIds = (
  actorSheet: AuthoritativeItemExecutionSheet,
  map: TabletopMap,
): ReadonlySet<string> => {
  const owned = new Set<string>()
  for (const placement of map.placements) {
    if (placement.sheetKind === actorSheet.kind && placement.sheetSlug === actorSheet.slug) {
      owned.add(placement.id)
    }
  }
  if (actorSheet.kind !== 'trainer') return owned
  const trainer = actorSheet.sheet as TrainerSheet
  const roster = new Set([...(trainer.currentTeam ?? []), ...(trainer.boxedPokemon ?? [])]
    .filter((slug): slug is string => typeof slug === 'string' && slug.trim().length > 0)
    .map(slug => slug.trim()))
  for (const placement of map.placements) {
    if (placement.sheetKind === 'pokemon' && roster.has(placement.sheetSlug)) owned.add(placement.id)
  }
  return owned
}

/** Derive common out-of-encounter targets without manufacturing map geometry. */
export const projectSheetItemEligibility = (
  input: ProjectSheetItemEligibilityInput,
): AuthoritativeItemEligibility => {
  const sheets = sheetMap(input.pokemonSheets, input.trainerSheets)
  const actorSlug = input.actorSheet.slug
  const actorSheet = sheets.get(`${input.actorSheetKind}:${actorSlug}`)
  if (!actorSheet) return Object.freeze({
    available: false,
    reasons: Object.freeze([reason('source.missing', 'The item actor sheet is unavailable.')]),
    legalTargets: Object.freeze([]),
    targetOptions: Object.freeze([]),
    selectedTargets: Object.freeze([]),
  })
  const environment = sheetEvaluationEnvironment({ actorSheet, sheets, evaluatedAt: input.evaluatedAt })
  const targetRelationship = input.definition.spec.targets[0]?.relationship
  const controlledTargetIds = targetRelationship === 'owned'
    ? actorOwnedTargetIds(actorSheet, environment.map)
    : new Set(environment.map.placements.map(placement => placement.id))
  return evaluate({
    definition: input.definition,
    context: 'sheet',
    map: environment.map,
    actorPlacement: environment.actorPlacement,
    actorSheet,
    sourceQuantity: input.sourceQuantity,
    sheets,
    controlledTargetIds,
    includeUnavailableTargetOptions: true,
    sourceInstanceId: input.sourceInstanceId,
    campaignMinute: input.campaignMinute,
    gmAuthority: input.gmAuthority,
  })
}

const authoritativeEvaluationEnvironment = (
  context: AuthoritativeItemExecutionContext,
): { readonly map: TabletopMap, readonly actorPlacement: SheetPlacement, readonly controlledTargetIds: ReadonlySet<string> } => {
  if (context.map && context.actorPlacement) return {
    map: context.map,
    actorPlacement: context.actorPlacement,
    controlledTargetIds: new Set(context.map.placements
      .filter(placement => placement.sheetKind === context.actorSheet.kind && placement.sheetSlug === context.actorSheet.slug)
      .map(placement => placement.id)),
  }
  const environment = sheetEvaluationEnvironment({
    actorSheet: context.actorSheet,
    sheets: context.sheets,
    evaluatedAt: context.authorityTimestamp,
  })
  const authorizedTargetIds = new Set(
    context.nonEncounter?.targetAuthorities.map(target => target.targetId) ?? [],
  )
  const controlledTargetIds = context.sourceDefinition.spec.targets[0]?.relationship === 'owned'
    ? new Set(context.nonEncounter?.targetAuthorities
        .filter(target => target.authority === 'actor' || target.authority === 'actor-roster')
        .map(target => target.targetId) ?? [])
    : authorizedTargetIds
  const map = Object.freeze({
    ...environment.map,
    placements: environment.map.placements.filter(placement => authorizedTargetIds.has(placement.id)),
  })
  return {
    map,
    actorPlacement: environment.actorPlacement,
    controlledTargetIds,
  }
}

/** Re-authorize selected targets, prerequisites, timing, and resources at execution. */
export const deriveAuthoritativeItemEligibility = (
  context: AuthoritativeItemExecutionContext,
): AuthoritativeItemEligibility => {
  const environment = authoritativeEvaluationEnvironment(context)
  return evaluate({
    definition: context.sourceDefinition,
    context: context.command.context,
    map: environment.map,
    actorPlacement: environment.actorPlacement,
    actorSheet: context.actorSheet,
    sourceQuantity: context.source.quantity,
    sheets: context.sheets,
    controlledTargetIds: environment.controlledTargetIds,
    selectedTargetIds: context.command.targetIds,
    selectedChoices: new Map(context.command.choices.map(choice => [choice.choiceId, choice.optionIds])),
    sourceInstanceId: context.source.instanceId,
    campaignMinute: context.nonEncounter?.campaignTime.campaignMinute,
    nonEncounter: context.nonEncounter,
    wonderLauncherDelivery: context.command.delivery?.kind === 'wonder-launcher',
  })
}

/** Validate a selected Extended Action declaration without applying its deferred effects. */
export const deriveAuthoritativeItemExtendedActionDeclarationEligibility = (
  context: AuthoritativeItemExecutionContext,
): AuthoritativeItemEligibility => {
  const environment = authoritativeEvaluationEnvironment(context)
  return evaluate({
    definition: context.sourceDefinition,
    context: context.command.context,
    map: environment.map,
    actorPlacement: environment.actorPlacement,
    actorSheet: context.actorSheet,
    sourceQuantity: context.source.quantity,
    sheets: context.sheets,
    controlledTargetIds: environment.controlledTargetIds,
    selectedTargetIds: context.command.targetIds,
    selectedChoices: new Map(context.command.choices.map(choice => [choice.choiceId, choice.optionIds])),
    sourceInstanceId: context.source.instanceId,
    campaignMinute: context.nonEncounter?.campaignTime.campaignMinute,
    allowExtendedActionDeclaration: true,
    nonEncounter: context.nonEncounter,
  })
}

/** Derive the fixed legal option set before an unresolved command is reserved. */
export const deriveAuthoritativeItemPendingEligibility = (
  context: AuthoritativeItemExecutionContext,
): AuthoritativeItemEligibility => {
  const environment = authoritativeEvaluationEnvironment(context)
  return evaluate({
    definition: context.sourceDefinition,
    context: context.command.context,
    map: environment.map,
    actorPlacement: environment.actorPlacement,
    actorSheet: context.actorSheet,
    sourceQuantity: context.source.quantity,
    sheets: context.sheets,
    controlledTargetIds: environment.controlledTargetIds,
    selectedTargetIds: context.command.targetIds,
    selectedChoices: new Map(context.command.choices.map(choice => [choice.choiceId, choice.optionIds])),
    sourceInstanceId: context.source.instanceId,
    campaignMinute: context.nonEncounter?.campaignTime.campaignMinute,
    allowIncompleteSelections: true,
    nonEncounter: context.nonEncounter,
    wonderLauncherDelivery: context.command.delivery?.kind === 'wonder-launcher',
  })
}
