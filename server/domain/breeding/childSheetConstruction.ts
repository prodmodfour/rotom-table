import { createHash } from 'node:crypto'
import abilitiesJson from '../../../data/reference/abilities.json'
import movesJson from '../../../data/reference/moves.json'
import pokedexJson from '../../../data/reference/pokedex.json'
import experienceJson from '../../../data/reference/pokemonExperienceChart.json'
import canonicalIdsJson from '../../../data/breeding-automation/canonical-ids.json'
import initializedSheetContractJson from '../../../data/breeding-automation/initialized-pokemon-sheet-contract.json'
import lineageContractJson from '../../../data/breeding-automation/lineage-contract.json'
import naturesJson from '../../../data/breeding-automation/natures.json'
import sourceManifestJson from '../../../data/breeding-automation/source-manifest.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PokemonEggId, PokemonBreedingOriginId, BreedingOperationId } from '#shared/breeding/ids'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import type { BreedingBabyTemplateAuthorityV1 } from '#shared/breeding/babyTemplate'
import { parseBreedingOperationCommandV1, type BreedingHatchDestinationV1 } from '#shared/breeding/operations'
import type { CharacterSheet, CharacterSheetAbility, CharacterSheetMove } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { normalizeCharacterSheet } from '~/utils/sheetNormalize'
import { computeMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import {
  canonicalBreedingAbilityIdentity,
  canonicalBreedingMoveIdentity,
  canonicalBreedingSpeciesIdentity,
  BREEDING_CANONICAL_ABILITIES,
  BREEDING_CANONICAL_ID_DEFINITION_SHA256,
  BREEDING_CANONICAL_MOVES,
} from './canonicalIds'
import { breedingNature, BREEDING_NATURE_DEFINITION_SHA256 } from './natures'
import { createBreedingOperationCommandHash } from './operations'
import { compiledBreedingSpeciesSpec, COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from './registry'
import { parseAuthoritativePokemonEggDocumentV1, pokemonEggDocumentDefinitionSha256 } from './lineage'
import { createBreedingCoreHatchRuleHandoffV1 } from './modifierProviderHandoff'
import {
  BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256,
  breedingBabyTemplateMechanicsV1,
  createBreedingBabyTemplateAuthorityV1,
} from './babyTemplate'
import {
  applyBreedingHatchConstructionInheritanceV1,
  BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256,
} from './inheritanceLearning'

export type InitializedHatchedPokemonDocumentV1 = Omit<CharacterSheet,
  'slug' | 'revision' | 'folder' | 'updatedAt' | 'createdAt'> & {
    readonly slug?: never
    readonly revision?: never
    readonly folder?: never
    readonly updatedAt?: never
    readonly createdAt?: never
  }

export interface PokemonEggChildSheetConstructionPlanV1 {
  readonly schemaVersion: 1
  readonly eggId: PokemonEggId
  readonly sourceEggRevision: number
  readonly operationId: BreedingOperationId
  readonly originId: PokemonBreedingOriginId
  readonly ownerTrainerSlug: string
  readonly destination: BreedingHatchDestinationV1
  readonly baseSlug: string
  readonly folder: ''
  readonly document: InitializedHatchedPokemonDocumentV1
  readonly documentDefinitionSha256: string
  readonly sourceDefinitionHashes: readonly string[]
  readonly definitionSha256: string
}

export type PokemonEggChildSheetConstructionErrorCode =
  | 'breeding.child-sheet.invalid-input'
  | 'breeding.child-sheet.wrong-command'
  | 'breeding.child-sheet.stale-authority'
  | 'breeding.child-sheet.unavailable'
  | 'breeding.child-sheet.hash-mismatch'

export class PokemonEggChildSheetConstructionError extends Error {
  readonly code: PokemonEggChildSheetConstructionErrorCode
  constructor(code: PokemonEggChildSheetConstructionErrorCode, message: string) {
    super(message)
    this.name = 'PokemonEggChildSheetConstructionError'
    this.code = code
  }
}

const fail = (code: PokemonEggChildSheetConstructionErrorCode, message: string): never => {
  throw new PokemonEggChildSheetConstructionError(code, message)
}
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}
const strictInput = (value: unknown): { readonly egg: unknown, readonly command: unknown } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.child-sheet.invalid-input', 'Child-sheet construction input must be one plain data object.')
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== 2 || !names.includes('egg') || !names.includes('command')) {
    return fail('breeding.child-sheet.invalid-input', 'Child-sheet construction input must contain exactly egg and command.')
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.child-sheet.invalid-input', 'Child-sheet construction input cannot contain accessors or hidden fields.')
    }
  }
  return value as { readonly egg: unknown, readonly command: unknown }
}

interface ReferenceMoveRecord {
  readonly name: string
  readonly type?: string
  readonly frequency?: string
  readonly ac?: number | string
  readonly damage_base?: number
  readonly damage_roll?: string
  readonly damage_class?: string
  readonly range?: string
  readonly effect?: string
  readonly special?: string
}
interface ReferenceAbilityRecord {
  readonly name: string
  readonly frequency?: string
  readonly trigger?: string
  readonly effect?: string
}
interface ExperienceEntry { readonly level: number, readonly expNeeded: number }

const pokedex = pokedexJson as readonly PokedexRecord[]
const moves = movesJson as Readonly<Record<string, ReferenceMoveRecord>>
const abilities = abilitiesJson as Readonly<Record<string, ReferenceAbilityRecord>>
const experience = new Map((experienceJson as readonly ExperienceEntry[]).map(entry => [entry.level, entry.expNeeded]))
const moveIdentityByName = new Map(BREEDING_CANONICAL_MOVES.map(identity => [identity.sourceName, identity]))
const abilityIdentityByName = new Map(BREEDING_CANONICAL_ABILITIES.map(identity => [identity.sourceName, identity]))
const runtimeSourceHashes = new Map((sourceManifestJson.runtimeSources as readonly { readonly path: string, readonly sha256: string }[])
  .map(entry => [entry.path, entry.sha256]))
const requiredSourceHash = (path: string): string => runtimeSourceHashes.get(path)
  ?? fail('breeding.child-sheet.stale-authority', `The source manifest does not retain ${path}.`)

export const BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION = deepFreeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-child-sheet-construction-v1' as const,
  sourceAuthority: 'app-owned-json-only' as const,
  blueprintAuthority: 'accepted-egg-immutable-offspring' as const,
  speciesPresentation: 'canonical-source-name' as const,
  nickname: 'canonical-species-name' as const,
  startingExperience: 'exact-level-threshold' as const,
  levelMoves: 'latest-six-unique-app-owned-level-up-moves-at-or-below-starting-level-in-source-order' as const,
  ability: 'exact-frozen-basic-ability' as const,
  compatibilityInheritance: 'frozen-candidates-as-egg-moves-with-at-most-nine-remaining-checkpoints' as const,
  providerInheritance: 'frozen-serpents-mark-pattern-in-server-private-child-evidence' as const,
  fossilProviders: 'frozen-fossil-restoration-and-prehistoric-bond-authority' as const,
  babyTemplate: 'server-private-authority-owner-safe-mechanics-and-level-staged-recovery' as const,
  artificialProviders: 'frozen-playing-god-upgrade-provenance-and-vitamin-accounting' as const,
  inheritanceAtOrAboveLevel20: 'deterministic-hatch-construction-checkpoint-records-owned-by-BR-068' as const,
  defaults: Object.freeze({ loyalty: 3, startingTutorPoints: 1, spentTutorPoints: 0, fossilRestorationSpentTutorPoints: 2, tmAndTutorMoveLimit: 3, shiny: false, caughtBall: 'Basic Ball', player: false }),
  storageAuthorityFields: Object.freeze(['slug', 'folder', 'revision', 'createdAt', 'updatedAt'] as const),
  placeholderWrite: 'forbidden' as const,
  sourceDefinitionHashes: Object.freeze([
    requiredSourceHash('data/reference/pokedex.json'),
    requiredSourceHash('data/reference/moves.json'),
    requiredSourceHash('data/reference/abilities.json'),
    requiredSourceHash('data/reference/rules.json'),
    requiredSourceHash('data/reference/pokemonExperienceChart.json'),
    canonicalIdsJson.definitionSha256,
    naturesJson.definitionSha256,
    initializedSheetContractJson.definitionSha256,
    lineageContractJson.definitionSha256,
  ].sort(compare)),
})
export const BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION_SHA256 = sha256(BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION)

const canonicalMove = (name: string): CharacterSheetMove => {
  const identity = moveIdentityByName.get(name)
  const record = moves[name]
  if (!identity || canonicalBreedingMoveIdentity(identity.id) !== identity || !record || record.name !== identity.sourceName
    || sha256(record) !== identity.sourceRecordSha256) {
    return fail('breeding.child-sheet.stale-authority', `Move ${name} is not one exact current app-owned canonical Move.`)
  }
  const category = record.damage_class === 'Physical' || record.damage_class === 'Special' || record.damage_class === 'Status'
    ? record.damage_class
    : undefined
  return deepFreeze({
    name: record.name,
    ...(record.type === undefined ? {} : { type: record.type }),
    ...(category === undefined ? {} : { category }),
    ...(record.damage_base === undefined ? {} : { db: record.damage_base }),
    ...(record.damage_roll === undefined ? {} : { damageRoll: record.damage_roll }),
    ...(record.frequency === undefined ? {} : { frequency: record.frequency }),
    ...(record.ac === undefined ? {} : { ac: record.ac }),
    ...(record.range === undefined ? {} : { range: record.range }),
    ...(record.effect === undefined ? {} : { effect: record.effect }),
    ...(record.special === undefined ? {} : { special: record.special }),
  })
}
const canonicalAbility = (abilityId: string): CharacterSheetAbility => {
  const identity = canonicalBreedingAbilityIdentity(abilityId)
  const byName = identity ? abilityIdentityByName.get(identity.sourceName) : null
  const record = identity ? abilities[identity.sourceName] : null
  if (!identity || byName !== identity || !record || record.name !== identity.sourceName
    || sha256(record) !== identity.sourceRecordSha256) {
    return fail('breeding.child-sheet.stale-authority', `Ability ${abilityId} is not one exact current app-owned canonical Ability.`)
  }
  return deepFreeze({
    name: record.name,
    ...(record.frequency === undefined ? {} : { frequency: record.frequency }),
    ...(record.trigger === undefined ? {} : { trigger: record.trigger }),
    ...(record.effect === undefined ? {} : { effect: record.effect }),
    activated: false,
  })
}
const genderLabel = (value: string): 'Male' | 'Female' | 'Genderless' => {
  if (value === 'male') return 'Male'
  if (value === 'female') return 'Female'
  if (value === 'genderless') return 'Genderless'
  return fail('breeding.child-sheet.stale-authority', `Gender ${value} is not a frozen v1 child gender.`)
}
const completeDocument = (input: {
  readonly species: PokedexRecord
  readonly natureLabel: string
  readonly ability: CharacterSheetAbility
  readonly gender: 'Male' | 'Female' | 'Genderless'
  readonly startingLevel: number
  readonly babyTemplateAuthority: BreedingBabyTemplateAuthorityV1 | null
  readonly inheritanceMoveNames: readonly string[]
  readonly sourceEggId: string
  readonly providerTraits: PokemonEggDocumentV1['offspring']['providerTraits']
  readonly coreRuleHandoff: ReturnType<typeof createBreedingCoreHatchRuleHandoffV1>
}): InitializedHatchedPokemonDocumentV1 => {
  const totalExp = experience.get(input.startingLevel)
  if (totalExp === undefined) return fail('breeding.child-sheet.stale-authority', `Starting Level ${input.startingLevel} has no current app-owned Experience threshold.`)
  const seen = new Set<string>()
  const movelist: CharacterSheetMove[] = []
  let priorLevel = 0
  for (const [index, row] of (input.species.level_up_moves ?? []).entries()) {
    if (!Number.isSafeInteger(row.level) || row.level < priorLevel || typeof row.name !== 'string') {
      return fail('breeding.child-sheet.stale-authority', `Species level-up Move row ${index} is malformed or out of order.`)
    }
    priorLevel = row.level
    if (row.level <= input.startingLevel && !seen.has(row.name)) {
      seen.add(row.name)
      movelist.push(canonicalMove(row.name))
    }
  }
  const eggMoves = input.inheritanceMoveNames.map(canonicalMove)
  const loyaltyEvidence = input.coreRuleHandoff.evidence.find(entry => entry.contribution.contributionId === 'bounded-starting-loyalty-offer-rank-3')
  const tutorPointEvidence = input.coreRuleHandoff.evidence.find(entry => entry.contribution.contributionId === 'hatch-starting-tutor-point-1')
  if (loyaltyEvidence?.contribution.value.kind !== 'integer' || loyaltyEvidence.contribution.value.value !== 3
    || tutorPointEvidence?.contribution.value.kind !== 'integer' || tutorPointEvidence.contribution.value.value !== 1
    || input.coreRuleHandoff.evidence.length !== 2) {
    return fail('breeding.child-sheet.stale-authority', 'Current canonical hatch Loyalty and Tutor Point rule evidence is incomplete.')
  }
  const providerEvidenceDefinitionSha256s = input.coreRuleHandoff.evidence.map(entry => entry.definitionSha256).sort(compare)
  const fossilRestoration = input.providerTraits.fossilRestoration
  const prehistoricBond = input.providerTraits.prehistoricBond
  const playingGod = input.providerTraits.playingGod ?? null
  const babyTemplateMechanics = input.babyTemplateAuthority
    ? breedingBabyTemplateMechanicsV1(input.babyTemplateAuthority)
    : null
  const childAbilities = [input.ability]
  if (fossilRestoration) {
    const extraAbility = canonicalAbility(fossilRestoration.extraAbilityId)
    if (extraAbility.name === input.ability.name) {
      return fail('breeding.child-sheet.stale-authority', 'Fossil Restoration extra Ability must differ from the primary frozen Ability.')
    }
    childAbilities.push(extraAbility)
  }
  const draft = normalizeCharacterSheet({
    slug: 'pending-hatched-pokemon',
    nickname: input.species.species,
    species: input.species.species,
    level: input.startingLevel,
    totalExp,
    gender: input.gender,
    loyalty: loyaltyEvidence.contribution.value.value,
    tutorPoints: { earned: tutorPointEvidence.contribution.value.value, spent: fossilRestoration ? 2 : 0 },
    shiny: false,
    caughtBall: 'Basic Ball',
    player: false,
    nature: input.natureLabel,
    babyTemplate: babyTemplateMechanics !== null,
    ...(babyTemplateMechanics ? { babyTemplateMechanics } : {}),
    inheritedRemaining: Math.min(9, input.inheritanceMoveNames.length),
    inheritedMoves: {},
    ...(prehistoricBond ? { items: { held: prehistoricBond.heldItemName, itemDescription: prehistoricBond.heldItemEffect } } : {}),
    movelist: movelist.slice(-6),
    eggMoves,
    appliedMoves: [],
    ...(playingGod ? { vitamins: { statBoosts: { ...playingGod.baseStatIncreases } } } : {}),
    serverPrivate: {
      ...(input.babyTemplateAuthority ? { breedingBabyTemplate: input.babyTemplateAuthority } : {}),
      breedingProviderTraits: {
      serpentsMark: input.providerTraits.serpentsMark ? {
        patternId: input.providerTraits.serpentsMark.patternId,
        sourceParentSheetSlugs: [...input.providerTraits.serpentsMark.sourceParentSheetSlugs],
        providerEvidenceDefinitionSha256s: [...input.providerTraits.serpentsMark.providerEvidenceDefinitionSha256s],
        sourceEggId: input.sourceEggId,
      } : null,
      coreHatchRules: {
        loyaltyRank: 3,
        startingTutorPoints: 1,
        providerEvidenceDefinitionSha256s,
        handoffDefinitionSha256: input.coreRuleHandoff.definitionSha256,
        sourceEggId: input.sourceEggId,
      },
      fossilRestoration: fossilRestoration ? {
        tutorPointDelta: -2,
        extraAbilityId: fossilRestoration.extraAbilityId,
        extraAbilityTier: fossilRestoration.extraAbilityTier,
        sourceTrainerSlug: fossilRestoration.sourceTrainerSlug,
        providerEvidenceDefinitionSha256: fossilRestoration.providerEvidenceDefinitionSha256,
        providerHandoffDefinitionSha256: fossilRestoration.providerHandoffDefinitionSha256,
        sourceEggId: input.sourceEggId,
      } : null,
      prehistoricBond: prehistoricBond ? {
        highestBaseStatId: prehistoricBond.highestBaseStatId,
        heldItemId: prehistoricBond.heldItemId,
        sourceTrainerSlug: prehistoricBond.sourceTrainerSlug,
        providerEvidenceDefinitionSha256: prehistoricBond.providerEvidenceDefinitionSha256,
        providerHandoffDefinitionSha256: prehistoricBond.providerHandoffDefinitionSha256,
        sourceEggId: input.sourceEggId,
      } : null,
      marsupial: input.providerTraits.marsupial ? {
        providerRecordSha256: input.providerTraits.marsupial.providerRecordSha256,
        providerMechanicFieldsSha256: input.providerTraits.marsupial.providerMechanicFieldsSha256,
        providerEvidenceDefinitionSha256s: [...input.providerTraits.marsupial.providerEvidenceDefinitionSha256s],
        motherPouchRequired: true,
        removalLevel: 25,
        sourceEggId: input.sourceEggId,
      } : null,
      playingGod: playingGod ? {
        sourceTrainerSlug: playingGod.sourceTrainerSlug,
        sourceTrainerRevision: playingGod.sourceTrainerRevision,
        featureContributionDefinitionSha256: playingGod.featureContributionDefinitionSha256,
        featureHandoffDefinitionSha256: playingGod.featureHandoffDefinitionSha256,
        chemistryAuthorityDefinitionSha256: playingGod.chemistryAuthorityDefinitionSha256,
        technologyEducationRank: playingGod.technologyEducationRank,
        colorationContestStatId: playingGod.colorationContestStatId,
        inheritanceMoveIds: [...playingGod.inheritanceMoveIds],
        baseStatIncreases: { ...playingGod.baseStatIncreases },
        upgradeOptionIds: [...playingGod.upgradeOptionIds],
        sourceEggId: input.sourceEggId,
      } : null,
    } },
    abilities: childAbilities,
    edges: [],
    combat: { currentHp: 0 },
  })
  const hp = resolveStats(draft).find(stat => stat.key === 'hp')
  if (!hp || !Number.isSafeInteger(hp.total) || hp.total < 1) {
    return fail('breeding.child-sheet.stale-authority', 'The current species and frozen Nature cannot resolve a valid HP stat.')
  }
  draft.combat!.currentHp = computeMaxHp(draft, hp.total)
  const detached = structuredClone(draft) as CharacterSheet & Record<string, unknown>
  delete detached.slug
  delete detached.revision
  if (detached.folder !== undefined || detached.updatedAt !== undefined || detached.createdAt !== undefined) {
    return fail('breeding.child-sheet.hash-mismatch', 'Sheet normalization attempted to assign storage-owned authority fields.')
  }
  return deepFreeze(detached as InitializedHatchedPokemonDocumentV1)
}

export const planPokemonEggChildSheetConstructionV1 = (value: unknown): PokemonEggChildSheetConstructionPlanV1 => {
  const input = strictInput(value)
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'complete-hatch') {
    return fail('breeding.child-sheet.wrong-command', 'Child-sheet construction requires one complete-hatch command.')
  }
  const eggScope = command.scopes.find(scope => scope.kind === 'pokemon-egg')
  if (egg.status !== 'hatching' || egg.childSheetSlug !== null || egg.terminal !== null || egg.hatchOperationId === null
    || (egg.special.state !== 'normal' && egg.special.state !== 'resolved')) {
    return fail('breeding.child-sheet.unavailable', 'Only one unsettled hatching Egg with a terminal special result may construct a child.')
  }
  if (command.payload.eggId !== egg.eggId || eggScope?.kind !== 'pokemon-egg'
    || eggScope.eggId !== egg.eggId || eggScope.expectedRevision !== egg.revision
    || command.ruleset.rulesetId !== egg.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== egg.ruleset.definitionSha256
    || command.payload.destination.trainerSheetSlug !== egg.ownerTrainerSlug) {
    return fail('breeding.child-sheet.stale-authority', 'Command, Egg revision/ruleset, and owner destination must match exactly.')
  }
  const babyTemplateAuthority = egg.offspring.babyTemplate.applied
    ? createBreedingBabyTemplateAuthorityV1({
        sourceEggId: egg.eggId,
        babyTemplate: egg.offspring.babyTemplate,
        marsupial: egg.offspring.providerTraits.marsupial ?? null,
      })
    : null
  if (babyTemplateAuthority && !egg.definitionHashes.includes(BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256)) {
    return fail('breeding.child-sheet.stale-authority', 'Applied Baby Template is missing its frozen reviewed policy authority hash.')
  }
  const speciesIdentity = canonicalBreedingSpeciesIdentity(egg.offspring.speciesId)
  const species = speciesIdentity ? pokedex[speciesIdentity.sourceIndex] : undefined
  const speciesSpec = compiledBreedingSpeciesSpec(egg.offspring.speciesId)
  const fossilExtraAbility = egg.offspring.providerTraits.fossilRestoration?.extraAbilityId ?? null
  if (!speciesIdentity || !species || species.species !== speciesIdentity.sourceName
    || sha256(species) !== speciesIdentity.sourceRecordSha256
    || !speciesSpec || speciesSpec.definitionSha256 !== egg.offspring.speciesSpecDefinitionSha256
    || !speciesSpec.basicAbilityIds.includes(egg.offspring.ability.valueId)
    || (fossilExtraAbility !== null && canonicalBreedingAbilityIdentity(fossilExtraAbility) === null)) {
    return fail('breeding.child-sheet.stale-authority', 'Frozen species and primary/provider Abilities must match current app-owned canonical authority exactly.')
  }
  const nature = breedingNature(egg.offspring.nature.valueId)
  if (!nature) return fail('breeding.child-sheet.stale-authority', 'Frozen Nature is absent from the app-owned Nature registry.')
  const ability = canonicalAbility(egg.offspring.ability.valueId)
  const inheritanceMoveNames = egg.offspring.inheritanceCandidates.map(candidate => {
    const identity = canonicalBreedingMoveIdentity(candidate.moveId)
    if (!identity) return fail('breeding.child-sheet.stale-authority', `Inheritance Move ${candidate.moveId} is not current canonical authority.`)
    return identity.sourceName
  })
  const coreRuleHandoff = createBreedingCoreHatchRuleHandoffV1({
    egg,
    capturedAtCampaignMinute: egg.updatedAtCampaignMinute,
  })
  const document = applyBreedingHatchConstructionInheritanceV1({
    egg,
    command,
    document: completeDocument({
      species,
      natureLabel: nature.label,
      ability,
      gender: genderLabel(egg.offspring.gender.valueId),
      startingLevel: egg.offspring.startingLevel,
      babyTemplateAuthority,
      inheritanceMoveNames,
      sourceEggId: egg.eggId,
      providerTraits: egg.offspring.providerTraits,
      coreRuleHandoff,
    }),
  })
  const commandHash = createBreedingOperationCommandHash(command)
  const sourceDefinitionHashes = [
    ...BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION.sourceDefinitionHashes,
    BREEDING_CHILD_SHEET_CONSTRUCTION_POLICY_DEFINITION_SHA256,
    BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256,
    BREEDING_CANONICAL_ID_DEFINITION_SHA256,
    BREEDING_NATURE_DEFINITION_SHA256,
    COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
    speciesIdentity.sourceRecordSha256,
    speciesSpec.definitionSha256,
    egg.offspring.definitionSha256,
    pokemonEggDocumentDefinitionSha256(egg),
    commandHash,
    coreRuleHandoff.definitionSha256,
    ...(babyTemplateAuthority ? [babyTemplateAuthority.definitionSha256, BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256] : []),
    ...coreRuleHandoff.evidence.map(entry => entry.definitionSha256),
    canonicalBreedingAbilityIdentity(egg.offspring.ability.valueId)!.sourceRecordSha256,
    ...(egg.offspring.providerTraits.fossilRestoration ? [
      canonicalBreedingAbilityIdentity(egg.offspring.providerTraits.fossilRestoration.extraAbilityId)!.sourceRecordSha256,
      egg.offspring.providerTraits.fossilRestoration.providerEvidenceDefinitionSha256,
      egg.offspring.providerTraits.fossilRestoration.providerHandoffDefinitionSha256,
    ] : []),
    ...(egg.offspring.providerTraits.prehistoricBond ? [
      egg.offspring.providerTraits.prehistoricBond.heldItemEffectDefinitionSha256,
      egg.offspring.providerTraits.prehistoricBond.providerEvidenceDefinitionSha256,
      egg.offspring.providerTraits.prehistoricBond.providerHandoffDefinitionSha256,
    ] : []),
    ...egg.offspring.inheritanceCandidates.map(candidate => canonicalBreedingMoveIdentity(candidate.moveId)!.sourceRecordSha256),
  ].filter((hash, index, hashes) => hashes.indexOf(hash) === index).sort(compare)
  const definition = deepFreeze({
    schemaVersion: 1 as const,
    eggId: egg.eggId,
    sourceEggRevision: egg.revision,
    operationId: command.operationId,
    originId: command.payload.originId,
    ownerTrainerSlug: egg.ownerTrainerSlug,
    destination: command.payload.destination,
    baseSlug: species.species,
    folder: '' as const,
    document,
    documentDefinitionSha256: sha256(document),
    sourceDefinitionHashes: Object.freeze(sourceDefinitionHashes),
  })
  return deepFreeze({ ...definition, definitionSha256: sha256(definition) })
}

export const assertPokemonEggChildSheetConstructionExactReplayV1 = (input: {
  readonly plan: unknown
  readonly egg: unknown
  readonly command: unknown
}): PokemonEggChildSheetConstructionPlanV1 => {
  const rebuilt = planPokemonEggChildSheetConstructionV1({ egg: input.egg, command: input.command })
  if (!same(input.plan, rebuilt)) return fail('breeding.child-sheet.hash-mismatch', 'Child-sheet plan is not the exact current replay of its Egg and command.')
  return rebuilt
}
