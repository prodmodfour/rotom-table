import { describe, expect, it } from 'vitest'
import {
  battleContestRosterCanonicalJson,
  parseBattleContestEncounterBinding,
  parseBattleContestRosterHashMaterial,
  type BattleContestEncounterBindingV1,
} from '../../shared/contests/battleEncounter'
import { parseContestCommand } from '../../shared/contests/operations'
import { createEncounterDocument, parseEncounterDocument } from '../../shared/encounterDocuments/model'

const HASH = 'a'.repeat(64)
const binding = (): BattleContestEncounterBindingV1 => parseBattleContestEncounterBinding({
  schemaVersion: 1,
  link: {
    schemaVersion: 1,
    linkId: 'battle-contest-link:v1:binding-test',
    contestId: 'contest:v1:battle-binding-test',
    encounterId: 'contest:v1:battle-binding-test:battle-encounter',
    linkedMapSlug: 'battle-binding-test-map',
    contestRosterSha256: HASH,
    createdAt: 10,
  },
  sceneId: 'scene.binding-test',
  openingRound: 1,
  openingInitiativeOrderIds: ['battle-pokemon-2', 'battle-pokemon-1', 'battle-trainer-2', 'battle-trainer-1'],
  openingActivePlacementId: 'battle-pokemon-2',
  teams: [
    {
      contestantId: 'contestant:battle-north', sideId: 'battle-team-1',
      trainer: { sheetSlug: 'trainer-north', contestSheetRevision: 2, openingSheetRevision: 4, placementId: 'battle-trainer-1' },
      pokemon: [1, 2, 3].map(index => ({ performerId: `pokemon:north-${index}`, sheetSlug: `pokemon-north-${index}`, contestSheetRevision: index, openingSheetRevision: index + 1, reserveId: `battle-team-1-pokemon-${index}`, openingPlacementId: index === 1 ? 'battle-pokemon-1' : null })),
    },
    {
      contestantId: 'contestant:battle-south', sideId: 'battle-team-2',
      trainer: { sheetSlug: 'trainer-south', contestSheetRevision: 3, openingSheetRevision: 5, placementId: 'battle-trainer-2' },
      pokemon: [1, 2, 3].map(index => ({ performerId: `pokemon:south-${index}`, sheetSlug: `pokemon-south-${index}`, contestSheetRevision: index, openingSheetRevision: index + 1, reserveId: `battle-team-2-pokemon-${index}`, openingPlacementId: index === 1 ? 'battle-pokemon-2' : null })),
    },
  ],
})

const roster = () => ({
  schemaVersion: 1 as const,
  contestId: 'contest:v1:battle-binding-test',
  teams: [
    { contestantId: 'contestant:battle-north', trainerSheetSlug: 'trainer-north', trainerSheetRevision: 2, pokemon: [1, 2, 3].map(index => ({ performerId: `pokemon:north-${index}`, pokemonSheetSlug: `pokemon-north-${index}`, pokemonSheetRevision: index })) },
    { contestantId: 'contestant:battle-south', trainerSheetSlug: 'trainer-south', trainerSheetRevision: 3, pokemon: [1, 2, 3].map(index => ({ performerId: `pokemon:south-${index}`, pokemonSheetSlug: `pokemon-south-${index}`, pokemonSheetRevision: index })) },
  ],
})

describe('Battle Contest opening Encounter binding', () => {
  it('accepts exactly two 3–6 member rosters, one active Pokémon each, and one complete normal initiative permutation', () => {
    const accepted = binding()
    expect(accepted.teams).toHaveLength(2)
    expect(accepted.teams.map(team => team.pokemon.filter(member => member.openingPlacementId !== null).length)).toEqual([1, 1])
    expect(accepted.openingActivePlacementId).toBe(accepted.openingInitiativeOrderIds[0])
    expect(Object.isFrozen(accepted)).toBe(true)
  })

  it('fails closed on duplicate placements, missing initiative members, wrong active order, and a second deployed team Pokémon', () => {
    const accepted = binding()
    const duplicatePlacement = structuredClone(accepted)
    duplicatePlacement.teams[1]!.trainer.placementId = duplicatePlacement.teams[0]!.trainer.placementId
    expect(() => parseBattleContestEncounterBinding(duplicatePlacement)).toThrow(/duplicate identities/i)

    const missingInitiative = structuredClone(accepted)
    missingInitiative.openingInitiativeOrderIds.pop()
    expect(() => parseBattleContestEncounterBinding(missingInitiative)).toThrow(/every opening placement exactly once/i)

    const wrongActive = structuredClone(accepted)
    wrongActive.openingActivePlacementId = wrongActive.openingInitiativeOrderIds[1]!
    expect(() => parseBattleContestEncounterBinding(wrongActive)).toThrow(/first accepted normal initiative/i)

    const doubleDeploy = structuredClone(accepted)
    doubleDeploy.teams[0]!.pokemon[1]!.openingPlacementId = 'battle-pokemon-extra'
    expect(() => parseBattleContestEncounterBinding(doubleDeploy)).toThrow(/exactly one opening active/i)
  })

  it('canonicalizes the exact accepted roster snapshots deterministically and preserves order as authority', () => {
    const accepted = parseBattleContestRosterHashMaterial(roster())
    const first = battleContestRosterCanonicalJson(accepted)
    expect(battleContestRosterCanonicalJson(structuredClone(accepted))).toBe(first)
    const reordered = structuredClone(accepted)
    reordered.teams[0]!.pokemon.reverse()
    expect(battleContestRosterCanonicalJson(reordered)).not.toBe(first)
    expect(() => parseBattleContestRosterHashMaterial({ ...roster(), teams: [roster().teams[0], roster().teams[0]] })).toThrow(/duplicate identities/i)
  })

  it('adds the binding backward-compatibly to Encounter Documents and couples exact Encounter/map identities', () => {
    const accepted = binding()
    const base = createEncounterDocument({ encounterId: accepted.link.encounterId, linkedMapSlug: accepted.link.linkedMapSlug, name: 'Binding test', recipe: 'trainer-duel', now: 10 })
    const linked = parseEncounterDocument({ ...base, lifecycle: 'active', battleContest: accepted })
    expect(linked.battleContest).toEqual(accepted)

    const legacy = structuredClone(base) as Record<string, unknown>
    delete legacy.battleContest
    expect(parseEncounterDocument(legacy).battleContest).toBeNull()
    expect(() => parseEncounterDocument({ ...linked, encounterId: 'encounter:other' })).toThrow(/exact Encounter Document/i)
    expect(() => parseEncounterDocument({ ...linked, linkedMapSlug: 'other-map' })).toThrow(/linked battlefield/i)
    expect(() => parseEncounterDocument({ ...linked, lifecycle: 'draft' })).toThrow(/launched trainer-duel/i)
  })

  it('keeps map, deployment, reserve, and initiative material out of the client command dialect', () => {
    const command = { schemaVersion: 1, commandKind: 'create-battle-encounter', operationId: 'contest-op:v1:binding-command', contestId: 'contest:v1:battle-binding-test', expectedRevision: 4, clientId: 'binding-test' }
    expect(parseContestCommand(command)).toEqual(command)
    for (const forged of [
      { mapSlug: 'client-map' }, { placementIds: [] }, { initiativeOrderIds: [] }, { activePokemonPerformerIds: [] }, { encounterId: 'client-encounter' },
    ]) expect(() => parseContestCommand({ ...command, ...forged })).toThrow(/not recognized/i)
  })
})
