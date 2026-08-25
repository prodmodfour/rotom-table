import { createHash } from 'node:crypto'
import {
  battleContestRosterCanonicalJson,
  parseBattleContestEncounterBinding,
  type BattleContestEncounterBindingV1,
  type BattleContestOpeningTeamV1,
  type BattleContestRosterHashMaterialV1,
} from '#shared/contests/battleEncounter'
import {
  parseBattleContestLink,
  type BattleContestLinkId,
  type BattleContestLinkV1,
} from '#shared/contests/battleBlend'
import {
  contestPerformerIsPokemon,
  parseContestDocument,
  type ContestDocumentV1,
  type ContestPokemonPerformerSnapshotV1,
} from '#shared/contests/document'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  createEncounterDocument,
  parseEncounterDocument,
  type EncounterDocument,
} from '#shared/encounterDocuments/model'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { initiativeOrderIdsForPlacements } from '~/utils/initiativeOrderEntries'
import { createMapSceneState } from '~/utils/mapSceneState'
import {
  encounterSceneId,
  planSceneLifecycle,
  type SceneLifecyclePlan,
} from '../moveAutomation/planSceneLifecycle'

export class BattleContestEncounterPlanningError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BattleContestEncounterPlanningError'
  }
}

export interface BattleContestEncounterSheetSnapshot {
  readonly kind: 'trainer' | 'pokemon'
  readonly slug: string
  readonly revision: number
  readonly updatedAt: number
  readonly document: Record<string, unknown>
}

export interface PlanBattleContestEncounterInput {
  readonly contest: ContestDocumentV1
  readonly operationId: string
  readonly encounterId: string
  readonly mapSlug: string
  readonly now: number
  readonly readSheet: (
    kind: 'trainer' | 'pokemon',
    slug: string,
  ) => BattleContestEncounterSheetSnapshot | null
}

export interface BattleContestEncounterPlanV1 {
  readonly link: BattleContestLinkV1
  readonly binding: BattleContestEncounterBindingV1
  readonly map: TabletopMap
  readonly encounter: EncounterDocument
  /** Existing Scene lifecycle authority may emit ordinary sheet writes. */
  readonly sceneLifecycle: SceneLifecyclePlan
}

const fail = (
  statusCode: 400 | 404 | 409,
  code: string,
  message: string,
): never => { throw new BattleContestEncounterPlanningError(statusCode, code, message) }

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const boundedName = (value: string, suffix: string, maximum: number): string => {
  const available = Math.max(1, maximum - suffix.length)
  return `${value.slice(0, available).trim() || 'Battle Contest'}${suffix}`
}
const linkIdFor = (contestId: string): BattleContestLinkId => (
  `battle-contest-link:v1:${sha256(contestId).slice(0, 24)}` as BattleContestLinkId
)

const rosterHashMaterial = (contest: ContestDocumentV1): BattleContestRosterHashMaterialV1 => ({
  schemaVersion: 1,
  contestId: contest.contestId,
  teams: contest.contestants.map(team => ({
    contestantId: team.contestantId,
    trainerSheetSlug: team.trainerSheetSlug,
    trainerSheetRevision: team.trainerSheetRevision,
    pokemon: team.performers.filter(contestPerformerIsPokemon).map(performer => ({
      performerId: performer.performerId,
      pokemonSheetSlug: performer.pokemonSheetSlug,
      pokemonSheetRevision: performer.pokemonSheetRevision,
    })),
  })),
})

const currentSheet = (
  input: PlanBattleContestEncounterInput,
  kind: 'trainer' | 'pokemon',
  slug: string,
): BattleContestEncounterSheetSnapshot => input.readSheet(kind, slug)
  ?? fail(404, 'contest.battle-encounter-sheet-missing', `${kind === 'pokemon' ? 'Pokémon' : 'Trainer'} sheet ${slug} is unavailable; no Battle authority was created.`)

const pokemonDisplayName = (
  performer: ContestPokemonPerformerSnapshotV1,
  sheet: CharacterSheet,
): string => String(sheet.nickname || sheet.species || performer.displayName || performer.pokemonSheetSlug).slice(0, 200)

interface PlannedRosterMember {
  readonly performer: ContestPokemonPerformerSnapshotV1
  readonly stored: BattleContestEncounterSheetSnapshot
  readonly displayName: string
}
interface PlannedTeam {
  readonly index: number
  readonly sideId: string
  readonly trainerPlacementId: string
  readonly activePlacementId: string
  readonly trainerStored: BattleContestEncounterSheetSnapshot
  readonly pokemon: readonly PlannedRosterMember[]
}

const loadReviewedTeams = (
  input: PlanBattleContestEncounterInput,
  contest: ContestDocumentV1,
): readonly PlannedTeam[] => contest.contestants.map((team, index) => {
  const trainerStored = currentSheet(input, 'trainer', team.trainerSheetSlug)
  const pokemon = team.performers.filter(contestPerformerIsPokemon).map((performer) => {
    const stored = currentSheet(input, 'pokemon', performer.pokemonSheetSlug)
    const sheet = stored.document as unknown as CharacterSheet
    if (sheet.letterPressCombinedInto || sheet.zygardeDisassembledIntoCells) {
      fail(409, 'contest.battle-encounter-roster-ineligible', `${performer.displayName} can no longer act independently; no Battle authority was created.`)
    }
    return Object.freeze({ performer, stored, displayName: pokemonDisplayName(performer, sheet) })
  })
  return Object.freeze({
    index,
    sideId: `battle-team-${index + 1}`,
    trainerPlacementId: `battle-trainer-${index + 1}`,
    activePlacementId: `battle-pokemon-${index + 1}`,
    trainerStored,
    pokemon: Object.freeze(pokemon),
  })
})

const placementPosition = (teamIndex: number, kind: 'trainer' | 'pokemon') => teamIndex === 0
  ? { x: kind === 'trainer' ? 2 : 4, y: 0, z: 2 }
  : { x: kind === 'trainer' ? 17 : 15, y: 0, z: 17 }

const openingPlacements = (
  contest: ContestDocumentV1,
  teams: readonly PlannedTeam[],
): readonly SheetPlacement[] => teams.flatMap((team) => {
  const contestant = contest.contestants[team.index]!
  const active = team.pokemon[0]!
  return [
    {
      id: team.trainerPlacementId,
      sheetKind: 'trainer' as const,
      sheetSlug: contestant.trainerSheetSlug,
      sideId: team.sideId,
      position: placementPosition(team.index, 'trainer'),
    },
    {
      id: team.activePlacementId,
      sheetKind: 'pokemon' as const,
      sheetSlug: active.performer.pokemonSheetSlug,
      sideId: team.sideId,
      position: placementPosition(team.index, 'pokemon'),
    },
  ]
})

const sheetSnapshots = (teams: readonly PlannedTeam[]) => ({
  trainerSheets: new Map(teams.map((team) => [team.trainerStored.slug, {
    ...team.trainerStored.document,
    slug: team.trainerStored.slug,
    revision: team.trainerStored.revision,
    updatedAt: team.trainerStored.updatedAt,
  } as unknown as TrainerSheet])),
  pokemonSheets: new Map(teams.flatMap(team => team.pokemon.slice(0, 1).map(member => [member.stored.slug, {
    ...member.stored.document,
    slug: member.stored.slug,
    revision: member.stored.revision,
    updatedAt: member.stored.updatedAt,
  } as unknown as CharacterSheet]))),
})

const projectedSheetsAfterScene = (
  teams: readonly PlannedTeam[],
  lifecycle: SceneLifecyclePlan,
): ReadonlyMap<string, { readonly sheet: Record<string, unknown>, readonly revision: number }> => {
  const result = new Map<string, { readonly sheet: Record<string, unknown>, readonly revision: number }>()
  for (const team of teams) {
    result.set(`trainer:${team.trainerStored.slug}`, { sheet: team.trainerStored.document, revision: team.trainerStored.revision })
    for (const member of team.pokemon) result.set(`pokemon:${member.stored.slug}`, { sheet: member.stored.document, revision: member.stored.revision })
  }
  for (const write of lifecycle.sheetWrites) result.set(`${write.kind}:${write.slug}`, { sheet: write.nextSheet as unknown as Record<string, unknown>, revision: write.revision })
  return result
}

const encounterBinding = (input: {
  readonly link: BattleContestLinkV1
  readonly sceneId: string
  readonly initiativeOrder: readonly string[]
  readonly contest: ContestDocumentV1
  readonly teams: readonly PlannedTeam[]
  readonly projectedSheets: ReadonlyMap<string, { readonly sheet: Record<string, unknown>, readonly revision: number }>
}): BattleContestEncounterBindingV1 => parseBattleContestEncounterBinding({
  schemaVersion: 1,
  link: input.link,
  sceneId: input.sceneId,
  openingRound: 1,
  openingInitiativeOrderIds: input.initiativeOrder,
  openingActivePlacementId: input.initiativeOrder[0],
  teams: input.teams.map((team): BattleContestOpeningTeamV1 => {
    const contestant = input.contest.contestants[team.index]!
    return {
      contestantId: contestant.contestantId,
      sideId: team.sideId,
      trainer: {
        sheetSlug: contestant.trainerSheetSlug,
        contestSheetRevision: contestant.trainerSheetRevision,
        openingSheetRevision: input.projectedSheets.get(`trainer:${contestant.trainerSheetSlug}`)!.revision,
        placementId: team.trainerPlacementId,
      },
      pokemon: team.pokemon.map((member, memberIndex) => ({
        performerId: member.performer.performerId,
        sheetSlug: member.performer.pokemonSheetSlug,
        contestSheetRevision: member.performer.pokemonSheetRevision,
        openingSheetRevision: input.projectedSheets.get(`pokemon:${member.performer.pokemonSheetSlug}`)!.revision,
        reserveId: `battle-team-${team.index + 1}-pokemon-${memberIndex + 1}`,
        openingPlacementId: memberIndex === 0 ? team.activePlacementId : null,
      })),
    }
  }),
})

export const planBattleContestEncounter = (
  input: PlanBattleContestEncounterInput,
): BattleContestEncounterPlanV1 => {
  const contest = parseContestDocument(input.contest)
  if (contest.variantId !== 'battle') fail(409, 'contest.battle-encounter-unavailable', 'Only a Battle Contest can create linked Encounter authority.')
  if (contest.stage !== 'introduction' || contest.paused) fail(409, 'contest.battle-encounter-stage', 'Battle Encounter creation requires an unpaused Introduction stage.')
  if (contest.battle?.encounter) fail(409, 'contest.battle-encounter-linked', 'This Battle Contest already has immutable linked Encounter authority.')
  if (contest.contestants.length !== 2 || contest.contestants.some(team => team.introduction.status !== 'accepted')) {
    fail(409, 'contest.battle-encounter-introductions', 'Both Trainer-team Introductions must be accepted before Encounter creation.')
  }
  if (!contest.battle?.roundBudget || !contest.battle.declaredPokemonPerTrainer) {
    fail(409, 'contest.battle-encounter-roster', 'Battle roster size and round budget are unavailable.')
  }

  const rosterMaterial = rosterHashMaterial(contest)
  const rosterSha256 = sha256(battleContestRosterCanonicalJson(rosterMaterial))
  const link = parseBattleContestLink({
    schemaVersion: 1,
    linkId: linkIdFor(contest.contestId),
    contestId: contest.contestId,
    encounterId: input.encounterId,
    linkedMapSlug: input.mapSlug,
    contestRosterSha256: rosterSha256,
    createdAt: input.now,
  })
  const teams = loadReviewedTeams(input, contest)
  const placements = openingPlacements(contest, teams)
  const mapName = boundedName(contest.display.name, ' — Battle', 80)
  const scene = createMapSceneState(boundedName(contest.display.name, ' — Battle', 120), input.now)
  const emptyEncounter = createEmptyEncounterState()
  const baseMap: TabletopMap = {
    schemaVersion: 2,
    revision: 0,
    slug: input.mapSlug,
    name: mapName,
    folder: 'battle-contests',
    dimensions: { x: 20, y: 12, z: 20 },
    groundLevelY: 0,
    playerVisible: true,
    placements: [...placements],
    initiative: { activeId: null, round: 1 },
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    lights: [],
    encounterState: {
      ...emptyEncounter,
      sides: Object.fromEntries(teams.map(team => {
        const label = `${contest.contestants[team.index]!.displayName} team`.slice(0, 80)
        return [team.sideId, { id: team.sideId, label, status: 'active' as const }]
      })),
    },
    createdAt: input.now,
    updatedAt: input.now,
  }
  const lifecycle = planSceneLifecycle({
    map: baseMap,
    previous: null,
    current: scene,
    operationId: input.operationId,
    time: input.now,
    loadSheets: () => sheetSnapshots(teams),
  })
  const projectedSheets = projectedSheetsAfterScene(teams, lifecycle)
  const initiativeOrder = initiativeOrderIdsForPlacements(
    lifecycle.nextMap.placements,
    (kind, slug) => projectedSheets.get(`${kind}:${slug}`) ?? null,
  )
  if (initiativeOrder.length !== placements.length || !initiativeOrder[0]) {
    fail(409, 'contest.battle-encounter-initiative', 'Normal Encounter initiative could not include every opening combatant.')
  }
  const map: TabletopMap = {
    ...lifecycle.nextMap,
    revision: 0,
    initiative: { activeId: initiativeOrder[0], round: 1 },
    createdAt: input.now,
    updatedAt: input.now,
  }
  const binding = encounterBinding({
    link,
    sceneId: encounterSceneId(input.mapSlug, scene),
    initiativeOrder,
    contest,
    teams,
    projectedSheets,
  })
  const encounterBase = createEncounterDocument({
    encounterId: input.encounterId,
    name: mapName,
    linkedMapSlug: input.mapSlug,
    recipe: 'trainer-duel',
    now: input.now,
  })
  const encounter = parseEncounterDocument({
    ...encounterBase,
    battleContest: binding,
    lifecycle: 'active',
    castRoles: teams.flatMap(team => [
      { participantId: team.trainerPlacementId, role: 'leader' },
      { participantId: team.activePlacementId, role: 'standard' },
    ]),
    reserves: teams.flatMap(team => {
      const contestant = contest.contestants[team.index]!
      return team.pokemon.map((member, memberIndex) => ({
        reserveId: binding.teams[team.index]!.pokemon[memberIndex]!.reserveId,
        sheetKind: 'pokemon',
        sheetSlug: member.performer.pokemonSheetSlug,
        displayName: member.displayName,
        sideId: team.sideId,
        ownerParticipantId: team.trainerPlacementId,
        visibility: 'public',
        status: memberIndex === 0 ? 'deployed' : 'ready',
        placementId: memberIndex === 0 ? team.activePlacementId : null,
      }))
    }),
    stakes: {
      public: `Battle Contest · ${contest.contestTypeId} · ${contest.battle!.roundBudget} rounds`,
      gm: null,
    },
  })

  return Object.freeze({ link, binding, map, encounter, sceneLifecycle: lifecycle })
}
