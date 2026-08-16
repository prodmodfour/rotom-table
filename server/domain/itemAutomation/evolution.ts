import { createHash } from 'node:crypto'
import pokedexJson from '~~/data/reference/pokedex.json'
import rulesJson from '~~/data/reference/rules.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  appendItemEvolutionApplication,
  itemEvolutionAttentionProjection,
  latestItemEvolutionApplication,
  parseItemEvolutionState,
  resolveItemEvolutionStatAttention,
  type ItemEvolutionAbilityMappingV1,
  type ItemEvolutionApplicationV1,
} from '#shared/itemAutomation/evolution'
import type { ItemEffectSpec, ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet, CharacterSheetAbility, StatKey } from '~/types/characterSheet'
import type {
  PokedexAbilities,
  PokedexBaseStats,
  PokedexRecord,
} from '~/types/pokemon'
import type {
  PtuItemEvolutionMechanicsV1,
  PtuItemEvolutionTransitionV1,
} from '~/types/ptuReference'
import {
  computeMaxHp,
  pokemonAddedStatPointBudget,
  pokemonBaseRelationWaivers,
  resolveStats,
  validateBaseRelations,
} from '~/utils/sheets/pokemonDerived'
import { sameJsonValue } from '~/utils/serialization'
import { applyCapabilityEvolutionTransition } from '../capabilityAutomation/evolutionProviders'
import { reconcileSheetEquipmentCompatibility } from './equipmentCompatibilityReconciliation'

export const ITEM_EVOLUTION_DESTINATION_CHOICE_ID = 'evolution-destination'
export const ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID = 'evolution-confirmation'

export interface ItemEvolutionPreviewFact {
  readonly label: string
  readonly value: string
  readonly tone: 'neutral' | 'positive' | 'warning'
}

export interface ItemEvolutionChoiceOption {
  readonly optionId: string
  readonly label: string
  readonly description: string | null
  readonly previewFacts: readonly ItemEvolutionPreviewFact[]
}

export interface ItemEvolutionChoice {
  readonly choiceId: string
  readonly label: string
  readonly presentation: 'radio' | 'confirmation'
  readonly minimum: 1
  readonly maximum: 1
  readonly options: readonly ItemEvolutionChoiceOption[]
}

export interface ItemEvolutionPreview {
  readonly kind: 'item-evolution'
  readonly description: string
  readonly previewFacts: readonly ItemEvolutionPreviewFact[]
  readonly choices: readonly ItemEvolutionChoice[]
  readonly selectionComplete: boolean
}

export interface ResolvedItemEvolution {
  readonly preview: ItemEvolutionPreview
  readonly sheet: CharacterSheet
  readonly payload: Record<string, unknown>
}

type EvolutionEffect = Extract<ItemEffectSpec, { readonly operation: 'evolve-pokemon' }>
type AbilityTier = keyof Pick<PokedexAbilities, 'basic' | 'advanced' | 'high'>

const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const ABILITY_TIERS: readonly AbilityTier[] = ['basic', 'advanced', 'high']
const canonicalPokedex = pokedexJson as unknown as readonly PokedexRecord[]
const pokedexBySpecies = new Map(canonicalPokedex.map(row => [row.species, row]))
const evolutionRuleRecord = (rulesJson as unknown as Record<string, {
  readonly itemEvolutionMechanics?: PtuItemEvolutionMechanicsV1
}>)['Evolutionary Items']
const evolutionMechanics = evolutionRuleRecord?.itemEvolutionMechanics
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const ruleRecordSha256 = sha256(stableJsonStringify(evolutionRuleRecord))
// Hash the large catalogue through canonical per-record digests so strict JSON
// resource limits remain bounded while every ordered record stays covered.
const pokedexCatalogSha256 = sha256(stableJsonStringify(
  canonicalPokedex.map(record => sha256(stableJsonStringify(record))),
))

if (!evolutionRuleRecord || !evolutionMechanics
  || evolutionMechanics.schemaVersion !== 1
  || evolutionMechanics.actorKind !== 'trainer'
  || evolutionMechanics.targetKind !== 'owned-pokemon'
  || evolutionMechanics.timing !== 'confirmed-instant'
  || evolutionMechanics.consumptionQuantity !== 1
  || evolutionMechanics.consumptionPhase !== 'accepted-use'
  || evolutionMechanics.identityPolicy !== 'retain-sheet-character-and-ownership-identity'
  || evolutionMechanics.statPolicy !== 'unallocate-added-points-then-owner-restat'
  || evolutionMechanics.abilityPolicy !== 'map-current-canonical-abilities-by-tier-and-slot'
  || evolutionMechanics.movePolicy !== 'retain-current-moves-and-create-bounded-opportunity-attention'
  || evolutionMechanics.skillsCapabilitiesPolicy !== 'adopt-destination-canonical-defaults-and-preserve-explicit-overrides'
  || evolutionMechanics.equipmentPolicy !== 'reconcile-current-equipment-against-destination-species'
  || evolutionMechanics.transitionCount !== 62
  || evolutionMechanics.transitions.length !== 62) {
  throw new Error('Canonical Evolutionary Item rule authority is unavailable or stale.')
}

const effectFor = (definition: ItemRuntimeDefinition): EvolutionEffect => {
  const effects = definition.spec.effects.filter((effect): effect is EvolutionEffect => effect.operation === 'evolve-pokemon')
  if (effects.length !== 1 || effects[0]?.transitionPolicyId !== definition.canonicalId
    || definition.spec.timing !== 'standard'
    || definition.spec.consumption.phase !== 'accepted-use'
    || definition.spec.consumption.quantity !== 1
    || definition.spec.consumption.reusable
    || definition.spec.privacy.choices !== 'actor-owner'
    || definition.spec.privacy.outcome !== 'actor-owner') {
    throw new Error('Evolutionary Item definition does not match reviewed transition authority.')
  }
  return effects[0]
}

const speciesRecord = (speciesId: string): PokedexRecord => pokedexBySpecies.get(speciesId)
  ?? (() => { throw new Error(`Canonical evolution species ${speciesId} is unavailable.`) })()
const speciesHash = (species: PokedexRecord): string => sha256(stableJsonStringify(species))
const normalize = (value: string | null | undefined): string => String(value ?? '').trim().toLocaleLowerCase('en-US')
const formatBaseStats = (stats: PokedexBaseStats | undefined): string => stats
  ? [stats.hp, stats.atk, stats.def, stats.spatk, stats.spdef, stats.spd].join(' / ')
  : 'Unavailable'
const formatTypes = (record: PokedexRecord): string => record.types?.join(' / ') || 'None recorded'

const transitionCandidates = (definition: ItemRuntimeDefinition, sheet: CharacterSheet): readonly PtuItemEvolutionTransitionV1[] => {
  effectFor(definition)
  if (sheet.itemEvolutionAttention?.statAllocation.status === 'open') {
    throw new Error('Allocate the pending evolution Stat Points before evolving again.')
  }
  const candidates = evolutionMechanics.transitions.filter(row => (
    row.itemId === definition.canonicalId && row.fromSpecies === sheet.species
  ))
  if (!candidates.length) throw new Error('This item has no reviewed evolution for this Pokémon.')
  const genderEligible = candidates.filter(row => row.requiredGender === null || normalize(row.requiredGender) === normalize(sheet.gender))
  if (!genderEligible.length) {
    const required = [...new Set(candidates.flatMap(row => row.requiredGender ? [row.requiredGender] : []))].join(' or ')
    throw new Error(`This evolution requires a ${required} Pokémon.`)
  }
  const levelEligible = genderEligible.filter(row => sheet.level >= row.minimumLevel)
  if (!levelEligible.length) {
    const minimum = Math.min(...genderEligible.map(row => row.minimumLevel))
    throw new Error(`This evolution requires Level ${minimum}.`)
  }
  return levelEligible
}

const currentEvolutionAuthority = (sheet: CharacterSheet): void => {
  const state = parseItemEvolutionState(sheet.serverPrivate?.itemEvolution)
  const latest = state.applications.at(-1)
  if (!latest) {
    if (sheet.itemEvolutionLocked === true || sheet.itemEvolutionAttention !== undefined
      || (sheet.abilities ?? []).some(row => row.itemEvolutionLocked === true)) {
      throw new Error('Item-controlled evolution markers have no immutable accepted provenance.')
    }
    return
  }
  const projected = itemEvolutionAttentionProjection(state)
  if (latest.toSpeciesId !== sheet.species || sheet.itemEvolutionLocked !== true
    || !sameJsonValue(projected, sheet.itemEvolutionAttention)) {
    throw new Error('Item-controlled evolution state no longer matches immutable accepted provenance.')
  }
  const currentTarget = speciesRecord(latest.toSpeciesId)
  if (latest.ruleRecordSha256 !== ruleRecordSha256
    || latest.pokedexCatalogSha256 !== pokedexCatalogSha256
    || latest.toSpeciesRecordSha256 !== speciesHash(currentTarget)) {
    throw new Error('Accepted evolution provenance is stale against current canonical authority.')
  }
  for (const mapping of latest.abilityMappings) {
    const ability = sheet.abilities?.[mapping.rowIndex]
    if (!ability || ability.name !== mapping.toAbilityId || ability.itemEvolutionLocked !== true) {
      throw new Error('Item-controlled Ability rows no longer match immutable accepted evolution provenance.')
    }
  }
}

const abilitySlots = (abilities: PokedexAbilities | undefined, abilityId: string): readonly {
  readonly tier: AbilityTier
  readonly slotIndex: number
}[] => ABILITY_TIERS.flatMap(tier => (abilities?.[tier] ?? []).flatMap((candidate, slotIndex) => (
  candidate === abilityId ? [{ tier, slotIndex }] : []
)))

const mapAbilities = (input: {
  readonly sheet: CharacterSheet
  readonly source: PokedexRecord
  readonly target: PokedexRecord
}): { readonly abilities: readonly CharacterSheetAbility[], readonly mappings: readonly ItemEvolutionAbilityMappingV1[] } => {
  const mappings: ItemEvolutionAbilityMappingV1[] = []
  const abilities = (input.sheet.abilities ?? []).map((ability, rowIndex): CharacterSheetAbility => {
    const slots = abilitySlots(input.source.abilities, ability.name)
    if (slots.length > 1) throw new Error(`Current Ability ${ability.name} has ambiguous source-species slot authority.`)
    if (slots.length === 0) {
      if (ability.itemEvolutionLocked === true) throw new Error(`Item-controlled Ability ${ability.name} is absent from the current species.`)
      return { ...ability }
    }
    const slot = slots[0]!
    const toAbilityId = input.target.abilities?.[slot.tier]?.[slot.slotIndex]
    if (!toAbilityId) throw new Error(`The destination species has no Ability in the ${slot.tier} slot ${slot.slotIndex + 1}.`)
    mappings.push({
      rowIndex,
      tier: slot.tier,
      slotIndex: slot.slotIndex,
      fromAbilityId: ability.name,
      toAbilityId,
    })
    return {
      name: toAbilityId,
      itemEvolutionLocked: true,
      ...(toAbilityId === ability.name && ability.automation ? { automation: ability.automation } : {}),
    }
  })
  return { abilities, mappings }
}

const moveOpportunities = (input: {
  readonly sheet: CharacterSheet
  readonly source: PokedexRecord
  readonly target: PokedexRecord
  readonly minimumLevel: number
}): readonly string[] => {
  const sourceMoves = new Set((input.source.level_up_moves ?? []).map(row => row.name))
  const known = new Set([...(input.sheet.movelist ?? []), ...(input.sheet.appliedMoves ?? [])].map(row => row.name))
  return [...new Set((input.target.level_up_moves ?? [])
    .filter(row => row.level < input.minimumLevel && !sourceMoves.has(row.name) && !known.has(row.name))
    .map(row => row.name))].sort((left, right) => left.localeCompare(right))
}

const choiceIdentity = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sourceInstanceId: string
  readonly sheet: CharacterSheet
  readonly transition: PtuItemEvolutionTransitionV1
}): string => `evolution-choice:v1:${sha256(stableJsonStringify({
  canonicalItemId: input.definition.canonicalId,
  canonicalDefinitionSha256: input.definition.definitionSha256,
  sourceInstanceId: input.sourceInstanceId,
  sheetSlug: input.sheet.slug,
  sheetRevision: Number(input.sheet.revision ?? 0),
  species: input.sheet.species,
  level: input.sheet.level,
  gender: input.sheet.gender ?? null,
  transition: input.transition,
  sourceSpeciesRecordSha256: speciesHash(speciesRecord(input.transition.fromSpecies)),
  targetSpeciesRecordSha256: speciesHash(speciesRecord(input.transition.toSpecies)),
  abilityNames: (input.sheet.abilities ?? []).map(row => row.name),
  equipmentRevision: input.sheet.equipmentState?.revision ?? null,
}))}`

const transitionPreviewFacts = (input: {
  readonly sheet: CharacterSheet
  readonly transition: PtuItemEvolutionTransitionV1
}): readonly ItemEvolutionPreviewFact[] => {
  const source = speciesRecord(input.transition.fromSpecies)
  const target = speciesRecord(input.transition.toSpecies)
  const ability = mapAbilities({ sheet: input.sheet, source, target })
  const moves = moveOpportunities({
    sheet: input.sheet,
    source,
    target,
    minimumLevel: input.transition.minimumLevel,
  })
  let targetForBudget: CharacterSheet = { ...input.sheet, species: input.transition.toSpecies }
  targetForBudget = applyCapabilityEvolutionTransition(input.sheet, targetForBudget).sheet
  const statPoints = pokemonAddedStatPointBudget(targetForBudget)
  const equipmentSummary = (() => {
    if (!targetForBudget.equipmentState) return 'No equipped items to reconcile'
    const previousActivity = new Map(targetForBudget.equipmentState.instances.map(instance => [instance.instanceId, instance.activity.status]))
    const reconciled = reconcileSheetEquipmentCompatibility({
      owner: { kind: 'pokemon', slug: targetForBudget.slug, sheet: targetForBudget },
      equipmentState: targetForBudget.equipmentState,
    })
    const inactive = reconciled.state.instances
      .filter(instance => previousActivity.get(instance.instanceId) === 'active' && instance.activity.status !== 'active')
      .map(instance => instance.canonicalItemId)
      .sort((left, right) => left.localeCompare(right))
    return inactive.length ? `${inactive.join(', ')} will become inactive` : 'No compatibility conflicts'
  })()
  const abilitySummary = ability.mappings.length
    ? ability.mappings.map(row => `${row.fromAbilityId} → ${row.toAbilityId}`).join(', ')
    : 'No species Ability rows selected'
  return Object.freeze([
    { label: 'Evolution', value: `${source.species} → ${target.species}`, tone: 'positive' },
    { label: 'Before', value: `${formatTypes(source)} · Base ${formatBaseStats(source.base_stats)}`, tone: 'neutral' },
    { label: 'After', value: `${formatTypes(target)} · Base ${formatBaseStats(target.base_stats)}`, tone: 'positive' },
    { label: 'Abilities', value: abilitySummary, tone: 'neutral' },
    { label: 'Identity retained', value: `${input.sheet.nickname || input.sheet.slug} · Level ${input.sheet.level} · Nature · ownership · history`, tone: 'positive' },
    { label: 'Species data', value: 'Base Stats, Skills, and Capabilities update', tone: 'neutral' },
    { label: 'Equipment', value: equipmentSummary, tone: equipmentSummary.includes('inactive') ? 'warning' : 'neutral' },
    { label: 'Stat allocation', value: `${statPoints} Stat Points need allocation after evolution`, tone: 'warning' },
    { label: 'Move decisions', value: moves.length ? `${moves.length} new Move choice${moves.length === 1 ? '' : 's'} will remain` : 'No new Move decision', tone: moves.length ? 'warning' : 'neutral' },
  ])
}

export const previewItemEvolution = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sheetKind: SheetKind
  readonly sheet: CharacterSheet
  readonly actorKind: SheetKind
  readonly sourceInstanceId: string
  readonly selectedChoices?: ReadonlyMap<string, readonly string[]>
}): ItemEvolutionPreview => {
  if (input.sheetKind !== 'pokemon' || input.actorKind !== 'trainer') {
    throw new Error('Evolutionary Items require a Trainer and one owned Pokémon target.')
  }
  currentEvolutionAuthority(input.sheet)
  const transitions = transitionCandidates(input.definition, input.sheet)
  const options = transitions.map((transition): ItemEvolutionChoiceOption => ({
    optionId: choiceIdentity({
      definition: input.definition,
      sourceInstanceId: input.sourceInstanceId,
      sheet: input.sheet,
      transition,
    }),
    label: `Evolve to ${transition.toSpecies}`,
    description: transition.minimumLevel > 0
      ? `Level ${input.sheet.level} meets the Level ${transition.minimumLevel} minimum.`
      : 'This reviewed transition has no minimum Level.',
    previewFacts: transitionPreviewFacts({ sheet: input.sheet, transition }),
  }))
  const selectedDestinations = input.selectedChoices?.get(ITEM_EVOLUTION_DESTINATION_CHOICE_ID) ?? []
  const selectedConfirmations = input.selectedChoices?.get(ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID) ?? []
  const selected = options.find(option => selectedDestinations[0] === option.optionId)
  const selectionComplete = selectedDestinations.length === 1 && Boolean(selected)
    && selectedConfirmations.length === 1 && selectedConfirmations[0] === 'confirmed'
  const choices: readonly ItemEvolutionChoice[] = Object.freeze([
    {
      choiceId: ITEM_EVOLUTION_DESTINATION_CHOICE_ID,
      label: options.length === 1 ? 'Review the destination' : 'Choose the evolved form',
      presentation: 'radio', minimum: 1, maximum: 1,
      options: Object.freeze(options),
    },
    {
      choiceId: ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID,
      label: 'Confirm the irreversible evolution',
      presentation: 'confirmation', minimum: 1, maximum: 1,
      options: Object.freeze([{
        optionId: 'confirmed',
        label: selected
          ? `I understand this changes ${input.sheet.nickname || input.sheet.species}’s species to ${selected.label.slice('Evolve to '.length)}.`
          : 'I understand this changes the Pokémon’s species.',
        description: null,
        previewFacts: Object.freeze([]),
      }]),
    },
  ])
  return Object.freeze({
    kind: 'item-evolution',
    description: selected
      ? `${input.sheet.species} → ${selected.label.slice('Evolve to '.length)} · identity retained · follow-up work remains visible`
      : `${options.length} reviewed evolution destination${options.length === 1 ? '' : 's'} available.`,
    previewFacts: Object.freeze(selected?.previewFacts ?? [{
      label: 'Eligibility',
      value: options.length === 1 ? options[0]!.description ?? 'Eligible' : `${options.length} legal destinations`,
      tone: 'neutral' as const,
    }]),
    choices,
    selectionComplete,
  })
}

const selectedTransition = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sourceInstanceId: string
  readonly sheet: CharacterSheet
  readonly selectedChoices: ReadonlyMap<string, readonly string[]>
}): PtuItemEvolutionTransitionV1 => {
  const transitions = transitionCandidates(input.definition, input.sheet)
  const selected = input.selectedChoices.get(ITEM_EVOLUTION_DESTINATION_CHOICE_ID) ?? []
  const confirmation = input.selectedChoices.get(ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID) ?? []
  if (selected.length !== 1 || confirmation.length !== 1 || confirmation[0] !== 'confirmed') {
    throw new Error('Evolutionary Item choices are incomplete.')
  }
  return transitions.find(transition => choiceIdentity({
    definition: input.definition,
    sourceInstanceId: input.sourceInstanceId,
    sheet: input.sheet,
    transition,
  }) === selected[0]) ?? (() => { throw new Error('The selected evolution destination is stale or unavailable.') })()
}

const resetAddedStats = (sheet: CharacterSheet): CharacterSheet['stats'] => Object.fromEntries(STAT_KEYS.map(key => [
  key,
  { ...(sheet.stats?.[key] ?? {}), added: 0 },
])) as CharacterSheet['stats']

export const resolveItemEvolution = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sheetKind: SheetKind
  readonly sheet: CharacterSheet
  readonly actorKind: SheetKind
  readonly sourceInstanceId: string
  readonly selectedChoices: ReadonlyMap<string, readonly string[]>
  readonly operationId: string
  readonly appliedAt: number
}): ResolvedItemEvolution => {
  if (!Number.isSafeInteger(input.appliedAt) || input.appliedAt < 0 || !input.operationId.trim()) {
    throw new Error('Item evolution requires server-owned operation identity and time.')
  }
  const preview = previewItemEvolution(input)
  const transition = selectedTransition(input)
  if (!preview.selectionComplete) throw new Error('Evolutionary Item choices are incomplete.')
  const source = speciesRecord(transition.fromSpecies)
  const target = speciesRecord(transition.toSpecies)
  const mapped = mapAbilities({ sheet: input.sheet, source, target })
  const moveIds = moveOpportunities({ sheet: input.sheet, source, target, minimumLevel: transition.minimumLevel })
  let next: CharacterSheet = {
    ...structuredClone(input.sheet),
    species: transition.toSpecies,
    itemEvolutionLocked: true,
    stats: resetAddedStats(input.sheet),
    abilities: [...mapped.abilities],
  }
  next = applyCapabilityEvolutionTransition(input.sheet, next).sheet
  let inactiveEquipmentItemIds: readonly string[] = Object.freeze([])
  if (next.equipmentState) {
    const previousActivity = new Map(next.equipmentState.instances.map(instance => [instance.instanceId, instance.activity.status]))
    const reconciled = reconcileSheetEquipmentCompatibility({
      owner: { kind: 'pokemon', slug: next.slug, sheet: next },
      equipmentState: next.equipmentState,
    })
    next.equipmentState = reconciled.state
    inactiveEquipmentItemIds = Object.freeze(reconciled.state.instances
      .filter(instance => previousActivity.get(instance.instanceId) === 'active' && instance.activity.status !== 'active')
      .map(instance => instance.canonicalItemId)
      .sort((left, right) => left.localeCompare(right)))
  }
  const requiredStatPoints = pokemonAddedStatPointBudget(next)
  const application: ItemEvolutionApplicationV1 = {
    sourceOperationId: input.operationId,
    sourceInstanceId: input.sourceInstanceId,
    canonicalItemId: input.definition.canonicalId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    ruleRecordSha256,
    pokedexCatalogSha256,
    fromSpeciesId: transition.fromSpecies,
    fromSpeciesRecordSha256: speciesHash(source),
    toSpeciesId: transition.toSpecies,
    toSpeciesRecordSha256: speciesHash(target),
    minimumLevel: transition.minimumLevel,
    requiredGender: transition.requiredGender,
    targetRevisionBefore: Number(input.sheet.revision ?? 0),
    requiredStatPoints,
    moveOpportunityIds: moveIds,
    abilityMappings: mapped.mappings,
    inactiveEquipmentItemIds,
    appliedAt: input.appliedAt,
  }
  const state = appendItemEvolutionApplication({
    current: input.sheet.serverPrivate?.itemEvolution,
    application,
  })
  next.serverPrivate = { ...(next.serverPrivate ?? {}), itemEvolution: state }
  next.itemEvolutionAttention = itemEvolutionAttentionProjection(state) ?? undefined
  const hp = resolveStats(next).find(row => row.key === 'hp')?.total ?? 0
  if (next.combat?.currentHp !== undefined) {
    next.combat = { ...next.combat, currentHp: Math.min(next.combat.currentHp, computeMaxHp(next, hp)) }
  }
  const selectedChoices = Object.freeze([...input.selectedChoices.entries()]
    .filter(([choiceId]) => input.definition.spec.choices.some(choice => choice.choiceId === choiceId))
    .map(([choiceId, optionIds]) => Object.freeze({
      choiceId,
      optionIds: Object.freeze([...optionIds]),
    }))
    .sort((left, right) => left.choiceId.localeCompare(right.choiceId)))
  return Object.freeze({
    preview,
    sheet: next,
    payload: {
      action: 'evolve-pokemon',
      canonicalItemId: input.definition.canonicalId,
      canonicalDefinitionSha256: input.definition.definitionSha256,
      sourceOperationId: input.operationId,
      sourceInstanceId: input.sourceInstanceId,
      selectedChoices,
      application,
      resultingSpecies: next.species,
      resultingAbilityNames: (next.abilities ?? []).map(row => row.name),
      requiredStatPoints,
      moveOpportunityIds: [...moveIds],
      inactiveEquipmentItemIds: [...inactiveEquipmentItemIds],
      appliedAt: input.appliedAt,
      previewFacts: preview.previewFacts.map(fact => ({ ...fact })),
    },
  })
}

export const reconcilePokemonItemEvolutionForSetupSave = (input: {
  readonly current: CharacterSheet
  readonly candidate: CharacterSheet
  readonly resolvedAt: number
}): CharacterSheet => {
  currentEvolutionAuthority(input.current)
  if (!Number.isSafeInteger(input.resolvedAt) || input.resolvedAt < 0) {
    throw new Error('Evolution Stat allocation requires a server-owned resolution timestamp.')
  }
  const state = parseItemEvolutionState(input.current.serverPrivate?.itemEvolution)
  const application = state.applications.at(-1)
  if (!application) {
    const detached = structuredClone(input.candidate)
    delete detached.itemEvolutionLocked
    delete detached.itemEvolutionAttention
    if (detached.abilities) {
      detached.abilities = detached.abilities.map((ability) => {
        const row = { ...ability }
        delete row.itemEvolutionLocked
        return row
      })
    }
    return detached
  }
  if (input.candidate.species !== input.current.species) {
    throw new Error('An item-controlled species can change only through an authoritative evolution action.')
  }
  const currentAbilities = input.current.abilities ?? []
  const candidateAbilities = input.candidate.abilities ?? []
  const abilities = candidateAbilities.map(ability => ({ ...ability }))
  for (const [index, current] of currentAbilities.entries()) {
    if (current.itemEvolutionLocked !== true) continue
    const candidate = abilities[index]
    if (!candidate || candidate.name !== current.name) {
      throw new Error('Item-controlled Ability rows can change only through an authoritative evolution action.')
    }
    abilities[index] = structuredClone(current)
  }
  const resolution = state.statResolutions.find(row => row.sourceOperationId === application.sourceOperationId)
  let nextState = state
  if (!resolution) {
    if (input.candidate.level !== input.current.level || !sameJsonValue(input.candidate.nature, input.current.nature)) {
      throw new Error('Level and Nature cannot change until the evolution Stat Point allocation is complete.')
    }
    const allocated = STAT_KEYS.reduce((total, key) => {
      const added = input.candidate.stats?.[key]?.added ?? 0
      if (!Number.isSafeInteger(added) || added < 0) {
        throw new Error('Evolution Stat Point allocations must be safe non-negative integers.')
      }
      return total + added
    }, 0)
    if (allocated > application.requiredStatPoints) {
      throw new Error(`Evolution Stat Point allocation exceeds the exact ${application.requiredStatPoints}-point budget.`)
    }
    if (allocated === application.requiredStatPoints) {
      if (pokemonAddedStatPointBudget(input.candidate) !== application.requiredStatPoints) {
        throw new Error('Evolution Stat Point authority changed before allocation completion.')
      }
      if (validateBaseRelations(resolveStats(input.candidate), pokemonBaseRelationWaivers(input.candidate)).length > 0) {
        throw new Error('Evolution Stat Point allocation violates the current Base Relations.')
      }
      nextState = resolveItemEvolutionStatAttention({
        current: state,
        sourceOperationId: application.sourceOperationId,
        resolutionId: `evolution-stat-resolution:v1:${sha256(stableJsonStringify({
          sourceOperationId: application.sourceOperationId,
          targetRevisionBefore: application.targetRevisionBefore,
          allocated,
        }))}`,
        allocatedStatPoints: allocated,
        resolvedAt: input.resolvedAt,
      })
    }
  }
  return {
    ...structuredClone(input.candidate),
    species: input.current.species,
    itemEvolutionLocked: true,
    itemEvolutionAttention: itemEvolutionAttentionProjection(nextState) ?? undefined,
    abilities,
    serverPrivate: {
      ...(input.current.serverPrivate ?? {}),
      itemEvolution: nextState,
    },
  }
}

export const assertCurrentItemEvolutionAuthority = currentEvolutionAuthority
export const ITEM_EVOLUTION_RULE_RECORD_SHA256 = ruleRecordSha256
export const ITEM_EVOLUTION_POKEDEX_CATALOG_SHA256 = pokedexCatalogSha256
export const currentItemEvolutionApplication = (sheet: CharacterSheet): ItemEvolutionApplicationV1 | null => (
  latestItemEvolutionApplication(sheet.serverPrivate?.itemEvolution)
)
