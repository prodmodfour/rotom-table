import { stableJsonStringify } from '../automation/stableJson'
import {
  parseBattleContestLink,
  type BattleContestLinkV1,
} from './battleBlend'
import {
  parseContestId,
  parseContestantId,
} from './ids'

/**
 * Immutable opening authority shared by a linked Battle Contest and its
 * existing Encounter Document. It maps accepted Contest roster identities to
 * normal map placements/reserves without becoming a third battle engine.
 */
export const BATTLE_CONTEST_ENCOUNTER_BINDING_SCHEMA_VERSION = 1 as const
export const BATTLE_CONTEST_ENCOUNTER_BINDING_ID = 'battle-contest-encounter-binding:v1' as const

export interface BattleContestOpeningTrainerV1 {
  readonly sheetSlug: string
  /** Revision frozen by Contest enrollment. */
  readonly contestSheetRevision: number
  /** Current ordinary-sheet revision consulted by Encounter creation. */
  readonly openingSheetRevision: number
  readonly placementId: string
}

export interface BattleContestOpeningPokemonV1 {
  readonly performerId: string
  readonly sheetSlug: string
  /** Revision frozen by Contest enrollment. */
  readonly contestSheetRevision: number
  /** Current ordinary-sheet revision consulted by Encounter creation. */
  readonly openingSheetRevision: number
  readonly reserveId: string
  /** Present for exactly one initially deployed Pokémon on each team. */
  readonly openingPlacementId: string | null
}

export interface BattleContestOpeningTeamV1 {
  readonly contestantId: string
  readonly sideId: string
  readonly trainer: BattleContestOpeningTrainerV1
  readonly pokemon: readonly BattleContestOpeningPokemonV1[]
}

export interface BattleContestEncounterBindingV1 {
  readonly schemaVersion: typeof BATTLE_CONTEST_ENCOUNTER_BINDING_SCHEMA_VERSION
  readonly link: BattleContestLinkV1
  readonly sceneId: string
  readonly openingRound: 1
  /** Exact normal initiative order derived by existing Encounter authority. */
  readonly openingInitiativeOrderIds: readonly string[]
  readonly openingActivePlacementId: string
  readonly teams: readonly BattleContestOpeningTeamV1[]
}

/** Canonical material hashed into BattleContestLinkV1.contestRosterSha256. */
export interface BattleContestRosterHashTeamV1 {
  readonly contestantId: string
  readonly trainerSheetSlug: string
  readonly trainerSheetRevision: number
  readonly pokemon: readonly {
    readonly performerId: string
    readonly pokemonSheetSlug: string
    readonly pokemonSheetRevision: number
  }[]
}

export interface BattleContestRosterHashMaterialV1 {
  readonly schemaVersion: 1
  readonly contestId: string
  readonly teams: readonly BattleContestRosterHashTeamV1[]
}

export type BattleContestEncounterBindingValidationCode =
  | 'battle-contest.encounter-binding-invalid'
  | 'battle-contest.encounter-binding-mismatch'

export class BattleContestEncounterBindingError extends Error {
  constructor(
    readonly code: BattleContestEncounterBindingValidationCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'BattleContestEncounterBindingError'
  }
}

type UnknownRecord = Record<string, unknown>
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u
const SIDE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u
const CONTROL = /[\u0000-\u001f\u007f]/u

const fail = (
  code: BattleContestEncounterBindingValidationCode,
  path: string,
  message: string,
): never => { throw new BattleContestEncounterBindingError(code, path, message) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('battle-contest.encounter-binding-invalid', path, 'must be an object.')
  }
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (Object.keys(value).length !== fields.length
    || fields.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !expected.has(field))) {
    fail('battle-contest.encounter-binding-invalid', path, `must contain exactly: ${fields.join(', ')}.`)
  }
}
const id = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !STABLE_ID.test(value) || CONTROL.test(value)) {
    return fail('battle-contest.encounter-binding-invalid', path, 'must be a stable bounded identifier.')
  }
  return value
}
const sideId = (value: unknown, path: string): string => {
  const parsed = id(value, path)
  return SIDE_ID.test(parsed)
    ? parsed
    : fail('battle-contest.encounter-binding-invalid', path, 'must be a map-local encounter side identifier.')
}
const revision = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value)
  : fail('battle-contest.encounter-binding-invalid', path, 'must be a non-negative safe integer.')
const freeze = <T>(value: T): T => Object.freeze(structuredClone(value)) as T
const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) {
    fail('battle-contest.encounter-binding-invalid', path, 'must not contain duplicate identities.')
  }
}

const parseTrainer = (value: unknown, path: string): BattleContestOpeningTrainerV1 => {
  const row = record(value, path)
  exact(row, ['sheetSlug', 'contestSheetRevision', 'openingSheetRevision', 'placementId'], path)
  return freeze({
    sheetSlug: id(row.sheetSlug, `${path}.sheetSlug`),
    contestSheetRevision: revision(row.contestSheetRevision, `${path}.contestSheetRevision`),
    openingSheetRevision: revision(row.openingSheetRevision, `${path}.openingSheetRevision`),
    placementId: id(row.placementId, `${path}.placementId`),
  })
}

const parsePokemon = (value: unknown, path: string): BattleContestOpeningPokemonV1 => {
  const row = record(value, path)
  exact(row, ['performerId', 'sheetSlug', 'contestSheetRevision', 'openingSheetRevision', 'reserveId', 'openingPlacementId'], path)
  return freeze({
    performerId: id(row.performerId, `${path}.performerId`),
    sheetSlug: id(row.sheetSlug, `${path}.sheetSlug`),
    contestSheetRevision: revision(row.contestSheetRevision, `${path}.contestSheetRevision`),
    openingSheetRevision: revision(row.openingSheetRevision, `${path}.openingSheetRevision`),
    reserveId: id(row.reserveId, `${path}.reserveId`),
    openingPlacementId: row.openingPlacementId === null
      ? null
      : id(row.openingPlacementId, `${path}.openingPlacementId`),
  })
}

const parseTeam = (value: unknown, path: string): BattleContestOpeningTeamV1 => {
  const row = record(value, path)
  exact(row, ['contestantId', 'sideId', 'trainer', 'pokemon'], path)
  const pokemonValues = row.pokemon
  if (!Array.isArray(pokemonValues) || pokemonValues.length < 3 || pokemonValues.length > 6) {
    fail('battle-contest.encounter-binding-invalid', `${path}.pokemon`, 'must contain three through six accepted roster Pokémon.')
  }
  const pokemon = (pokemonValues as unknown[]).map((entry, index) => parsePokemon(entry, `${path}.pokemon[${index}]`))
  unique(pokemon.map(entry => entry.performerId), `${path}.pokemon.performerId`)
  unique(pokemon.map(entry => entry.sheetSlug), `${path}.pokemon.sheetSlug`)
  unique(pokemon.map(entry => entry.reserveId), `${path}.pokemon.reserveId`)
  const active = pokemon.filter(entry => entry.openingPlacementId !== null)
  if (active.length !== 1) {
    fail('battle-contest.encounter-binding-invalid', `${path}.pokemon`, 'must identify exactly one opening active Pokémon.')
  }
  return freeze({
    contestantId: parseContestantId(row.contestantId, `${path}.contestantId`),
    sideId: sideId(row.sideId, `${path}.sideId`),
    trainer: parseTrainer(row.trainer, `${path}.trainer`),
    pokemon,
  })
}

export const parseBattleContestEncounterBinding = (value: unknown): BattleContestEncounterBindingV1 => {
  const row = record(value, 'battleEncounterBinding')
  exact(row, ['schemaVersion', 'link', 'sceneId', 'openingRound', 'openingInitiativeOrderIds', 'openingActivePlacementId', 'teams'], 'battleEncounterBinding')
  if (row.schemaVersion !== BATTLE_CONTEST_ENCOUNTER_BINDING_SCHEMA_VERSION) {
    fail('battle-contest.encounter-binding-invalid', 'battleEncounterBinding.schemaVersion', 'is unsupported.')
  }
  if (row.openingRound !== 1) {
    fail('battle-contest.encounter-binding-invalid', 'battleEncounterBinding.openingRound', 'must be Round 1.')
  }
  const teamValues = row.teams
  if (!Array.isArray(teamValues) || teamValues.length !== 2) {
    fail('battle-contest.encounter-binding-invalid', 'battleEncounterBinding.teams', 'must contain exactly two Trainer teams.')
  }
  const link = parseBattleContestLink(row.link)
  const teams = (teamValues as unknown[]).map((team, index) => parseTeam(team, `battleEncounterBinding.teams[${index}]`))
  unique(teams.map(team => team.contestantId), 'battleEncounterBinding.teams.contestantId')
  unique(teams.map(team => team.sideId), 'battleEncounterBinding.teams.sideId')
  unique(teams.map(team => team.trainer.sheetSlug), 'battleEncounterBinding.teams.trainer.sheetSlug')

  const placementIds = teams.flatMap(team => [
    team.trainer.placementId,
    ...team.pokemon.flatMap(member => member.openingPlacementId === null ? [] : [member.openingPlacementId]),
  ])
  unique(placementIds, 'battleEncounterBinding.placements')
  const reserveIds = teams.flatMap(team => team.pokemon.map(member => member.reserveId))
  unique(reserveIds, 'battleEncounterBinding.reserves')
  const pokemonSlugs = teams.flatMap(team => team.pokemon.map(member => member.sheetSlug))
  unique(pokemonSlugs, 'battleEncounterBinding.pokemonSheets')

  const initiativeValues = row.openingInitiativeOrderIds
  if (!Array.isArray(initiativeValues) || initiativeValues.length !== placementIds.length) {
    fail('battle-contest.encounter-binding-invalid', 'battleEncounterBinding.openingInitiativeOrderIds', 'must contain every opening placement exactly once.')
  }
  const openingInitiativeOrderIds = (initiativeValues as unknown[]).map((entry, index) => id(entry, `battleEncounterBinding.openingInitiativeOrderIds[${index}]`))
  unique(openingInitiativeOrderIds, 'battleEncounterBinding.openingInitiativeOrderIds')
  if ([...openingInitiativeOrderIds].sort().join('\n') !== [...placementIds].sort().join('\n')) {
    fail('battle-contest.encounter-binding-mismatch', 'battleEncounterBinding.openingInitiativeOrderIds', 'must be a permutation of the opening Trainer and active Pokémon placements.')
  }
  const openingActivePlacementId = id(row.openingActivePlacementId, 'battleEncounterBinding.openingActivePlacementId')
  if (openingActivePlacementId !== openingInitiativeOrderIds[0]) {
    fail('battle-contest.encounter-binding-mismatch', 'battleEncounterBinding.openingActivePlacementId', 'must be the first accepted normal initiative placement.')
  }

  return freeze({
    schemaVersion: BATTLE_CONTEST_ENCOUNTER_BINDING_SCHEMA_VERSION,
    link,
    sceneId: id(row.sceneId, 'battleEncounterBinding.sceneId'),
    openingRound: 1,
    openingInitiativeOrderIds,
    openingActivePlacementId,
    teams,
  })
}

export const parseBattleContestRosterHashMaterial = (value: unknown): BattleContestRosterHashMaterialV1 => {
  const row = record(value, 'battleContestRoster')
  exact(row, ['schemaVersion', 'contestId', 'teams'], 'battleContestRoster')
  const teamValues = row.teams
  if (row.schemaVersion !== 1 || !Array.isArray(teamValues) || teamValues.length !== 2) {
    fail('battle-contest.encounter-binding-invalid', 'battleContestRoster', 'must be schema v1 with exactly two teams.')
  }
  const teams = (teamValues as unknown[]).map((value, teamIndex): BattleContestRosterHashTeamV1 => {
    const path = `battleContestRoster.teams[${teamIndex}]`
    const team = record(value, path)
    exact(team, ['contestantId', 'trainerSheetSlug', 'trainerSheetRevision', 'pokemon'], path)
    const pokemonValues = team.pokemon
    if (!Array.isArray(pokemonValues) || pokemonValues.length < 3 || pokemonValues.length > 6) {
      fail('battle-contest.encounter-binding-invalid', `${path}.pokemon`, 'must contain three through six Pokémon.')
    }
    const pokemon = (pokemonValues as unknown[]).map((value, index) => {
      const memberPath = `${path}.pokemon[${index}]`
      const member = record(value, memberPath)
      exact(member, ['performerId', 'pokemonSheetSlug', 'pokemonSheetRevision'], memberPath)
      return freeze({
        performerId: id(member.performerId, `${memberPath}.performerId`),
        pokemonSheetSlug: id(member.pokemonSheetSlug, `${memberPath}.pokemonSheetSlug`),
        pokemonSheetRevision: revision(member.pokemonSheetRevision, `${memberPath}.pokemonSheetRevision`),
      })
    })
    unique(pokemon.map(member => member.performerId), `${path}.pokemon.performerId`)
    unique(pokemon.map(member => member.pokemonSheetSlug), `${path}.pokemon.pokemonSheetSlug`)
    return freeze({
      contestantId: parseContestantId(team.contestantId, `${path}.contestantId`),
      trainerSheetSlug: id(team.trainerSheetSlug, `${path}.trainerSheetSlug`),
      trainerSheetRevision: revision(team.trainerSheetRevision, `${path}.trainerSheetRevision`),
      pokemon,
    })
  })
  unique(teams.map(team => team.contestantId), 'battleContestRoster.teams.contestantId')
  unique(teams.map(team => team.trainerSheetSlug), 'battleContestRoster.teams.trainerSheetSlug')
  unique(teams.flatMap(team => team.pokemon.map(member => member.pokemonSheetSlug)), 'battleContestRoster.teams.pokemonSheetSlug')
  return freeze({ schemaVersion: 1, contestId: parseContestId(row.contestId, 'battleContestRoster.contestId'), teams })
}

export const battleContestRosterCanonicalJson = (value: BattleContestRosterHashMaterialV1): string =>
  stableJsonStringify(parseBattleContestRosterHashMaterial(value), {
    path: 'battleContestRoster',
    limits: { maxDepth: 8, maxNodes: 256, maxArrayEntries: 16, maxObjectFields: 8, maxStringLength: 200 },
  })
