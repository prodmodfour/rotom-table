import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  activeItemFormChangeForPlacement,
  appendItemFormChangeEntry,
  type ItemFormChangeEntryV1,
} from '#shared/itemAutomation/formChanges'
import { parseSheetEquipmentStateForOwner, type EquippedItemInstanceV1 } from '#shared/itemAutomation/equipment'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createEncounterEquipmentGrantQueries } from '../moveAutomation/equipmentGrantQueries'
import { resolveEquipmentGrants, equipmentGrantOwnerContext, type ResolvedEquipmentGrant } from './equipmentGrants'
import { effectiveRuntimeAbilityIds } from '../abilityAutomation/effectiveRuntimeAbilities'
import {
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from './equipmentDefinitionRegistry'
import { resolveEffectiveCapabilities } from '../capabilityAutomation/effectiveCapabilities'
import {
  ITEM_FORM_CHANGE_RULE_RECORD_SHA256,
  canonicalItemFormChangeAbilityRecordSha256,
  canonicalItemFormChangeSpeciesRecordSha256,
  canonicalNaturalAbilityIdsForItemFormChange,
  reviewedItemFormChangeForId,
  reviewedItemFormChangesForSpecies,
  type ReviewedItemFormChange,
} from './formChangeRegistry'

export class ItemFormChangeRuleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ItemFormChangeRuleError'
  }
}

export interface ItemFormChangeSheetDirectory {
  readonly pokemon: ReadonlyMap<string, CharacterSheet>
  readonly trainer: ReadonlyMap<string, TrainerSheet>
}

export interface ItemFormChangeAbilityOption {
  readonly optionId: string
  readonly abilityId: string
}

export interface ItemFormChangeCandidate {
  readonly actorPlacement: SheetPlacement
  readonly targetPlacement: SheetPlacement
  readonly pokemonSheet: CharacterSheet
  readonly trainerSheet: TrainerSheet
  readonly form: ReviewedItemFormChange
  readonly ringSource: ResolvedEquipmentGrant
  readonly stoneSource: ResolvedEquipmentGrant | null
  readonly abilityOptions: readonly ItemFormChangeAbilityOption[]
  readonly selectedAbilityId: string | null
}

const sha256 = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
const fail = (code: string, message: string): never => { throw new ItemFormChangeRuleError(code, message) }
const allSheets = (sheets: ItemFormChangeSheetDirectory) => [
  ...[...sheets.pokemon].map(([slug, sheet]) => ({ kind: 'pokemon' as const, slug, sheet })),
  ...[...sheets.trainer].map(([slug, sheet]) => ({ kind: 'trainer' as const, slug, sheet })),
]
const ownsPokemon = (trainer: TrainerSheet, pokemonSlug: string): boolean => (
  (trainer.currentTeam ?? []).includes(pokemonSlug) || (trainer.boxedPokemon ?? []).includes(pokemonSlug)
)

export const itemFormChangeOwnerTrainer = (
  sheets: ItemFormChangeSheetDirectory,
  pokemonSlug: string,
): TrainerSheet | null => {
  const owners = [...sheets.trainer.values()].filter(trainer => ownsPokemon(trainer, pokemonSlug))
  if (owners.length > 1) fail('form-change.owner-ambiguous', 'This Pokémon has ambiguous Trainer ownership.')
  return owners[0] ?? null
}

const grantsFor = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement | null
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly sheet: CharacterSheet | TrainerSheet
  readonly sheets: ItemFormChangeSheetDirectory
}) => {
  if (input.placement) {
    return createEncounterEquipmentGrantQueries({ map: input.map, sheets: allSheets(input.sheets) })
      .resolve(input.placement.id)
  }
  if (!input.sheet.equipmentState) return null
  return resolveEquipmentGrants({
    equipmentState: input.sheet.equipmentState,
    owner: equipmentGrantOwnerContext({
      kind: input.kind,
      slug: input.slug,
      sheet: input.sheet,
      transformed: false,
    }),
  })
}

const exactActionSource = (input: {
  readonly grants: ReturnType<typeof grantsFor>
  readonly actionId: 'equipment.mega-ring.evolve' | 'equipment.mega-stone.evolve'
  readonly label: string
}): ResolvedEquipmentGrant => {
  const sources = input.grants?.active.filter(entry => entry.grant.kind === 'action'
    && entry.grant.executionStatus === 'native'
    && entry.grant.actionId === input.actionId) ?? []
  if (sources.length !== 1) fail('form-change.source-unavailable', `${input.label} is not active or has ambiguous source authority.`)
  return sources[0]!
}

const equipmentInstance = (
  sheet: CharacterSheet | TrainerSheet,
  kind: 'pokemon' | 'trainer',
  slug: string,
  instanceId: string,
): EquippedItemInstanceV1 => {
  const state = parseSheetEquipmentStateForOwner(sheet.equipmentState, { kind, slug })
  const matches = state.instances.filter(instance => instance.instanceId === instanceId)
  if (matches.length !== 1) fail('form-change.source-stale', 'The form-change equipment source is unavailable or stale.')
  return matches[0]!
}

export const itemFormChangeAbilityOptionId = (input: {
  readonly mapSlug: string
  readonly sceneStartedAt: number
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly formRecordSha256: string
  readonly abilityId: string
}): string => `mega-ability:v1:${sha256(input).slice(0, 32)}`

export const resolveItemFormChangeMegaRingSource = (input: {
  readonly map: TabletopMap
  readonly trainerSheet: TrainerSheet
  readonly sheets: ItemFormChangeSheetDirectory
}): ResolvedEquipmentGrant => {
  const trainerPlacement = input.map.placements.find(placement => (
    placement.sheetKind === 'trainer' && placement.sheetSlug === input.trainerSheet.slug
  )) ?? null
  return exactActionSource({
    grants: grantsFor({
      map: input.map,
      placement: trainerPlacement,
      kind: 'trainer',
      slug: input.trainerSheet.slug,
      sheet: input.trainerSheet,
      sheets: input.sheets,
    }),
    actionId: 'equipment.mega-ring.evolve',
    label: 'The owning Trainer’s Mega Ring',
  })
}

const configuredStoneForm = (input: {
  readonly sheet: CharacterSheet
  readonly source: ResolvedEquipmentGrant
}): ReviewedItemFormChange => {
  const instance = equipmentInstance(input.sheet, 'pokemon', input.sheet.slug, input.source.instanceId)
  const values = instance.configuration?.values as Record<string, unknown> | undefined
  const formId = typeof values?.megaFormSpeciesId === 'string' ? values.megaFormSpeciesId : ''
  const baseSpeciesId = typeof values?.baseSpeciesId === 'string' ? values.baseSpeciesId : ''
  const form = reviewedItemFormChangeForId(formId)
  if (!form || !form.requiresMegaStone || baseSpeciesId !== input.sheet.species
    || form.baseSpeciesId !== input.sheet.species) {
    fail('form-change.stone-configuration-stale', 'The active Mega Stone is not configured for this Pokémon and exact Mega form.')
  }
  return form as ReviewedItemFormChange
}

const hasDragonAscent = (sheet: CharacterSheet): boolean => [
  ...(sheet.movelist ?? []), ...(sheet.appliedMoves ?? []),
].some(move => move.name === 'Dragon Ascent')

const deltaEvolutionEffective = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet
  readonly sheets: ItemFormChangeSheetDirectory
}): boolean => hasDragonAscent(input.sheet)
  && resolveEffectiveCapabilities({
    map: input.map,
    placement: input.placement,
    sheet: input.sheet,
    sheets: input.sheets,
  }).instances.some(instance => instance.canonicalId === 'Delta Evolution' && instance.effective)

export const itemFormChangeSceneUseSpent = (input: {
  readonly map: TabletopMap
  readonly trainerSlug: string
  readonly sceneStartedAt: number
}): boolean => (
  input.map.encounterState?.itemFormChanges?.entries.some(entry => (
    entry.trainerSheetSlug === input.trainerSlug
    && entry.duration.kind === 'scene'
    && entry.duration.sceneStartedAt === input.sceneStartedAt
  )) === true
  || (Array.isArray(input.map.metadata?.capabilityMegaEvolutionUses)
    && input.map.metadata.capabilityMegaEvolutionUses.some((raw) => {
      const use = raw as Record<string, unknown>
      return use.trainerSlug === input.trainerSlug && use.sceneStartedAt === input.sceneStartedAt
    }))
)

export const activeReviewedItemFormChange = (input: {
  readonly map: Pick<TabletopMap, 'activeScene' | 'encounterState'>
  readonly placementId: string
  readonly pokemonSheet?: CharacterSheet | null
}): { readonly entry: ItemFormChangeEntryV1, readonly form: ReviewedItemFormChange } | null => {
  const mapEntry = activeItemFormChangeForPlacement({
    state: input.map.encounterState?.itemFormChanges,
    placementId: input.placementId,
    activeSceneStartedAt: input.map.activeScene?.startedAt ?? null,
  })
  const persistentEntry = input.pokemonSheet
    ? activeItemFormChangeForPlacement({
        state: input.pokemonSheet.serverPrivate?.itemFormChanges,
        placementId: input.placementId,
        activeSceneStartedAt: input.map.activeScene?.startedAt ?? null,
      })
    : null
  if (mapEntry && persistentEntry) fail('form-change.multiple-active', 'This Pokémon has conflicting active item-driven forms.')
  const entry = mapEntry ?? persistentEntry
  if (!entry) return null
  const form = reviewedItemFormChangeForId(entry.formId)
  const speciesHash = form ? canonicalItemFormChangeSpeciesRecordSha256(form.baseSpeciesId) : null
  const abilityHash = form ? canonicalItemFormChangeAbilityRecordSha256(entry.abilityId) : null
  const ringDefinition = equipmentDefinitionFor('Mega Ring')
  const stoneDefinition = equipmentDefinitionFor('Mega Stone')
  if (!form || entry.ruleRecordSha256 !== ITEM_FORM_CHANGE_RULE_RECORD_SHA256
    || entry.formRecordSha256 !== form.recordSha256
    || entry.baseSpeciesRecordSha256 !== speciesHash
    || entry.abilityRecordSha256 !== abilityHash
    || !ringDefinition
    || entry.ringCanonicalRecordSha256 !== ringDefinition.canonicalRecordSha256
    || entry.ringEquipmentDefinitionSha256 !== equipmentDefinitionSha256('Mega Ring')
    || (entry.sourceKind === 'mega-ring-and-stone' && (!stoneDefinition
      || entry.stoneCanonicalRecordSha256 !== stoneDefinition.canonicalRecordSha256
      || entry.stoneEquipmentDefinitionSha256 !== equipmentDefinitionSha256('Mega Stone')))
    || input.pokemonSheet?.slug !== undefined && input.pokemonSheet.slug !== entry.pokemonSheetSlug
    || input.pokemonSheet?.species !== undefined && input.pokemonSheet.species !== form.baseSpeciesId) {
    fail('form-change.provenance-stale', 'Accepted item-driven form state is stale against current canonical authority.')
  }
  return { entry, form: form as ReviewedItemFormChange }
}

const currentlyMegaEvolvedByCapability = (map: TabletopMap, placementId: string): boolean => (
  map.encounterState?.capabilityRuntime?.modes.some(mode => (
    mode.actorPlacementId === placementId && mode.mode === 'mega-evolved'
  )) === true
)

export const resolveItemFormChangeCandidate = (input: {
  readonly map: TabletopMap
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly sheets: ItemFormChangeSheetDirectory
  readonly abilityOptionId?: string | null
}): ItemFormChangeCandidate => {
  const sceneStartedAt = input.map.activeScene?.startedAt
  if (!Number.isSafeInteger(sceneStartedAt) || Number(sceneStartedAt) < 0) {
    fail('form-change.scene-required', 'Mega Evolution requires an active Scene with authoritative identity.')
  }
  const actorPlacement = input.map.placements.find(placement => placement.id === input.actorPlacementId)
    ?? fail('form-change.actor-missing', 'The Mega Evolution actor is unavailable.')
  const targetPlacement = input.map.placements.find(placement => placement.id === input.targetPlacementId)
    ?? fail('form-change.target-missing', 'The Mega Evolution target is unavailable.')
  if (input.map.initiative?.activeId !== actorPlacement.id) {
    fail('form-change.actor-turn-required', 'Mega Evolution must be triggered on the acting Trainer or Pokémon’s turn.')
  }
  if (targetPlacement.sheetKind !== 'pokemon') fail('form-change.pokemon-required', 'Mega Evolution requires a Pokémon target.')
  const pokemonSheet = input.sheets.pokemon.get(targetPlacement.sheetSlug)
    ?? fail('form-change.target-sheet-missing', 'The target Pokémon sheet is unavailable.')
  const trainerSheet = itemFormChangeOwnerTrainer(input.sheets, targetPlacement.sheetSlug)
    ?? fail('form-change.owner-required', 'Mega Evolution requires one exact owning Trainer.')
  if (!((actorPlacement.sheetKind === 'trainer' && actorPlacement.sheetSlug === trainerSheet.slug)
    || actorPlacement.id === targetPlacement.id)) {
    fail('form-change.actor-invalid', 'Mega Evolution must be triggered by the owning Trainer or the target Pokémon.')
  }
  const actorSheet = actorPlacement.sheetKind === 'pokemon'
    ? input.sheets.pokemon.get(actorPlacement.sheetSlug)
    : input.sheets.trainer.get(actorPlacement.sheetSlug)
  if (!actorSheet) fail('form-change.actor-sheet-missing', 'The Mega Evolution actor sheet is unavailable.')
  const actorHp = actorPlacement.sheetKind === 'pokemon'
    ? (actorSheet as CharacterSheet).combat?.currentHp
    : (actorSheet as TrainerSheet).currentHp
  if (actorHp === 0) fail('form-change.actor-fainted', 'A Fainted participant cannot trigger Mega Evolution.')
  if (pokemonSheet.combat?.currentHp === 0) fail('form-change.target-fainted', 'A Fainted Pokémon cannot begin Mega Evolution.')
  if (activeReviewedItemFormChange({ map: input.map, placementId: targetPlacement.id, pokemonSheet })
    || currentlyMegaEvolvedByCapability(input.map, targetPlacement.id)) {
    fail('form-change.already-active', 'This Pokémon is already Mega Evolved.')
  }
  if (itemFormChangeSceneUseSpent({
    map: input.map,
    trainerSlug: trainerSheet.slug,
    sceneStartedAt: Number(sceneStartedAt),
  })) fail('form-change.ring-use-spent', 'This Mega Ring already supports a Mega Evolution in the current Scene.')

  const ringSource = resolveItemFormChangeMegaRingSource({
    map: input.map, trainerSheet, sheets: input.sheets,
  })
  const stoneGrants = grantsFor({
    map: input.map, placement: targetPlacement, kind: 'pokemon', slug: pokemonSheet.slug,
    sheet: pokemonSheet, sheets: input.sheets,
  })
  const stoneSources = stoneGrants?.active.filter(entry => entry.grant.kind === 'action'
    && entry.grant.executionStatus === 'native'
    && entry.grant.actionId === 'equipment.mega-stone.evolve') ?? []
  let stoneSource: ResolvedEquipmentGrant | null = null
  let form: ReviewedItemFormChange | null = null
  if (stoneSources.length === 1) {
    stoneSource = stoneSources[0]!
    form = configuredStoneForm({ sheet: pokemonSheet, source: stoneSource })
  }
  else if (stoneSources.length > 1) {
    fail('form-change.stone-ambiguous', 'The target has ambiguous active Mega Stone authority.')
  }
  else if (pokemonSheet.species === 'Rayquaza'
    && deltaEvolutionEffective({ map: input.map, placement: targetPlacement, sheet: pokemonSheet, sheets: input.sheets })) {
    const forms = reviewedItemFormChangesForSpecies('Rayquaza')
    if (forms.length !== 1 || forms[0]!.requiresMegaStone) fail('form-change.delta-authority-stale', 'Reviewed Delta Evolution form authority is unavailable.')
    form = forms[0]!
  }
  else fail('form-change.stone-required', 'Mega Evolution requires an active Mega Stone configured for this Pokémon and form.')
  if (!form) fail('form-change.form-unavailable', 'Reviewed Mega Evolution form authority is unavailable.')
  const reviewedForm = form as ReviewedItemFormChange

  const currentAbilityIds = new Set(effectiveRuntimeAbilityIds({
    map: input.map,
    placement: targetPlacement,
    sheet: pokemonSheet,
  }))
  const alternativeAbilityIds = currentAbilityIds.has(reviewedForm.abilityId)
    ? canonicalNaturalAbilityIdsForItemFormChange(pokemonSheet.species)
        .filter(abilityId => !currentAbilityIds.has(abilityId))
    : []
  if (currentAbilityIds.has(reviewedForm.abilityId) && alternativeAbilityIds.length === 0) {
    fail('form-change.ability-duplicate-unresolved', 'Mega Evolution cannot add a duplicate Ability and no distinct natural Ability is available.')
  }
  const abilityOptions = alternativeAbilityIds.map(abilityId => ({
    abilityId,
    optionId: itemFormChangeAbilityOptionId({
      mapSlug: input.map.slug,
      sceneStartedAt: Number(sceneStartedAt),
      actorPlacementId: actorPlacement.id,
      targetPlacementId: targetPlacement.id,
      formRecordSha256: reviewedForm.recordSha256,
      abilityId,
    }),
  }))
  const selectedAbilityId = abilityOptions.length === 0
    ? reviewedForm.abilityId
    : abilityOptions.find(option => option.optionId === input.abilityOptionId)?.abilityId ?? null
  if (input.abilityOptionId && abilityOptions.length === 0) {
    fail('form-change.ability-choice-unexpected', 'This Mega Evolution does not accept a replacement Ability choice.')
  }
  if (abilityOptions.length > 0 && input.abilityOptionId !== undefined && selectedAbilityId === null) {
    fail('form-change.ability-choice-stale', 'The selected Mega Evolution Ability is stale or unavailable.')
  }
  return Object.freeze({
    actorPlacement, targetPlacement, pokemonSheet, trainerSheet, form: reviewedForm,
    ringSource, stoneSource,
    abilityOptions: Object.freeze(abilityOptions), selectedAbilityId,
  })
}

export const applyItemFormChangeCandidate = (input: {
  readonly map: TabletopMap
  readonly candidate: ItemFormChangeCandidate
  readonly operationId: string
  readonly acceptedAt: number
}): TabletopMap => {
  const sceneStartedAt = input.map.activeScene?.startedAt
  const selectedAbilityId = input.candidate.selectedAbilityId
  if (!Number.isSafeInteger(sceneStartedAt) || Number(sceneStartedAt) < 0 || !selectedAbilityId) {
    fail('form-change.plan-incomplete', 'Mega Evolution choices or Scene authority are incomplete.')
  }
  const abilityId = selectedAbilityId as string
  const form = input.candidate.form
  const ringInstance = equipmentInstance(
    input.candidate.trainerSheet, 'trainer', input.candidate.trainerSheet.slug,
    input.candidate.ringSource.instanceId,
  )
  const stoneInstance = input.candidate.stoneSource
    ? equipmentInstance(
        input.candidate.pokemonSheet, 'pokemon', input.candidate.pokemonSheet.slug,
        input.candidate.stoneSource.instanceId,
      )
    : null
  const entry: ItemFormChangeEntryV1 = {
    entryId: `item-form-change:v1:${sha256({ operationId: input.operationId, formId: form.formId }).slice(0, 32)}`,
    placementId: input.candidate.targetPlacement.id,
    pokemonSheetSlug: input.candidate.pokemonSheet.slug,
    trainerSheetSlug: input.candidate.trainerSheet.slug,
    formId: form.formId,
    ruleRecordSha256: ITEM_FORM_CHANGE_RULE_RECORD_SHA256,
    formRecordSha256: form.recordSha256,
    baseSpeciesRecordSha256: canonicalItemFormChangeSpeciesRecordSha256(form.baseSpeciesId)
      ?? fail('form-change.species-authority-missing', 'Mega Evolution species authority is unavailable.'),
    abilityRecordSha256: canonicalItemFormChangeAbilityRecordSha256(abilityId)
      ?? fail('form-change.ability-authority-missing', 'Mega Evolution Ability authority is unavailable.'),
    abilityId,
    duration: { kind: 'scene', sceneStartedAt: Number(sceneStartedAt) },
    sourceKind: input.candidate.stoneSource ? 'mega-ring-and-stone' : 'mega-ring-delta-evolution',
    ringInstanceId: input.candidate.ringSource.instanceId,
    ringInstanceRevision: input.candidate.ringSource.instanceRevision,
    ringCanonicalRecordSha256: ringInstance.canonicalRecordSha256,
    ringEquipmentDefinitionSha256: ringInstance.equipmentDefinitionSha256
      ?? fail('form-change.ring-definition-missing', 'Mega Ring equipment definition provenance is unavailable.'),
    stoneInstanceId: input.candidate.stoneSource?.instanceId ?? null,
    stoneInstanceRevision: input.candidate.stoneSource?.instanceRevision ?? null,
    stoneCanonicalRecordSha256: stoneInstance?.canonicalRecordSha256 ?? null,
    stoneEquipmentDefinitionSha256: stoneInstance
      ? stoneInstance.equipmentDefinitionSha256
        ?? fail('form-change.stone-definition-missing', 'Mega Stone equipment definition provenance is unavailable.')
      : null,
    sourceOperationId: input.operationId,
    acceptedAt: input.acceptedAt,
  }
  const encounter = input.map.encounterState
    ?? fail('form-change.encounter-state-required', 'Mega Evolution requires authoritative encounter state.')
  return {
    ...input.map,
    placements: input.map.placements.map(placement => placement.id === entry.placementId
      && typeof placement.initiative === 'number'
      ? { ...placement, initiative: placement.initiative + form.statDeltas.spd }
      : placement),
    encounterState: {
      ...encounter,
      itemFormChanges: appendItemFormChangeEntry(encounter.itemFormChanges, entry),
    },
  }
}

export const itemFormChangeAuthorityFingerprint = (): string => ITEM_FORM_CHANGE_RULE_RECORD_SHA256
