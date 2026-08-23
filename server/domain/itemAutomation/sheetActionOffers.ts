import { createHash } from 'node:crypto'
import { encounterPresentationStableId } from '#shared/encounterPresentation'
import {
  SHEET_ITEM_ACTION_LIMITS,
  SHEET_ITEM_ACTION_SCHEMA_VERSION,
  type SheetItemActionChoice,
  type SheetItemActionControl,
  type SheetItemActionOfferV1,
  type SheetItemActionProjectionV1,
  type SheetItemActionReason,
  type SheetItemTargetOption,
  type SheetItemTargetPreviewFact,
} from '#shared/itemAutomation/sheetActions'
import { itemInventoryInstanceId, type ItemInventorySection } from '#shared/itemAutomation/inventory'
import {
  equipmentActionPresentationsForItem,
  equipmentEncounterContinuationLabel,
} from '#shared/itemAutomation/equipmentActionPresentation'
import {
  parseSerializedEquipmentInventoryState,
  parseSheetEquipmentStateForOwner,
} from '#shared/itemAutomation/equipment'
import type { ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { InventoryEntry, TrainerSheet } from '~/types/trainerSheet'
import { computePokemonHealingVitals, computeTrainerHealingVitals } from '~/utils/sheets/healing'
import { resolvePokemonVitaminSummary } from '~/utils/sheets/pokemonVitamins'
import { computePokemonTutorPointsEarnedForSheet } from '~/utils/sheets/pokemonTutorPoints'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY, resolveCanonicalItemId } from './registry'
import {
  equipmentConfigurationCandidatesForOwner,
  evaluateEquipmentCompatibility,
} from './equipmentCompatibility'
import { equipmentDefinitionFor } from './equipmentDefinitionRegistry'
import { projectSheetItemEligibility, type ItemEligibilityReason, type ItemTargetOption } from './eligibility'

const SECTIONS = ['keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment'] as const
const SECTION_LABELS: Readonly<Record<ItemInventorySection, string>> = Object.freeze({
  keyItems: 'Key Items',
  pokemonItems: 'Pokémon Items',
  medicalKit: 'Medical Kit',
  pokeBalls: 'Poké Balls & Accessories',
  foodStuff: 'Food Stuff',
  equipment: 'Equipment',
})
const COMMON_SHEET_EFFECTS = new Set([
  'heal-hp', 'remove-conditions', 'revive', 'apply-medical-treatment',
  'modify-base-stat', 'grant-tutor-points', 'increase-move-frequency',
  'gain-next-level-experience', 'learn-machine-move', 'evolve-pokemon',
  'use-bait', 'start-route-lure', 'use-snack-or-bait', 'use-repel', 'search-for-shards',
  'guided',
])

export interface ProjectTrainerSheetItemActionsInput {
  readonly trainerSheet: TrainerSheet
  readonly pokemonSheets: readonly CharacterSheet[]
  /** The actor plus any other explicitly authorised Trainer target sheets. */
  readonly trainerSheets?: readonly TrainerSheet[]
  readonly generatedAt: number
  /** Authoritative campaign minute; legacy pure projections default to campaign start. */
  readonly campaignMinute?: number
  readonly targetLimitExceeded?: boolean
  readonly gmAuthority?: boolean
}

const safeRevision = (sheet: CharacterSheet | TrainerSheet): number => {
  const revision = Number(sheet.revision ?? 0)
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error(`Sheet ${sheet.slug} has an invalid item-action revision.`)
  return revision
}

const quantity = (entry: InventoryEntry, section: ItemInventorySection): number => {
  if (entry.serializedEquipment !== undefined) {
    parseSerializedEquipmentInventoryState(entry.serializedEquipment)
    return 1
  }
  if (section === 'equipment') return 1
  const value = entry.qty ?? 1
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0
}

const reason = (code: string, label: string): SheetItemActionReason => Object.freeze({ code, label })
const projectedReason = (value: ItemEligibilityReason): SheetItemActionReason => reason(value.code, value.label)

const commonSheetDefinition = (definition: ItemRuntimeDefinition | null): definition is ItemRuntimeDefinition => Boolean(
  definition
  && (definition.spec.implementationState === 'native' || definition.spec.implementationState === 'guided')
  && definition.spec.contexts.includes('sheet')
  && definition.spec.effects.length > 0
  && definition.spec.effects.every(effect => COMMON_SHEET_EFFECTS.has(effect.operation))
  && definition.spec.targets.length === 1
  && definition.spec.targets[0]?.kind === 'participant'
  && definition.spec.targets[0].rangeMeters === null
  && definition.spec.targets[0].requiresLineOfSight === false,
)

const inventoryRows = (sheet: TrainerSheet): readonly {
  readonly section: ItemInventorySection
  readonly rowIndex: number
  readonly entry: InventoryEntry
}[] => SECTIONS.flatMap(section => (sheet.inventory?.[section] ?? []).map((entry, rowIndex) => ({
  section,
  rowIndex,
  entry,
}))).filter(row => row.entry.name.trim().length > 0)

const timingLabel = (definition: ItemRuntimeDefinition | null): string => definition?.spec.timing === 'extended'
  ? 'Extended Action'
  : definition ? 'Outside encounter' : 'No sheet timing'

const inventorySourceSelectionId = (offerId: string): string => (
  `inventory-source:v1:${createHash('sha256').update(offerId).digest('hex').slice(0, 32)}`
)

const projectedCosts = (definition: ItemRuntimeDefinition | null, entry: InventoryEntry): readonly string[] => {
  if (!definition) return Object.freeze([])
  return Object.freeze([
    ...definition.spec.costs.filter(cost => cost.kind !== 'action').map(cost => cost.label),
    ...(!definition.spec.consumption.reusable && definition.spec.consumption.quantity > 0
      ? [`Consume ${definition.spec.consumption.quantity} ${entry.name}`]
      : []),
  ])
}

const sheetSummary = (option: ItemTargetOption, sheets: ReadonlyMap<string, CharacterSheet | TrainerSheet>): string | null => {
  const sheet = sheets.get(`${option.sheetKind}:${option.sheetSlug}`)
  if (!sheet) return null
  if (option.itemEvolutionPreview && option.sheetKind === 'pokemon') {
    const pokemon = sheet as CharacterSheet
    return `Level ${pokemon.level} · ${pokemon.species}`
  }
  if (option.machineMoveLearningPreview && option.sheetKind === 'pokemon') {
    const pokemon = sheet as CharacterSheet
    const available = computePokemonTutorPointsEarnedForSheet(pokemon) - (pokemon.tutorPoints?.spent ?? 0)
    return `${pokemon.movelist?.length ?? 0} active Moves · ${available} Tutor Points available`
  }
  if (option.permanentAdvancementPreview && option.sheetKind === 'pokemon') {
    if (option.permanentAdvancementPreview.kind === 'rare-candy') {
      return `Level ${(sheet as CharacterSheet).level}`
    }
    if (option.permanentAdvancementPreview.kind === 'stat-suppressant') {
      return 'Permanent Base Stat choice · Trainer consent required'
    }
    const summary = resolvePokemonVitaminSummary(sheet as CharacterSheet)
    return `${summary.vitaminSlotsUsed} / 5 vitamins used`
  }
  const vitals = option.sheetKind === 'pokemon'
    ? computePokemonHealingVitals(sheet as CharacterSheet)
    : computeTrainerHealingVitals(sheet as TrainerSheet)
  return `HP ${vitals.currentHp} / ${vitals.maxHp}`
}

const targetPreviewFacts = (option: ItemTargetOption): readonly SheetItemTargetPreviewFact[] => {
  const facts: SheetItemTargetPreviewFact[] = []
  const healing = option.healingPreview
  if (healing) {
    const minimumResult = healing.currentHp + healing.minimumEffectiveHealing
    const maximumResult = healing.currentHp + healing.maximumEffectiveHealing
    facts.push(Object.freeze({
      label: 'HP after use',
      value: minimumResult === maximumResult
        ? `${healing.currentHp} → ${maximumResult} HP`
        : `${healing.currentHp} → ${minimumResult}–${maximumResult} HP`,
      tone: 'positive' as const,
    }))
    facts.push(Object.freeze({
      label: minimumResult === maximumResult ? 'Restores' : 'Restores (range)',
      value: healing.minimumEffectiveHealing === healing.maximumEffectiveHealing
        ? `+${healing.maximumEffectiveHealing} HP`
        : `+${healing.minimumEffectiveHealing}–${healing.maximumEffectiveHealing} HP`,
      tone: 'positive' as const,
    }))
    if (healing.minimumEffectiveHealing !== healing.maximumEffectiveHealing) facts.push(Object.freeze({
      label: 'Expected',
      value: `+${healing.expectedEffectiveHealing} HP`,
      tone: 'neutral' as const,
    }))
    if (healing.maximumOverheal > 0) facts.push(Object.freeze({
      label: 'Possible overheal',
      value: healing.minimumOverheal === healing.maximumOverheal
        ? `${healing.maximumOverheal} HP`
        : `${healing.minimumOverheal}–${healing.maximumOverheal} HP`,
      tone: 'warning' as const,
    }))
  }
  const removal = option.conditionRemovalPreview
  if (removal?.hasApplicableCondition) facts.push(Object.freeze({
    label: removal.options.length === 1 ? 'Cures' : 'Conditions in scope',
    value: removal.removableLabels.join(', '),
    tone: 'positive' as const,
  }))
  const advancement = option.permanentAdvancementPreview
  if (advancement) facts.push(...advancement.previewFacts.map(fact => Object.freeze({ ...fact })))
  const machineLearning = option.machineMoveLearningPreview
  if (machineLearning) facts.push(...machineLearning.previewFacts.map(fact => Object.freeze({ ...fact })))
  const evolution = option.itemEvolutionPreview
  if (evolution) facts.push(...evolution.previewFacts.map(fact => Object.freeze({ ...fact })))
  const revival = option.revivalPreview
  if (revival) {
    facts.push(Object.freeze({
      label: 'HP after use',
      value: `${revival.currentHp} → ${revival.resultingHp} HP`,
      tone: 'positive' as const,
    }))
    facts.push(Object.freeze({ label: 'Condition', value: 'Fainted cleared', tone: 'positive' as const }))
  }
  return Object.freeze(facts.slice(0, SHEET_ITEM_ACTION_LIMITS.previewFactsPerTarget))
}

const targetChoices = (option: ItemTargetOption): readonly SheetItemActionChoice[] => Object.freeze([
  ...(option.permanentAdvancementPreview?.choices
    ?? option.machineMoveLearningPreview?.choices
    ?? option.itemEvolutionPreview?.choices
    ?? []).map(choice => Object.freeze({
    choiceId: choice.choiceId,
    label: choice.label,
    presentation: choice.presentation,
    minimum: choice.minimum,
    maximum: choice.maximum,
    options: Object.freeze(choice.options.map(value => Object.freeze({
      optionId: value.optionId,
      label: value.label,
      description: value.description,
      previewFacts: Object.freeze(value.previewFacts.map(fact => Object.freeze({ ...fact }))),
    }))),
  })),
  ...option.explorationChoices
    .filter(choice => choice.minimum > 0 || choice.options.length > 0)
    .map(choice => Object.freeze({
      choiceId: choice.choiceId,
      label: choice.label,
      presentation: 'radio' as const,
      minimum: choice.minimum,
      maximum: choice.maximum,
      options: Object.freeze(choice.options.map(value => Object.freeze({
        optionId: value.optionId,
        label: value.label,
        description: value.description,
        previewFacts: Object.freeze([]),
      }))),
    })),
])

const targetOption = (
  option: ItemTargetOption,
  sheets: ReadonlyMap<string, CharacterSheet | TrainerSheet>,
): SheetItemTargetOption => {
  const unavailableReason = option.unavailableReason ? projectedReason(option.unavailableReason) : null
  return Object.freeze({
    targetId: option.participantId,
    sheetKind: option.sheetKind,
    sheetSlug: option.sheetSlug,
    label: option.label,
    kindLabel: option.sheetKind === 'trainer' ? 'Trainer' : 'Pokémon',
    summary: sheetSummary(option, sheets),
    description: option.description,
    href: option.sheetKind === 'trainer'
      ? `/sheets/trainers/${encodeURIComponent(option.sheetSlug)}`
      : `/sheets/${encodeURIComponent(option.sheetSlug)}`,
    enabled: unavailableReason === null,
    unavailableReason,
    previewFacts: targetPreviewFacts(option),
    choices: targetChoices(option),
  })
}

const controls = (input: {
  readonly useUnavailable: SheetItemActionReason | null
  readonly inspectHref: string | null
  readonly equipUnavailable?: SheetItemActionReason | null
}): readonly SheetItemActionControl[] => Object.freeze([
  Object.freeze({
    kind: 'use' as const,
    label: 'Use',
    enabled: input.useUnavailable === null,
    unavailableReason: input.useUnavailable,
    href: null,
  }),
  Object.freeze({
    kind: 'inspect' as const,
    label: 'Inspect',
    enabled: input.inspectHref !== null,
    unavailableReason: input.inspectHref ? null : reason('reference.unavailable', 'No canonical item reference is available.'),
    href: input.inspectHref,
  }),
  ...(input.equipUnavailable !== undefined ? [Object.freeze({
    kind: 'equip' as const,
    label: 'Equip',
    enabled: input.equipUnavailable === null,
    unavailableReason: input.equipUnavailable,
    href: null,
  })] : []),
])

const trainerEquipmentUnavailable = (input: {
  readonly trainerSheet: TrainerSheet
  readonly canonicalItemId: string | null
  readonly sourceIdentityValid: boolean
  readonly duplicatedRowId: boolean
}): SheetItemActionReason | null | undefined => {
  if (!input.canonicalItemId) return undefined
  const definition = equipmentDefinitionFor(input.canonicalItemId)
  const ownerRule = definition?.ownerRules.find(rule => rule.ownerKind === 'trainer')
  if (!definition || !ownerRule) return undefined
  if (input.duplicatedRowId) return reason('source.identity-conflict', 'This inventory row identity is duplicated.')
  if (!input.sourceIdentityValid) return reason('source.identity-required', 'Save this inventory row before equipping it.')
  let state
  try {
    state = parseSheetEquipmentStateForOwner(input.trainerSheet.equipmentState, {
      kind: 'trainer', slug: input.trainerSheet.slug,
    })
  }
  catch {
    return reason('equipment.state-invalid', 'Current equipment authority is unavailable. Refresh before equipping.')
  }
  const owner = { kind: 'trainer' as const, slug: input.trainerSheet.slug, sheet: input.trainerSheet }
  const configurations = equipmentConfigurationCandidatesForOwner({ owner, definition })
  if (!configurations.length) {
    return reason('equipment.configuration-unavailable', 'Current reviewed configuration choices are unavailable for this Trainer.')
  }
  const results = ownerRule.slotOptions.flatMap(slotIds => configurations.map(configuration => evaluateEquipmentCompatibility({
    owner,
    equipmentState: state,
    canonicalItemId: input.canonicalItemId!,
    canonicalRecordSha256: definition.canonicalRecordSha256,
    requestedSlots: slotIds,
    configuration: configuration.configuration,
  })))
  if (results.some(result => result.eligible)) return null
  const unavailable = results.flatMap(result => result.unavailableReason ? [result.unavailableReason] : [])[0]
  return unavailable
    ? reason(unavailable.code, unavailable.message)
    : reason('equipment.unavailable', 'No compatible Trainer equipment slot is available.')
}

/** Project owner-safe common actions from exact persisted inventory and target sheets. */
export const projectTrainerSheetItemActions = (
  input: ProjectTrainerSheetItemActionsInput,
): SheetItemActionProjectionV1 => {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error('Sheet item projection requires a valid server timestamp.')
  const campaignMinute = input.campaignMinute ?? 0
  if (!Number.isSafeInteger(campaignMinute) || campaignMinute < 0) throw new Error('Sheet item projection requires a valid campaign minute.')
  const trainerRevision = safeRevision(input.trainerSheet)
  const rows = inventoryRows(input.trainerSheet)
  if (rows.length > SHEET_ITEM_ACTION_LIMITS.offers) {
    throw new Error(`Trainer inventory supports at most ${SHEET_ITEM_ACTION_LIMITS.offers} projected item rows.`)
  }
  const trainerSheets = [input.trainerSheet, ...(input.trainerSheets ?? []).filter(sheet => sheet.slug !== input.trainerSheet.slug)]
  const pokemonSheets = [...input.pokemonSheets]
  for (const sheet of [...trainerSheets, ...pokemonSheets]) safeRevision(sheet)
  const sheets = new Map<string, CharacterSheet | TrainerSheet>([
    ...trainerSheets.map(sheet => [`trainer:${sheet.slug}`, sheet] as const),
    ...pokemonSheets.map(sheet => [`pokemon:${sheet.slug}`, sheet] as const),
  ])
  const rowIdCounts = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.section}:${row.entry.id ?? ''}`
    rowIdCounts.set(key, (rowIdCounts.get(key) ?? 0) + 1)
  }

  const offers = rows.map((row): SheetItemActionOfferV1 => {
    const canonicalId = resolveCanonicalItemId(row.entry.name)
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(row.entry.name)
    const executable = commonSheetDefinition(definition)
    const encounterActions = equipmentActionPresentationsForItem(canonicalId)
    const encounterContinuation = equipmentEncounterContinuationLabel(canonicalId)
    let sourceIdentityValid = false
    let sourceInstanceId: string | null = null
    try {
      if (row.entry.id?.trim()) {
        sourceInstanceId = itemInventoryInstanceId({
          containerKind: 'trainer',
          containerSlug: input.trainerSheet.slug,
          section: row.section,
          rowId: row.entry.id,
        })
        sourceIdentityValid = true
      }
    }
    catch {
      sourceIdentityValid = false
      sourceInstanceId = null
    }
    const duplicatedRowId = Boolean(row.entry.id && rowIdCounts.get(`${row.section}:${row.entry.id}`)! > 1)
    const eligibility = executable && !input.targetLimitExceeded
      ? projectSheetItemEligibility({
          definition,
          actorSheetKind: 'trainer',
          actorSheet: input.trainerSheet,
          sourceQuantity: quantity(row.entry, row.section),
          pokemonSheets,
          trainerSheets,
          evaluatedAt: input.generatedAt,
          sourceInstanceId: sourceInstanceId ?? 'invalid-source-identity',
          campaignMinute,
          gmAuthority: input.gmAuthority,
        })
      : null
    const useUnavailable = input.targetLimitExceeded
      ? reason('target.limit-exceeded', `Sheet item actions support at most ${SHEET_ITEM_ACTION_LIMITS.targetsPerOffer} linked targets.`)
      : duplicatedRowId
        ? reason('source.identity-conflict', 'This inventory row identity is duplicated.')
        : !sourceIdentityValid
          ? reason('source.identity-required', 'Save this inventory row before using it.')
          : !canonicalId
            ? reason('action.unsupported', 'No reviewed item action is available.')
            : !executable && encounterContinuation
              ? reason('action.encounter-only', encounterContinuation)
              : !executable
                ? reason('action.unsupported', 'No reviewed common sheet action is available for this item.')
                : eligibility?.reasons[0] ? projectedReason(eligibility.reasons[0]) : null
    const inspectHref = canonicalId ? `/items/${encodeURIComponent(canonicalId)}` : null
    const equipUnavailable = trainerEquipmentUnavailable({
      trainerSheet: input.trainerSheet,
      canonicalItemId: canonicalId,
      sourceIdentityValid,
      duplicatedRowId,
    })
    const baseId = encounterPresentationStableId(
      'sheet-item', input.trainerSheet.slug, row.section, `row-${row.rowIndex}`,
    )
    const offerId = encounterPresentationStableId(
      'offer', baseId, String(trainerRevision), definition?.definitionSha256 ?? canonicalId ?? 'unresolved',
    )
    const projectedTargets = eligibility?.targetOptions.map(option => targetOption(option, sheets)) ?? []
    return Object.freeze({
      schemaVersion: SHEET_ITEM_ACTION_SCHEMA_VERSION,
      offerId,
      actor: Object.freeze({
        sheetKind: 'trainer' as const,
        sheetSlug: input.trainerSheet.slug,
        revision: trainerRevision,
        label: input.trainerSheet.name.trim() || input.trainerSheet.slug,
        href: `/sheets/trainers/${encodeURIComponent(input.trainerSheet.slug)}`,
      }),
      source: Object.freeze({
        sourceSelectionId: inventorySourceSelectionId(offerId),
        containerKind: 'trainer' as const,
        containerLabel: 'Trainer inventory' as const,
        canonicalId,
        displayName: row.entry.name,
        section: row.section,
        sectionLabel: SECTION_LABELS[row.section],
        rowIndex: row.rowIndex,
        rowLabel: `Row ${row.rowIndex + 1}`,
        quantity: quantity(row.entry, row.section),
      }),
      context: 'sheet' as const,
      description: executable
        ? definition.spec.presentation.description
        : encounterActions.length
          ? `Reviewed live encounter actions: ${encounterActions.map(action => action.label).join(', ')}.`
          : null,
      timingLabel: executable ? timingLabel(definition) : encounterActions.length ? 'Live encounter' : timingLabel(null),
      costs: projectedCosts(executable ? definition : null, row.entry),
      acceptanceNotice: executable
        ? definition.spec.consumption.reusable
          ? 'Reusable item; no inventory unit is consumed.'
          : `Consumes ${definition.spec.consumption.quantity} when accepted.`
        : encounterContinuation ?? 'No item use will be submitted.',
      availability: Object.freeze({ enabled: useUnavailable === null, unavailableReason: useUnavailable }),
      actions: controls({ useUnavailable, inspectHref, equipUnavailable }),
      targeting: executable ? Object.freeze({
        requirementId: definition.spec.targets[0]!.targetId,
        minimum: definition.spec.targets[0]!.minimum,
        maximum: definition.spec.targets[0]!.maximum,
        options: Object.freeze(projectedTargets),
      }) : null,
    })
  })

  return Object.freeze({
    schemaVersion: SHEET_ITEM_ACTION_SCHEMA_VERSION,
    trainerSlug: input.trainerSheet.slug,
    trainerRevision,
    generatedAt: input.generatedAt,
    offers: Object.freeze(offers),
  })
}

export interface ProjectGroupInventoryItemActionsInput {
  readonly groupInventory: GroupInventoryDocument
  readonly trainerSheet: TrainerSheet
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets?: readonly TrainerSheet[]
  readonly generatedAt: number
  readonly campaignMinute: number
  readonly targetLimitExceeded?: boolean
  readonly gmAuthority?: boolean
  readonly reservedQuantity?: (source: {
    readonly containerKind: 'group'
    readonly containerSlug: string
    readonly section: ItemInventorySection
    readonly rowId: string
  }) => number
}

/**
 * Project the existing sheet target/choice anatomy from exact shared custody.
 * The fixed table policy keeps durable Extended Actions transfer-first because
 * their lifecycle owns a Trainer-custody source lock beyond this immediate use.
 */
export const projectGroupInventoryItemActions = (
  input: ProjectGroupInventoryItemActionsInput,
): readonly SheetItemActionOfferV1[] => {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('Shared item projection requires a valid server timestamp.')
  }
  if (!Number.isSafeInteger(input.campaignMinute) || input.campaignMinute < 0) {
    throw new Error('Shared item projection requires a valid campaign minute.')
  }
  const groupRevision = Number(input.groupInventory.revision)
  if (!Number.isSafeInteger(groupRevision) || groupRevision < 0) {
    throw new Error('Group inventory has an invalid item-action revision.')
  }
  const trainerRevision = safeRevision(input.trainerSheet)
  const rows = SECTIONS.flatMap(section => (input.groupInventory.inventory[section] ?? [])
    .map((entry, rowIndex) => ({ section, rowIndex, entry })))
    .filter(row => row.entry.name.trim().length > 0)
  if (rows.length > SHEET_ITEM_ACTION_LIMITS.offers) {
    throw new Error(`Group inventory supports at most ${SHEET_ITEM_ACTION_LIMITS.offers} projected item rows.`)
  }
  const trainerSheets = [
    input.trainerSheet,
    ...(input.trainerSheets ?? []).filter(sheet => sheet.slug !== input.trainerSheet.slug),
  ]
  const pokemonSheets = [...input.pokemonSheets]
  for (const sheet of [...trainerSheets, ...pokemonSheets]) safeRevision(sheet)
  const sheets = new Map<string, CharacterSheet | TrainerSheet>([
    ...trainerSheets.map(sheet => [`trainer:${sheet.slug}`, sheet] as const),
    ...pokemonSheets.map(sheet => [`pokemon:${sheet.slug}`, sheet] as const),
  ])
  const rowIdCounts = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.section}:${row.entry.id ?? ''}`
    rowIdCounts.set(key, (rowIdCounts.get(key) ?? 0) + 1)
  }

  return Object.freeze(rows.map((row): SheetItemActionOfferV1 => {
    const canonicalId = resolveCanonicalItemId(row.entry.name)
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(row.entry.name)
    const commonExecutable = commonSheetDefinition(definition)
    const immediateExecutable = commonExecutable && definition.spec.timing !== 'extended'
    const encounterActions = equipmentActionPresentationsForItem(canonicalId)
    const encounterContinuation = equipmentEncounterContinuationLabel(canonicalId)
    let sourceInstanceId: string | null = null
    let sourceIdentityValid = false
    try {
      if (row.entry.id?.trim()) {
        sourceInstanceId = itemInventoryInstanceId({
          containerKind: 'group',
          containerSlug: input.groupInventory.slug,
          section: row.section,
          rowId: row.entry.id,
        })
        sourceIdentityValid = true
      }
    }
    catch {
      sourceInstanceId = null
      sourceIdentityValid = false
    }
    const duplicatedRowId = Boolean(row.entry.id && rowIdCounts.get(`${row.section}:${row.entry.id}`)! > 1)
    const totalQuantity = quantity(row.entry, row.section)
    const reserved = sourceIdentityValid ? input.reservedQuantity?.({
      containerKind: 'group',
      containerSlug: input.groupInventory.slug,
      section: row.section,
      rowId: row.entry.id!.trim(),
    }) ?? 0 : 0
    if (!Number.isSafeInteger(reserved) || reserved < 0 || reserved > totalQuantity) {
      throw new Error('Shared item reservation authority is inconsistent with current custody.')
    }
    const availableQuantity = totalQuantity - reserved
    const eligibility = immediateExecutable && !input.targetLimitExceeded && availableQuantity > 0
      ? projectSheetItemEligibility({
          definition,
          actorSheetKind: 'trainer',
          actorSheet: input.trainerSheet,
          sourceQuantity: availableQuantity,
          pokemonSheets,
          trainerSheets,
          evaluatedAt: input.generatedAt,
          sourceInstanceId: sourceInstanceId ?? 'invalid-source-identity',
          campaignMinute: input.campaignMinute,
          gmAuthority: input.gmAuthority,
        })
      : null
    const useUnavailable = input.targetLimitExceeded
      ? reason('target.limit-exceeded', `Shared item actions support at most ${SHEET_ITEM_ACTION_LIMITS.targetsPerOffer} linked targets.`)
      : duplicatedRowId
        ? reason('source.identity-conflict', 'This shared inventory row identity is duplicated.')
        : !sourceIdentityValid
          ? reason('source.identity-required', 'Save this shared inventory row before using it.')
          : availableQuantity < 1
            ? reason('source.quantity-reserved', 'Every unit in this shared row is reserved by pending item use.')
            : !canonicalId
              ? reason('action.unsupported', 'No reviewed item action is available.')
              : !commonExecutable && encounterContinuation
                ? reason('action.encounter-only', `Transfer this item to a Trainer first. ${encounterContinuation}`)
                : !commonExecutable
                  ? reason('action.unsupported', 'No reviewed common sheet action is available for this item.')
                  : !immediateExecutable
                  ? reason('source.trainer-custody-required', 'Transfer this item to a Trainer before starting its Extended Action.')
                  : eligibility?.reasons[0] ? projectedReason(eligibility.reasons[0]) : null
    const inspectHref = canonicalId ? `/items/${encodeURIComponent(canonicalId)}` : null
    const baseId = encounterPresentationStableId(
      'group-sheet-item', input.groupInventory.slug, input.trainerSheet.slug,
      row.section, `row-${row.rowIndex}`,
    )
    const offerId = encounterPresentationStableId(
      'offer', baseId, String(groupRevision), String(trainerRevision),
      definition?.definitionSha256 ?? canonicalId ?? 'unresolved',
    )
    const projectedTargets = eligibility?.targetOptions.map(option => targetOption(option, sheets)) ?? []
    return Object.freeze({
      schemaVersion: SHEET_ITEM_ACTION_SCHEMA_VERSION,
      offerId,
      actor: Object.freeze({
        sheetKind: 'trainer' as const,
        sheetSlug: input.trainerSheet.slug,
        revision: trainerRevision,
        label: input.trainerSheet.name.trim() || input.trainerSheet.slug,
        href: `/sheets/trainers/${encodeURIComponent(input.trainerSheet.slug)}`,
      }),
      source: Object.freeze({
        sourceSelectionId: inventorySourceSelectionId(offerId),
        containerKind: 'group' as const,
        containerLabel: 'Group inventory' as const,
        canonicalId,
        displayName: row.entry.name,
        section: row.section,
        sectionLabel: SECTION_LABELS[row.section],
        rowIndex: row.rowIndex,
        rowLabel: `Row ${row.rowIndex + 1}`,
        quantity: availableQuantity,
      }),
      context: 'sheet' as const,
      description: immediateExecutable
        ? definition.spec.presentation.description
        : encounterActions.length
          ? `Reviewed live encounter actions after Trainer transfer: ${encounterActions.map(action => action.label).join(', ')}.`
          : null,
      timingLabel: commonExecutable ? timingLabel(definition) : encounterActions.length ? 'Live encounter' : timingLabel(null),
      costs: projectedCosts(immediateExecutable ? definition : null, row.entry),
      acceptanceNotice: immediateExecutable
        ? definition.spec.consumption.reusable
          ? 'Reusable item; no inventory unit is consumed.'
          : `Consumes ${definition.spec.consumption.quantity} only when accepted.`
        : encounterContinuation
          ? `Transfer this item to a Trainer first. ${encounterContinuation}`
          : 'No shared item use will be submitted.',
      availability: Object.freeze({ enabled: useUnavailable === null, unavailableReason: useUnavailable }),
      actions: controls({ useUnavailable, inspectHref }),
      targeting: immediateExecutable ? Object.freeze({
        requirementId: definition.spec.targets[0]!.targetId,
        minimum: definition.spec.targets[0]!.minimum,
        maximum: definition.spec.targets[0]!.maximum,
        options: Object.freeze(projectedTargets),
      }) : null,
    })
  }))
}
