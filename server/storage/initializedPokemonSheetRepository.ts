import abilitiesJson from '../../data/reference/abilities.json'
import pokedexJson from '../../data/reference/pokedex.json'
import movesJson from '../../data/reference/moves.json'
import naturesJson from '../../data/breeding-automation/natures.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseBreedingBabyTemplateMechanicsV1 } from '#shared/breeding/babyTemplate'
import { parseAuthoritativeBreedingBabyTemplateAuthorityV1 } from '../domain/breeding/babyTemplate'
import { sanitizeFolderPath } from '#shared/paths'
import type { CharacterSheet } from '~/types/characterSheet'
import { normalizeCharacterSheet } from '~/utils/sheetNormalize'
import { runtimeSheetNameSlug } from '../utils/sheetDocuments'
import { logicalSheetResourcePath } from '../utils/runtimeResourcePaths'
import { getRotomDatabase, type RotomDatabase } from './database'

export const INITIALIZED_POKEMON_SHEET_SLUG_ATTEMPT_MAXIMUM = 10_000 as const
export const INITIALIZED_POKEMON_SHEET_SLUG_ROOT_MAXIMUM = 140 as const
export interface CreateInitializedPokemonSheetInput {
  readonly baseSlug: string
  readonly folder?: string
  readonly updatedAt: number
  readonly document: Omit<CharacterSheet, 'slug' | 'revision'> & { readonly slug?: never, readonly revision?: never, readonly folder?: never, readonly updatedAt?: never, readonly createdAt?: never }
}
export interface CreatedInitializedPokemonSheet {
  readonly kind: 'pokemon'
  readonly slug: string
  readonly folder: string
  readonly revision: 0
  readonly updatedAt: number
  readonly path: string
  readonly sheet: CharacterSheet & Record<string, unknown> & { readonly revision: 0, readonly folder: string, readonly updatedAt: number, readonly createdAt: number }
}
export interface InitializedPokemonSheetRepository {
  readonly database: RotomDatabase
  create(input: CreateInitializedPokemonSheetInput): CreatedInitializedPokemonSheet
}
export interface CreateInitializedPokemonSheetRepositoryOptions {
  readonly database?: RotomDatabase
  /** Failure-injection hook used to prove savepoint and caller-transaction rollback. */
  readonly afterSheetInsert?: (slug: string) => void
}
export class InitializedPokemonSheetValidationError extends Error {
  readonly field: string
  constructor(field: string, message: string) { super(`Initialized Pokémon sheet ${field}: ${message}`); this.name = 'InitializedPokemonSheetValidationError'; this.field = field }
}
export class PokemonSheetSlugAllocationError extends Error {
  constructor() { super(`Could not allocate a Pokémon sheet slug after ${INITIALIZED_POKEMON_SHEET_SLUG_ATTEMPT_MAXIMUM} attempts.`); this.name = 'PokemonSheetSlugAllocationError' }
}
const SPECIES = new Set((pokedexJson as Array<{ species?: unknown }>).map(row => row.species).filter((value): value is string => typeof value === 'string'))
const ABILITIES = new Set(Object.keys(abilitiesJson as Record<string, unknown>))
const MOVES = new Set(Object.keys(movesJson as Record<string, unknown>))
const NATURES = new Set((naturesJson.definition.entries as Array<{ label: string }>).map(row => row.label))
const AUTHORITY_FIELDS = new Set(['slug', 'folder', 'revision', 'updatedAt', 'createdAt', 'sessionPlayerAccessible', 'playerProfileAccessible'])
const REQUIRED_OBJECTS = ['stats', 'natureMod', 'combat', 'vitamins', 'combatStages', 'items', 'weapon', 'tutorPoints', 'skillBackground', 'inheritedMoves', 'capabilities', 'skills', 'scene'] as const
const REQUIRED_ARRAYS = ['movelist', 'eggMoves', 'appliedMoves', 'abilities', 'edges'] as const
const INITIAL_CHILD_FIELDS = new Set([
  'nickname', 'species', 'level', 'totalExp', 'gender', 'loyalty', 'shiny', 'caughtBall', 'player', 'nature', 'babyTemplate', 'babyTemplateMechanics', 'serverPrivate',
  ...REQUIRED_OBJECTS, 'inheritedRemaining', ...REQUIRED_ARRAYS,
])
const STAT_KEYS = new Set(['hp', 'atk', 'def', 'satk', 'sdef', 'spd'])
const SKILL_KEYS = new Set(['acrobatics', 'athletics', 'charm', 'combat', 'command', 'generalEd', 'medicineEd', 'occultEd', 'pokeEd', 'techEd', 'focus', 'guile', 'intimidate', 'intuition', 'perception', 'stealth', 'survival'])
const MOVE_FIELDS = new Set(['name', 'type', 'category', 'db', 'damageRoll', 'damageRollMod', 'frequency', 'ac', 'range', 'effect', 'special', 'contestStats'])
const fail = (field: string, message: string): never => { throw new InitializedPokemonSheetValidationError(field, message) }
const plainJson = (value: unknown, path = 'document', seen = new Set<object>()): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(path, 'must contain only finite JSON numbers.'); return }
  if (typeof value !== 'object') return fail(path, 'must contain only JSON data.')
  const objectValue: object = value
  if (seen.has(objectValue)) return fail(path, 'cannot contain cycles.')
  seen.add(objectValue)
  if (Object.getOwnPropertySymbols(objectValue).length > 0) return fail(path, 'cannot contain symbol fields.')
  if (Array.isArray(objectValue)) {
    if (Object.getPrototypeOf(objectValue) !== Array.prototype) return fail(path, 'must use plain arrays.')
    const names = Object.getOwnPropertyNames(objectValue)
    if (names.length !== objectValue.length + 1 || names.some(name => name !== 'length' && !/^(0|[1-9][0-9]*)$/.test(name))) return fail(path, 'cannot be sparse or enriched.')
    for (let index = 0; index < objectValue.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(objectValue, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(`${path}[${index}]`, 'must be an enumerable data entry.')
      plainJson(descriptor.value, `${path}[${index}]`, seen)
    }
  }
  else {
    const prototype = Object.getPrototypeOf(objectValue)
    if (prototype !== Object.prototype && prototype !== null) return fail(path, 'must use plain objects.')
    for (const key of Object.getOwnPropertyNames(objectValue)) {
      const descriptor = Object.getOwnPropertyDescriptor(objectValue, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(`${path}.${key}`, 'must be an enumerable data field.')
      plainJson(descriptor.value, `${path}.${key}`, seen)
    }
  }
  seen.delete(objectValue)
}
const safeInteger = (value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(field, `must be a safe integer from ${minimum} through ${maximum}.`)
  return Number(value)
}
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.')
  return value as Record<string, unknown>
}
const knownKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void => {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'is not a recognized initial Pokémon sheet field.')
}
const finiteNumber = (value: unknown, path: string): void => { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number.') }
const stringArray = (value: unknown, path: string): void => {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) fail(path, 'must be an array of strings.')
}
const SHA256 = /^[0-9a-f]{64}$/u
const EGG_ID = /^pokemon-egg:v1:[0-9a-f]{32}$/u
const strictHashArray = (value: unknown, path: string, minimum: number): string[] => {
  stringArray(value, path)
  const hashes = value as string[]
  if (hashes.length < minimum || hashes.some(hash => !SHA256.test(hash))
    || hashes.some((hash, index) => index > 0 && hashes[index - 1]! >= hash)) fail(path, 'must contain the required unique lowercase hashes in canonical order.')
  return hashes
}
const assertInitialServerPrivate = (source: CharacterSheet): void => {
  const serverPrivate = record(source.serverPrivate, 'document.serverPrivate')
  knownKeys(serverPrivate, new Set(['breedingBabyTemplate', 'breedingProviderTraits']), 'document.serverPrivate')
  if (!Object.hasOwn(serverPrivate, 'breedingProviderTraits')) fail('document.serverPrivate', 'must contain frozen breeding provider traits.')
  const hasBabyAuthority = Object.hasOwn(serverPrivate, 'breedingBabyTemplate')
  const hasBabyMechanics = source.babyTemplateMechanics !== undefined
  if (source.babyTemplate === true) {
    if (!hasBabyAuthority || !hasBabyMechanics) fail('document.babyTemplate', 'an applied template requires exact server-private authority and its owner-safe mechanics mirror.')
    const authority = parseAuthoritativeBreedingBabyTemplateAuthorityV1(serverPrivate.breedingBabyTemplate)
    const mechanics = parseBreedingBabyTemplateMechanicsV1(source.babyTemplateMechanics)
    const expectedMechanics = { schemaVersion: 1, applicationKind: authority.applicationKind, effects: authority.effects }
    if (stableJsonStringify(mechanics) !== stableJsonStringify(expectedMechanics)) fail('document.babyTemplateMechanics', 'must exactly mirror the frozen server-private Baby Template authority.')
  }
  else if (hasBabyAuthority || hasBabyMechanics) fail('document.babyTemplate', 'an unapplied template cannot retain active mechanics authority.')
  const traits = record(serverPrivate.breedingProviderTraits, 'document.serverPrivate.breedingProviderTraits')
  knownKeys(traits, new Set(['serpentsMark', 'coreHatchRules', 'fossilRestoration', 'prehistoricBond', 'marsupial', 'playingGod']), 'document.serverPrivate.breedingProviderTraits')
  if (!Object.hasOwn(traits, 'serpentsMark') || !Object.hasOwn(traits, 'coreHatchRules')
    || !Object.hasOwn(traits, 'fossilRestoration') || !Object.hasOwn(traits, 'prehistoricBond')) {
    fail('document.serverPrivate.breedingProviderTraits', 'must contain exact inherited, fossil-provider, and core rule evidence.')
  }
  if (traits.serpentsMark !== null) {
    const mark = record(traits.serpentsMark, 'document.serverPrivate.breedingProviderTraits.serpentsMark')
    knownKeys(mark, new Set(['patternId','sourceParentSheetSlugs','providerEvidenceDefinitionSha256s','sourceEggId']), 'document.serverPrivate.breedingProviderTraits.serpentsMark')
    if (!['attack','crush','fear','life','speed','stealth'].includes(String(mark.patternId)) || !EGG_ID.test(String(mark.sourceEggId))) fail('document.serverPrivate.breedingProviderTraits.serpentsMark', 'must bind one reviewed pattern and exact Egg identity.')
    stringArray(mark.sourceParentSheetSlugs, 'document.serverPrivate.breedingProviderTraits.serpentsMark.sourceParentSheetSlugs')
    if ((mark.sourceParentSheetSlugs as string[]).length < 1 || (mark.sourceParentSheetSlugs as string[]).length > 2
      || (mark.sourceParentSheetSlugs as string[]).some((slug, index, slugs) => !slug || (index > 0 && slugs[index - 1]! >= slug))) fail('document.serverPrivate.breedingProviderTraits.serpentsMark.sourceParentSheetSlugs', 'must bind one or two unique canonical parent sheet slugs.')
    strictHashArray(mark.providerEvidenceDefinitionSha256s, 'document.serverPrivate.breedingProviderTraits.serpentsMark.providerEvidenceDefinitionSha256s', 1)
  }
  if (traits.fossilRestoration !== null) {
    const restoration = record(traits.fossilRestoration, 'document.serverPrivate.breedingProviderTraits.fossilRestoration')
    knownKeys(restoration, new Set(['tutorPointDelta','extraAbilityId','extraAbilityTier','sourceTrainerSlug','providerEvidenceDefinitionSha256','providerHandoffDefinitionSha256','sourceEggId']), 'document.serverPrivate.breedingProviderTraits.fossilRestoration')
    if (restoration.tutorPointDelta !== -2 || !['basic','advanced'].includes(String(restoration.extraAbilityTier))
      || typeof restoration.extraAbilityId !== 'string' || typeof restoration.sourceTrainerSlug !== 'string'
      || !SHA256.test(String(restoration.providerEvidenceDefinitionSha256))
      || !SHA256.test(String(restoration.providerHandoffDefinitionSha256)) || !EGG_ID.test(String(restoration.sourceEggId))) {
      fail('document.serverPrivate.breedingProviderTraits.fossilRestoration', 'must bind the exact frozen Fossil Restoration contribution and Egg identity.')
    }
  }
  if (traits.prehistoricBond !== null) {
    const bond = record(traits.prehistoricBond, 'document.serverPrivate.breedingProviderTraits.prehistoricBond')
    knownKeys(bond, new Set(['highestBaseStatId','heldItemId','sourceTrainerSlug','providerEvidenceDefinitionSha256','providerHandoffDefinitionSha256','sourceEggId']), 'document.serverPrivate.breedingProviderTraits.prehistoricBond')
    if (traits.fossilRestoration === null || !['hp','atk','def','satk','sdef','spd'].includes(String(bond.highestBaseStatId))
      || typeof bond.heldItemId !== 'string' || typeof bond.sourceTrainerSlug !== 'string'
      || !SHA256.test(String(bond.providerEvidenceDefinitionSha256))
      || !SHA256.test(String(bond.providerHandoffDefinitionSha256)) || !EGG_ID.test(String(bond.sourceEggId))) {
      fail('document.serverPrivate.breedingProviderTraits.prehistoricBond', 'must bind the exact frozen Prehistoric Bond contribution, Restoration authority, and Egg identity.')
    }
  }
  if (Object.hasOwn(traits, 'marsupial') && traits.marsupial !== null) {
    const marsupial = record(traits.marsupial, 'document.serverPrivate.breedingProviderTraits.marsupial')
    knownKeys(marsupial, new Set(['providerRecordSha256','providerMechanicFieldsSha256','providerEvidenceDefinitionSha256s','motherPouchRequired','removalLevel','sourceEggId']), 'document.serverPrivate.breedingProviderTraits.marsupial')
    if (!SHA256.test(String(marsupial.providerRecordSha256)) || !SHA256.test(String(marsupial.providerMechanicFieldsSha256))
      || strictHashArray(marsupial.providerEvidenceDefinitionSha256s, 'document.serverPrivate.breedingProviderTraits.marsupial.providerEvidenceDefinitionSha256s', 2).length < 2
      || marsupial.motherPouchRequired !== true || marsupial.removalLevel !== 25 || !EGG_ID.test(String(marsupial.sourceEggId))
      || source.species !== 'Kangaskhan' || source.babyTemplate !== true) {
      fail('document.serverPrivate.breedingProviderTraits.marsupial', 'must bind exact Kangaskhan provider, pouch, Egg, and Level 25 removal authority.')
    }
  }
  if (Object.hasOwn(traits, 'playingGod') && traits.playingGod !== null) {
    const provider = record(traits.playingGod, 'document.serverPrivate.breedingProviderTraits.playingGod')
    knownKeys(provider, new Set(['sourceTrainerSlug','sourceTrainerRevision','featureContributionDefinitionSha256','featureHandoffDefinitionSha256','chemistryAuthorityDefinitionSha256','technologyEducationRank','colorationContestStatId','inheritanceMoveIds','baseStatIncreases','upgradeOptionIds','sourceEggId']), 'document.serverPrivate.breedingProviderTraits.playingGod')
    const stats = record(provider.baseStatIncreases, 'document.serverPrivate.breedingProviderTraits.playingGod.baseStatIncreases')
    knownKeys(stats, STAT_KEYS, 'document.serverPrivate.breedingProviderTraits.playingGod.baseStatIncreases')
    const statTotal = [...STAT_KEYS].reduce((sum, key) => sum + safeInteger(stats[key], `document.serverPrivate.breedingProviderTraits.playingGod.baseStatIncreases.${key}`, 0, 5), 0)
    stringArray(provider.inheritanceMoveIds, 'document.serverPrivate.breedingProviderTraits.playingGod.inheritanceMoveIds')
    stringArray(provider.upgradeOptionIds, 'document.serverPrivate.breedingProviderTraits.playingGod.upgradeOptionIds')
    const moveIds = provider.inheritanceMoveIds as string[]; const optionIds = provider.upgradeOptionIds as string[]
    const colorationCount = provider.colorationContestStatId === null ? 0 : 1
    if (typeof provider.sourceTrainerSlug !== 'string' || !Number.isSafeInteger(provider.sourceTrainerRevision)
      || ![provider.featureContributionDefinitionSha256, provider.featureHandoffDefinitionSha256, provider.chemistryAuthorityDefinitionSha256].every(value => SHA256.test(String(value)))
      || (provider.technologyEducationRank !== 5 && provider.technologyEducationRank !== 6)
      || (provider.colorationContestStatId !== null && !['beauty','cool','cute','smart','tough'].includes(String(provider.colorationContestStatId)))
      || moveIds.length > 3 || new Set(moveIds).size !== moveIds.length || moveIds.some(id => typeof id !== 'string')
      || optionIds.length !== provider.technologyEducationRank || new Set(optionIds).size !== optionIds.length
      || statTotal > 5 || colorationCount + moveIds.length + statTotal !== provider.technologyEducationRank
      || !EGG_ID.test(String(provider.sourceEggId))) {
      fail('document.serverPrivate.breedingProviderTraits.playingGod', 'must retain exact bounded Feature, tool, upgrade, and source Egg provenance.')
    }
  }
  const core = record(traits.coreHatchRules, 'document.serverPrivate.breedingProviderTraits.coreHatchRules')
  knownKeys(core, new Set(['loyaltyRank','startingTutorPoints','providerEvidenceDefinitionSha256s','handoffDefinitionSha256','sourceEggId']), 'document.serverPrivate.breedingProviderTraits.coreHatchRules')
  if (core.loyaltyRank !== 3 || core.startingTutorPoints !== 1 || !SHA256.test(String(core.handoffDefinitionSha256)) || !EGG_ID.test(String(core.sourceEggId))) fail('document.serverPrivate.breedingProviderTraits.coreHatchRules', 'must bind exact current hatch rule authority.')
  if (strictHashArray(core.providerEvidenceDefinitionSha256s, 'document.serverPrivate.breedingProviderTraits.coreHatchRules.providerEvidenceDefinitionSha256s', 2).length !== 2) fail('document.serverPrivate.breedingProviderTraits.coreHatchRules.providerEvidenceDefinitionSha256s', 'must bind exactly two core rule records.')
}
const assertStrictInitialChildShape = (source: CharacterSheet): void => {
  const root = source as unknown as Record<string, unknown>
  knownKeys(root, INITIAL_CHILD_FIELDS, 'document')
  assertInitialServerPrivate(source)
  const stats = record(source.stats, 'document.stats')
  knownKeys(stats, STAT_KEYS, 'document.stats')
  if (Object.keys(stats).length !== STAT_KEYS.size) fail('document.stats', 'must initialize all six stats.')
  for (const key of STAT_KEYS) {
    const row = record(stats[key], `document.stats.${key}`)
    knownKeys(row, new Set(['base', 'added', 'stage']), `document.stats.${key}`)
    for (const field of ['base', 'added', 'stage']) finiteNumber(row[field], `document.stats.${key}.${field}`)
  }
  const natureMod = record(source.natureMod, 'document.natureMod')
  knownKeys(natureMod, new Set(['plus', 'minus']), 'document.natureMod')
  for (const [key, value] of Object.entries(natureMod)) if (!STAT_KEYS.has(String(value))) fail(`document.natureMod.${key}`, 'must identify a Pokémon stat.')
  const combat = record(source.combat, 'document.combat')
  knownKeys(combat, new Set(['currentHp', 'injuries', 'injuriesHealedToday', 'evasion', 'dr', 'conditions', 'statusAfflictions', 'notes', 'trainingExp']), 'document.combat')
  for (const key of ['currentHp', 'injuries', 'injuriesHealedToday', 'dr', 'trainingExp']) if (combat[key] !== undefined) finiteNumber(combat[key], `document.combat.${key}`)
  for (const key of ['statusAfflictions', 'notes']) if (combat[key] !== undefined && typeof combat[key] !== 'string') fail(`document.combat.${key}`, 'must be text.')
  stringArray(combat.conditions, 'document.combat.conditions')
  const evasion = record(combat.evasion, 'document.combat.evasion')
  knownKeys(evasion, new Set(['vsAtkBonus', 'vsSatkBonus', 'vsAnyBonus']), 'document.combat.evasion')
  for (const key of ['vsAtkBonus', 'vsSatkBonus', 'vsAnyBonus']) finiteNumber(evasion[key], `document.combat.evasion.${key}`)
  const vitamins = record(source.vitamins, 'document.vitamins')
  knownKeys(vitamins, new Set(['statBoosts', 'statSuppressants', 'heartBooster', 'ppUp', 'ppUpMove', 'rareCandies', 'heartScales', 'notes']), 'document.vitamins')
  for (const field of ['statBoosts', 'statSuppressants']) {
    const values = record(vitamins[field], `document.vitamins.${field}`)
    knownKeys(values, STAT_KEYS, `document.vitamins.${field}`)
    for (const key of STAT_KEYS) safeInteger(values[key], `document.vitamins.${field}.${key}`)
  }
  if (typeof vitamins.heartBooster !== 'boolean' || typeof vitamins.ppUp !== 'boolean') fail('document.vitamins', 'must explicitly initialize boolean item flags.')
  for (const field of ['rareCandies', 'heartScales']) safeInteger(vitamins[field], `document.vitamins.${field}`)
  for (const field of ['ppUpMove', 'notes']) if (typeof vitamins[field] !== 'string') fail(`document.vitamins.${field}`, 'must be text.')
  const stages = record(source.combatStages, 'document.combatStages')
  knownKeys(stages, new Set(['atk', 'def', 'satk', 'sdef', 'spd', 'acc']), 'document.combatStages')
  for (const [key, value] of Object.entries(stages)) finiteNumber(value, `document.combatStages.${key}`)
  const items = record(source.items, 'document.items')
  knownKeys(items, new Set(['held', 'itemDescription', 'digestionFood', 'digestionFoods', 'honeyPawsFood', 'extraItems', 'pointsLeft']), 'document.items')
  for (const key of ['held', 'itemDescription', 'digestionFood', 'honeyPawsFood']) if (items[key] !== undefined && typeof items[key] !== 'string') fail(`document.items.${key}`, 'must be text.')
  if (items.pointsLeft !== undefined) finiteNumber(items.pointsLeft, 'document.items.pointsLeft')
  stringArray(items.extraItems, 'document.items.extraItems')
  if (items.digestionFoods !== undefined) stringArray(items.digestionFoods, 'document.items.digestionFoods')
  const weapon = record(source.weapon, 'document.weapon')
  knownKeys(weapon, new Set(['name', 'dbMod', 'acMod', 'description']), 'document.weapon')
  const tutor = record(source.tutorPoints, 'document.tutorPoints')
  knownKeys(tutor, new Set(['earned', 'spent']), 'document.tutorPoints')
  const background = record(source.skillBackground, 'document.skillBackground')
  knownKeys(background, new Set(['description', 'raised', 'lowered']), 'document.skillBackground')
  if (background.raised !== undefined) stringArray(background.raised, 'document.skillBackground.raised')
  if (background.lowered !== undefined) stringArray(background.lowered, 'document.skillBackground.lowered')
  const inherited = record(source.inheritedMoves, 'document.inheritedMoves')
  for (const [level, move] of Object.entries(inherited)) {
    if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(level) || typeof move !== 'string' || !MOVES.has(move)) fail(`document.inheritedMoves.${level}`, 'must bind a level from 1 through 100 to an app-owned Move.')
  }
  for (const field of ['movelist', 'eggMoves'] as const) for (const [index, moveValue] of (source[field] ?? []).entries()) {
    const move = record(moveValue, `document.${field}[${index}]`)
    knownKeys(move, MOVE_FIELDS, `document.${field}[${index}]`)
    if (typeof move.name !== 'string' || !MOVES.has(move.name)) fail(`document.${field}[${index}].name`, 'must be an app-owned Move.')
  }
  if ((source.appliedMoves?.length ?? 0) !== 0 || (source.edges?.length ?? 0) !== 0) fail('document', 'a newly initialized child cannot contain applied Moves or Poké Edges.')
  for (const [index, abilityValue] of (source.abilities ?? []).entries()) {
    const ability = record(abilityValue, `document.abilities[${index}]`)
    knownKeys(ability, new Set(['name', 'frequency', 'trigger', 'effect', 'activated']), `document.abilities[${index}]`)
  }
  const capabilities = record(source.capabilities, 'document.capabilities')
  knownKeys(capabilities, new Set(['overland', 'sky', 'swim', 'levitate', 'burrow', 'jump', 'power', 'weight', 'size', 'naturewalk', 'other']), 'document.capabilities')
  stringArray(capabilities.other, 'document.capabilities.other')
  const skills = record(source.skills, 'document.skills')
  knownKeys(skills, SKILL_KEYS, 'document.skills')
  for (const [key, value] of Object.entries(skills)) if (typeof value !== 'string') fail(`document.skills.${key}`, 'must be text.')
  const scene = record(source.scene, 'document.scene')
  knownKeys(scene, new Set(['sceneXp', 'pkmnCount', 'modifiers', 'newTotal']), 'document.scene')
  for (const [key, value] of Object.entries(scene)) finiteNumber(value, `document.scene.${key}`)
}
const safeText = (value: unknown, field: string, maximum = 160): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) return fail(field, `must be trimmed control-free text of 1-${maximum} characters.`)
  return value
}
const normalizeRoot = (value: unknown): string => {
  const base = safeText(value, 'baseSlug')
  if (base.includes('..') || /[\\/]/u.test(base)) fail('baseSlug', 'cannot contain traversal or path separators.')
  const root = runtimeSheetNameSlug(base).slice(0, INITIALIZED_POKEMON_SHEET_SLUG_ROOT_MAXIMUM).replace(/-+$/u, '')
  return root || 'hatched-pokemon'
}
const candidateSlug = (root: string, index: number): string => index === 0 ? root : `${root}-${index}`
const fullyInitializedDocument = (input: CreateInitializedPokemonSheetInput, slug: string, folder: string): CharacterSheet & Record<string, unknown> & { revision: 0, folder: string, updatedAt: number, createdAt: number } => {
  plainJson(input.document)
  for (const field of Object.keys(input.document)) if (AUTHORITY_FIELDS.has(field)) fail(`document.${field}`, 'is assigned only by the storage authority.')
  const source = input.document as unknown as CharacterSheet
  assertStrictInitialChildShape(source)
  safeText(source.nickname, 'document.nickname')
  if (typeof source.species !== 'string' || !SPECIES.has(source.species)) fail('document.species', 'must be an exact app-owned Pokédex species identity.')
  safeInteger(source.level, 'document.level', 1, 100)
  safeInteger(source.totalExp, 'document.totalExp')
  if (source.gender !== 'Male' && source.gender !== 'Female' && source.gender !== 'Genderless') fail('document.gender', 'must be Male, Female, or Genderless.')
  if (typeof source.nature !== 'string' || !NATURES.has(source.nature)) fail('document.nature', 'must be an app-owned Nature label.')
  if (typeof source.player !== 'boolean' || typeof source.shiny !== 'boolean' || typeof source.babyTemplate !== 'boolean') fail('document', 'must explicitly initialize player, shiny, and babyTemplate flags.')
  safeInteger(source.loyalty, 'document.loyalty', 0, 6)
  safeInteger(source.inheritedRemaining, 'document.inheritedRemaining', 0, 9)
  safeText(source.caughtBall, 'document.caughtBall')
  if (!Array.isArray(source.abilities) || source.abilities.length < 1 || source.abilities.some(ability => !ability || typeof ability !== 'object' || !ABILITIES.has(ability.name))) fail('document.abilities', 'must contain at least one app-owned Ability record.')
  if (!source.combat || typeof source.combat !== 'object' || !Number.isSafeInteger(source.combat.currentHp) || Number(source.combat.currentHp) < 0) fail('document.combat.currentHp', 'must be explicitly initialized to a nonnegative safe integer.')
  for (const field of REQUIRED_OBJECTS) if (!source[field] || typeof source[field] !== 'object' || Array.isArray(source[field])) fail(`document.${field}`, 'must be an initialized object.')
  for (const field of REQUIRED_ARRAYS) if (!Array.isArray(source[field])) fail(`document.${field}`, 'must be an initialized array.')
  const updatedAt = safeInteger(input.updatedAt, 'updatedAt')
  const assigned = { ...source, slug, folder, revision: 0 as const, createdAt: updatedAt, updatedAt }
  const normalized = normalizeCharacterSheet(JSON.parse(JSON.stringify(assigned)) as CharacterSheet) as CharacterSheet & { revision: 0, folder: string, updatedAt: number, createdAt: number }
  if (stableJsonStringify(normalized) !== stableJsonStringify(assigned)) fail('document', 'must already equal the complete current Pokémon sheet normalization; placeholder/default supplementation is forbidden.')
  return assigned as CharacterSheet & Record<string, unknown> & { revision: 0, folder: string, updatedAt: number, createdAt: number }
}
let savepointOrdinal = 0
const nextSavepoint = (): string => `initialized_pokemon_sheet_${savepointOrdinal = (savepointOrdinal + 1) % 1_000_000}`
const prefixes = (folder: string): readonly string[] => folder ? folder.split('/').map((_value, index, parts) => parts.slice(0, index + 1).join('/')) : []
export const createSqliteInitializedPokemonSheetRepository = (options: CreateInitializedPokemonSheetRepositoryOptions = {}): InitializedPokemonSheetRepository => {
  const database = options.database ?? getRotomDatabase()
  const create = (input: CreateInitializedPokemonSheetInput): CreatedInitializedPokemonSheet => database.withTransaction(() => {
    const root = normalizeRoot(input.baseSlug)
    const folder = sanitizeFolderPath(String(input.folder ?? ''), { allowEmpty: true, label: 'Pokémon sheet folder' })
    for (let index = 0; index < INITIALIZED_POKEMON_SHEET_SLUG_ATTEMPT_MAXIMUM; index += 1) {
      const slug = candidateSlug(root, index)
      const sheet = fullyInitializedDocument(input, slug, folder)
      const savepoint = nextSavepoint()
      database.connection.exec(`SAVEPOINT ${savepoint}`)
      try {
        database.connection.prepare(`
          INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
          VALUES ('pokemon', ?, ?, 0, ?)
        `).run(slug, stableJsonStringify(sheet), sheet.updatedAt)
        for (const prefix of prefixes(folder)) database.connection.prepare(`
          INSERT INTO sheet_folders (kind, path, updated_at) VALUES ('pokemon', ?, ?)
          ON CONFLICT(kind, path) DO UPDATE SET updated_at = excluded.updated_at
        `).run(prefix, sheet.updatedAt)
        options.afterSheetInsert?.(slug)
        database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
        return Object.freeze({ kind: 'pokemon' as const, slug, folder, revision: 0 as const, updatedAt: sheet.updatedAt, path: logicalSheetResourcePath('pokemon', { slug, folder }), sheet: Object.freeze(sheet) })
      }
      catch (error) {
        database.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
        const collision = database.connection.prepare(`SELECT 1 AS found FROM sheets WHERE kind = 'pokemon' AND slug = ?`).get(slug)
        if (collision) continue
        throw error
      }
    }
    throw new PokemonSheetSlugAllocationError()
  })
  return Object.freeze({ database, create })
}
