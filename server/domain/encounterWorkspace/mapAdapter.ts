import type { EncounterParticipantPresentationRef, EncounterPresentationProjection } from '#shared/encounterPresentation'
import {
  ENCOUNTER_WORKSPACE_SCHEMA_VERSION,
  assertEncounterWorkspaceViewModel,
  type EncounterWorkspaceAudience,
  type EncounterWorkspaceConnectionState,
  type EncounterWorkspaceEnvironmentEntry,
  type EncounterWorkspaceParticipant,
  type EncounterWorkspaceSide,
  type EncounterWorkspaceTeam,
  type EncounterWorkspaceTurnEntry,
  type EncounterWorkspaceViewModel,
} from '#shared/encounterWorkspace/model'
import type { EncounterResourceSummary, EncounterSideAccent } from '#shared/encounterWorkspace/primitives'
import type { EncounterDocument } from '#shared/encounterDocuments/model'
import type { LiveTableSnapshot } from '#shared/liveTableSnapshot'
import type { EncounterActionType, EncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { computeMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import { catalogEntryForPokemonSheet, catalogEntryForTrainerSheet } from '~/utils/sheetSpawn'
import { computeTrainerMaxAp, computeTrainerMaxHp } from '~/utils/sheets/trainerDerived'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const SIDE_SYMBOLS = ['◆', '●', '▲', '■', '✦', '⬟', '◇', '○'] as const
const ACTION_LABELS: Readonly<Record<EncounterActionType, string>> = Object.freeze({
  standard: 'Standard',
  shift: 'Shift',
  swift: 'Swift',
  free: 'Free',
  full: 'Full',
  interrupt: 'Interrupt',
  reaction: 'Reaction',
})

export interface MapBackedEncounterWorkspaceAdapterOptions {
  readonly audience: EncounterWorkspaceAudience
  readonly controlledParticipantIds?: readonly string[]
  readonly visibleParticipantIds?: readonly string[]
  readonly hiddenParticipantCountsBySide?: Readonly<Record<string, number>>
  readonly hiddenParticipantIds?: readonly string[]
  readonly canUseExactGeometry?: boolean
  readonly connection?: EncounterWorkspaceConnectionState
  readonly replayGap?: boolean
  readonly blockingMessage?: string | null
}

const safeInteger = (value: unknown, fallback = 0): number => (
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback
)

const presentationParticipants = (
  projection: EncounterPresentationProjection,
): ReadonlyMap<string, EncounterParticipantPresentationRef> => {
  const participants = new Map<string, EncounterParticipantPresentationRef>()
  const add = (participant: EncounterParticipantPresentationRef | null): void => {
    if (!participant) return
    const prior = participants.get(participant.participantId)
    if (prior && (prior.displayName !== participant.displayName || prior.sheetKind !== participant.sheetKind)) {
      throw new Error(`Presentation participant ${participant.participantId} is inconsistent.`)
    }
    participants.set(participant.participantId, participant)
  }
  for (const offer of projection.offers) add(offer.actor)
  for (const passive of projection.passives) add(passive.participant)
  for (const affordance of projection.affordances) add(affordance.actor)
  for (const pending of projection.pending) add(pending.actor)
  for (const accepted of projection.accepted) {
    add(accepted.actor)
    for (const participant of accepted.affectedParticipants) add(participant)
  }
  return participants
}

const safePokemonPortrait = (sheet: CharacterSheet | null): string | null => {
  const species = sheet?.species?.trim().toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return species ? `/api/profile-sprites/pokemon/${species}` : null
}

const sideAccent = (
  placement: SheetPlacement,
  map: TabletopMap,
  sideSymbols: ReadonlyMap<string, string>,
): EncounterSideAccent | null => {
  if (!placement.sideId) return null
  const side = map.encounterState?.sides[placement.sideId]
  if (!side) return null
  return {
    id: side.id,
    label: side.label,
    symbol: sideSymbols.get(side.id) ?? '◇',
    color: side.color,
  }
}

const actionResources = (
  ledger: EncounterTurnResourceLedger | null,
): EncounterResourceSummary[] => {
  if (!ledger) return []
  const resources: EncounterResourceSummary[] = []
  for (const type of Object.keys(ACTION_LABELS) as EncounterActionType[]) {
    const action = ledger.actions[type]
    if (action.budget === null) continue
    resources.push({
      id: `action:${type}`,
      label: ACTION_LABELS[type],
      current: Math.max(0, action.budget - action.spent),
      maximum: action.budget,
    })
  }
  resources.push({
    id: 'reaction:available',
    label: 'Reaction',
    current: ledger.reaction.available ? 1 : 0,
    maximum: 1,
  })
  if (ledger.movement.budget !== null) {
    resources.push({
      id: 'movement',
      label: 'Movement',
      current: Math.max(0, ledger.movement.budget - ledger.movement.spent),
      maximum: ledger.movement.budget,
    })
  }
  return resources
}

const trainerApResource = (sheet: TrainerSheet | null): EncounterResourceSummary[] => {
  if (!sheet) return []
  const maximum = computeTrainerMaxAp(sheet)
  const current = sheet.ap?.left ?? Math.max(
    0,
    maximum - safeInteger(sheet.ap?.spent) - safeInteger(sheet.ap?.bound) - safeInteger(sheet.ap?.drained),
  )
  return [{ id: 'trainer:ap', label: 'AP', current: Math.max(0, current), maximum }]
}

const participantForPlacement = (input: {
  readonly placement: SheetPlacement
  readonly map: TabletopMap
  readonly pokemonBySlug: ReadonlyMap<string, CharacterSheet>
  readonly trainerBySlug: ReadonlyMap<string, TrainerSheet>
  readonly presentationById: ReadonlyMap<string, EncounterParticipantPresentationRef>
  readonly controlled: ReadonlySet<string>
  readonly sideSymbols: ReadonlyMap<string, string>
  readonly exactGeometry: boolean
  readonly hidden: ReadonlySet<string>
  readonly canUseDirector: boolean
  readonly castRole: EncounterDocument['castRoles'][number]['role'] | null
}): EncounterWorkspaceParticipant => {
  const { placement, map } = input
  const pokemon = placement.sheetKind === 'pokemon' ? input.pokemonBySlug.get(placement.sheetSlug) ?? null : null
  const trainer = placement.sheetKind === 'trainer' ? input.trainerBySlug.get(placement.sheetSlug) ?? null : null
  const presented = input.presentationById.get(placement.id)
  const conditions = [...new Set((presented?.statusLabels ?? (
    placement.sheetKind === 'pokemon' ? pokemon?.combat?.conditions : trainer?.conditions
  ) ?? []).map(value => value.trim()).filter(Boolean))].slice(0, 64)
  const injuries = safeInteger(pokemon?.combat?.injuries ?? trainer?.currentInjuries)
  let hp: EncounterWorkspaceParticipant['hp'] = null
  if (pokemon) {
    const hpTotal = resolveStats(pokemon).find(stat => stat.key === 'hp')?.total ?? 0
    const maximum = Math.max(1, computeMaxHp(pokemon, hpTotal))
    hp = {
      current: Math.max(0, safeInteger(pokemon.combat?.currentHp, maximum)),
      maximum,
      temporary: Math.max(0, safeInteger(map.temporaryHitPoints?.byPlacementId[placement.id])),
    }
  }
  else if (trainer) {
    const maximum = Math.max(1, computeTrainerMaxHp(trainer))
    hp = {
      current: Math.max(0, safeInteger(trainer.currentHp, maximum)),
      maximum,
      temporary: Math.max(0, safeInteger(map.temporaryHitPoints?.byPlacementId[placement.id])),
    }
  }
  const ledger = map.encounterState?.turnResources[placement.id] ?? null
  const footprint = pokemon
    ? catalogEntryForPokemonSheet(pokemon)
    : trainer
      ? catalogEntryForTrainerSheet(trainer)
      : null
  const currentTurn = (map.initiative?.activeId ?? map.encounterState?.history.currentTurn?.placementId ?? null) === placement.id
  const fainted = Boolean(map.encounterState?.history.faintedPlacementIds.includes(placement.id)) || hp?.current === 0
  return {
    participantId: placement.id,
    kind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    displayName: presented?.displayName
      ?? pokemon?.nickname?.trim()
      ?? pokemon?.species?.trim()
      ?? trainer?.name?.trim()
      ?? 'Participant',
    roleLabel: input.castRole
      ? `${input.castRole.charAt(0).toLocaleUpperCase()}${input.castRole.slice(1)}`
      : placement.sheetKind === 'pokemon'
        ? (pokemon?.species?.trim() || 'Pokémon')
        : 'Trainer',
    portraitUrl: presented?.portraitUrl ?? trainer?.portraitUrl ?? safePokemonPortrait(pokemon),
    side: sideAccent(placement, map, input.sideSymbols),
    onMap: true,
    reserve: false,
    hidden: input.canUseDirector && input.hidden.has(placement.id),
    currentTurn,
    controlled: input.controlled.has(placement.id),
    initiative: Number.isFinite(placement.initiative) ? Number(placement.initiative) : null,
    position: input.exactGeometry && footprint ? { ...placement.position } : null,
    footprint: input.exactGeometry && footprint
      ? { base: footprint.base, clearance: footprint.clearance }
      : null,
    hp,
    injuries,
    conditions,
    resources: [...actionResources(ledger), ...trainerApResource(trainer)],
    fainted,
  }
}

const encounterTeams = (input: {
  readonly map: TabletopMap
  readonly participants: readonly EncounterWorkspaceParticipant[]
  readonly pokemonBySlug: ReadonlyMap<string, CharacterSheet>
  readonly trainerBySlug: ReadonlyMap<string, TrainerSheet>
  readonly audience: EncounterWorkspaceAudience
}): EncounterWorkspaceTeam[] => {
  if (input.audience === 'public') return []
  const participantById = new Map(input.participants.map(participant => [participant.participantId, participant]))
  const visiblePokemonPlacements = input.map.placements
    .filter(placement => placement.sheetKind === 'pokemon' && participantById.has(placement.id))
  const allPlacedPokemonSlugs = new Set(visiblePokemonPlacements.map(placement => placement.sheetSlug))
  const placedPokemonBySlug = new Map(visiblePokemonPlacements
    .map(placement => [`${placement.sideId ?? ''}\u0000${placement.sheetSlug}`, placement.id]))
  return input.map.placements
    .filter(placement => placement.sheetKind === 'trainer')
    .flatMap((placement): EncounterWorkspaceTeam[] => {
      const owner = participantById.get(placement.id)
      const trainer = input.trainerBySlug.get(placement.sheetSlug)
      if (!owner || !trainer || (input.audience === 'player-owner' && !owner.controlled)) return []
      const partySlugs = [...new Set((trainer.currentTeam ?? []).map(value => value.trim()).filter(Boolean))]
      const boxedSlugs = [...new Set((trainer.boxedPokemon ?? []).map(value => value.trim()).filter(Boolean))]
      const activeParticipantIds = partySlugs.flatMap((slug) => {
        const participantId = placedPokemonBySlug.get(`${placement.sideId ?? ''}\u0000${slug}`)
        return participantId ? [participantId] : []
      })
      const activeSlugs = new Set(activeParticipantIds.flatMap((participantId) => {
        const participant = participantById.get(participantId)
        return participant?.sheetSlug ? [participant.sheetSlug] : []
      }))
      const reserves = [...partySlugs.map(sheetSlug => ({ sheetSlug, location: 'party' as const })),
        ...boxedSlugs.map(sheetSlug => ({ sheetSlug, location: 'boxed' as const }))]
        .filter((entry, index, values) => !activeSlugs.has(entry.sheetSlug)
          && !allPlacedPokemonSlugs.has(entry.sheetSlug)
          && values.findIndex(value => value.sheetSlug === entry.sheetSlug) === index)
        .flatMap((entry) => {
          const sheet = input.pokemonBySlug.get(entry.sheetSlug)
          if (!sheet) return []
          return [{
            reserveId: `reserve:${placement.id}:${entry.sheetSlug}`,
            ownerParticipantId: placement.id,
            sheetSlug: entry.sheetSlug,
            displayName: sheet.nickname?.trim() || sheet.species?.trim() || 'Pokémon reserve',
            portraitUrl: safePokemonPortrait(sheet),
            location: entry.location,
          }]
        })
      return [{
        trainerParticipantId: placement.id,
        sideId: placement.sideId ?? null,
        activeParticipantIds,
        reserves,
      }]
    })
    .sort((left, right) => left.trainerParticipantId.localeCompare(right.trainerParticipantId))
}

const initiativeOrder = (
  map: TabletopMap,
  visible: ReadonlySet<string>,
): string[] => {
  const placements = map.placements.filter(placement => visible.has(placement.id))
  const byId = new Map(placements.map(placement => [placement.id, placement]))
  const manual = (map.initiative?.manualOrderIds ?? []).filter(id => byId.has(id))
  const seen = new Set(manual)
  const remaining = placements.filter(placement => !seen.has(placement.id)).sort((left, right) => (
    (right.initiative ?? Number.NEGATIVE_INFINITY) - (left.initiative ?? Number.NEGATIVE_INFINITY)
    || left.id.localeCompare(right.id)
  )).map(placement => placement.id)
  return [...manual, ...remaining]
}

const turnEntries = (
  map: TabletopMap,
  order: readonly string[],
  pending: EncounterPresentationProjection['pending'],
): EncounterWorkspaceTurnEntry[] => {
  const currentId = map.initiative?.activeId ?? map.encounterState?.history.currentTurn?.placementId ?? null
  const currentIndex = currentId ? order.indexOf(currentId) : -1
  const initiativeById = new Map(map.placements.map(placement => [placement.id, placement.initiative ?? null]))
  const fainted = new Set(map.encounterState?.history.faintedPlacementIds ?? [])
  return order.map((participantId, index) => ({
    participantId,
    initiative: initiativeById.get(participantId) ?? null,
    state: fainted.has(participantId)
      ? 'fainted'
      : participantId === currentId
        ? 'current'
        : currentIndex >= 0 && index < currentIndex ? 'past' : 'upcoming',
    waitingDecisionCount: pending.filter(interaction => interaction.actor?.participantId === participantId
      && ['pending', 'resuming'].includes(interaction.status)).length,
  }))
}

const titleCaseId = (value: string): string => value
  .split(/[-_]/g)
  .filter(Boolean)
  .map(part => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
  .join(' ')

const environmentEntries = (map: TabletopMap): EncounterWorkspaceEnvironmentEntry[] => {
  const entries: EncounterWorkspaceEnvironmentEntry[] = []
  for (const [index, weather] of (map.fieldEffects?.weather ?? []).entries()) entries.push({
    environmentId: `legacy:weather:${index}:${weather.kind}`,
    kind: 'weather',
    label: titleCaseId(weather.kind),
    rounds: weather.rounds ?? null,
    scopeLabel: 'Battlefield',
  })
  for (const [index, terrain] of (map.fieldEffects?.terrains ?? []).entries()) entries.push({
    environmentId: `legacy:terrain:${index}:${terrain.kind}`,
    kind: 'terrain',
    label: titleCaseId(terrain.kind),
    rounds: terrain.rounds ?? null,
    scopeLabel: terrain.scope === 'area' ? 'Area' : 'Battlefield',
  })
  for (const [index, room] of (map.fieldEffects?.rooms ?? []).entries()) entries.push({
    environmentId: `legacy:room:${index}:${room.kind}`,
    kind: 'room',
    label: titleCaseId(room.kind),
    rounds: room.rounds ?? null,
    scopeLabel: room.startsNextRound ? 'Starts next round' : 'Battlefield',
  })
  for (const [index, hazard] of (map.hazards ?? []).entries()) entries.push({
    environmentId: `legacy:hazard:${index}:${hazard.kind}:${hazard.x}:${hazard.y}:${hazard.z}`,
    kind: 'hazard',
    label: titleCaseId(hazard.kind),
    rounds: null,
    scopeLabel: 'Cell',
  })
  for (const zone of map.encounterState?.zones ?? []) entries.push({
    environmentId: `zone:${zone.id}`,
    kind: ['weather', 'terrain', 'room', 'hazard'].includes(zone.kind)
      ? zone.kind as EncounterWorkspaceEnvironmentEntry['kind']
      : 'zone',
    label: titleCaseId(
      zone.kind === 'weather' ? zone.payload.weatherId
        : zone.kind === 'terrain' ? zone.payload.terrainId
          : zone.kind === 'room' ? zone.payload.roomId
            : zone.kind === 'hazard' ? zone.payload.hazardId
              : zone.kind,
    ),
    rounds: null,
    scopeLabel: titleCaseId(zone.geometry.kind),
  })
  return entries.sort((left, right) => left.kind.localeCompare(right.kind)
    || left.label.localeCompare(right.label)
    || left.environmentId.localeCompare(right.environmentId))
}

export const buildMapBackedEncounterWorkspace = (input: {
  readonly snapshot: LiveTableSnapshot
  readonly options: MapBackedEncounterWorkspaceAdapterOptions
  readonly encounterDocument?: EncounterDocument | null
}): EncounterWorkspaceViewModel => {
  const { snapshot, options } = input
  const encounterDocument = input.encounterDocument ?? null
  const castRoleByParticipant = new Map(encounterDocument?.castRoles.map(role => [role.participantId, role.role]) ?? [])
  if (snapshot.map.slug !== snapshot.encounterPresentation.mapSlug
    || snapshot.mapRevision !== snapshot.encounterPresentation.mapRevision
    || snapshot.mapRevision !== snapshot.map.revision) {
    throw new Error('Map-backed workspace input revisions do not match.')
  }
  const allPlacementIds = snapshot.map.placements.map(placement => placement.id)
  const visible = new Set(options.visibleParticipantIds ?? allPlacementIds)
  const controlled = new Set(options.controlledParticipantIds ?? [])
  const hidden = new Set(options.hiddenParticipantIds ?? [])
  const canUseDirector = options.audience === 'gm' || options.audience === 'diagnostic'
  const projection = snapshot.encounterPresentation
  const presented = presentationParticipants(projection)
  const pokemonBySlug = new Map(snapshot.pokemonSheets.map(sheet => [sheet.slug, sheet]))
  const trainerBySlug = new Map(snapshot.trainerSheets.map(sheet => [sheet.slug, sheet]))
  const sideIds = Object.keys(snapshot.map.encounterState?.sides ?? {}).sort((left, right) => left.localeCompare(right))
  const sideSymbols = new Map(sideIds.map((id, index) => [id, SIDE_SYMBOLS[index % SIDE_SYMBOLS.length]!]))
  const exactGeometry = options.canUseExactGeometry ?? options.audience !== 'public'
  const participants = snapshot.map.placements
    .filter(placement => visible.has(placement.id))
    .map(placement => participantForPlacement({
      placement,
      map: snapshot.map,
      pokemonBySlug,
      trainerBySlug,
      presentationById: presented,
      controlled,
      sideSymbols,
      exactGeometry,
      hidden,
      canUseDirector,
      castRole: castRoleByParticipant.get(placement.id) ?? null,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName)
      || left.participantId.localeCompare(right.participantId))
  const participantSet = new Set(participants.map(participant => participant.participantId))
  const sides: EncounterWorkspaceSide[] = sideIds.flatMap((sideId, index) => {
    const side = snapshot.map.encounterState?.sides[sideId]
    if (!side) return []
    const participantIds = snapshot.map.placements
      .filter(placement => placement.sideId === sideId && participantSet.has(placement.id))
      .map(placement => placement.id)
    return [{
      sideId,
      label: side.label,
      accent: side.color ?? null,
      symbol: SIDE_SYMBOLS[index % SIDE_SYMBOLS.length]!,
      status: side.status,
      participantIds,
      hiddenParticipantCount: options.audience === 'gm' || options.audience === 'diagnostic'
        ? Math.max(0, safeInteger(options.hiddenParticipantCountsBySide?.[sideId]))
        : null,
    }]
  })
  const teams = encounterTeams({
    map: snapshot.map,
    participants,
    pokemonBySlug,
    trainerBySlug,
    audience: options.audience,
  })
  const order = initiativeOrder(snapshot.map, participantSet)
  const currentParticipantId = snapshot.map.initiative?.activeId
    ?? snapshot.map.encounterState?.history.currentTurn?.placementId
    ?? null
  const connection = options.connection ?? 'ready'
  const replayGap = options.replayGap ?? false
  const commandsBlocked = connection !== 'ready' || replayGap
  const visibleObjectives = (encounterDocument?.objectives ?? []).filter(objective => (
    canUseDirector || objective.visibility === 'public'
  ))
  const visibleClocks = (encounterDocument?.clocks ?? []).filter(clock => (
    canUseDirector || clock.visibility === 'public'
  ))
  const visiblePhases = (encounterDocument?.phases ?? []).filter(phase => (
    canUseDirector || phase.visibility === 'public'
  ))
  const activePhase = visiblePhases.find(phase => phase.phaseId === encounterDocument?.activePhaseId) ?? null
  const workspace: EncounterWorkspaceViewModel = {
    schemaVersion: ENCOUNTER_WORKSPACE_SCHEMA_VERSION,
    source: {
      workspaceId: `workspace:${encounterDocument?.encounterId ?? snapshot.map.slug}:${snapshot.mapRevision}:${encounterDocument?.revision ?? 'map'}:${options.audience}`,
      encounterId: encounterDocument?.encounterId ?? snapshot.map.slug,
      encounterName: encounterDocument?.name ?? snapshot.map.name,
      encounterRevision: encounterDocument?.revision ?? null,
      mapSlug: snapshot.map.slug,
      mapRevision: snapshot.mapRevision,
      presentationProjectionId: encounterDocument
        ? `${projection.projectionId}:encounter:${encounterDocument.revision}`
        : projection.projectionId,
      presentationAudience: projection.audience,
      generatedAt: projection.generatedAt,
    },
    viewer: {
      audience: options.audience,
      controlledParticipantIds: [...controlled].filter(id => participantSet.has(id)).sort((a, b) => a.localeCompare(b)),
      canUseDirector,
      canInspectDiagnostics: options.audience === 'diagnostic',
      canUseExactGeometry: exactGeometry,
    },
    scene: {
      active: snapshot.map.activeScene !== null && snapshot.map.activeScene !== undefined,
      name: snapshot.map.activeScene?.name ?? null,
      startedAt: snapshot.map.activeScene?.startedAt ?? null,
    },
    turn: {
      round: Math.max(1, safeInteger(snapshot.map.initiative?.round, 1)),
      currentParticipantId: currentParticipantId && participantSet.has(currentParticipantId)
        ? currentParticipantId
        : null,
      entries: turnEntries(snapshot.map, order, projection.pending),
    },
    sides,
    participants,
    teams,
    environment: environmentEntries(snapshot.map),
    objectives: visibleObjectives.map(objective => ({
      objectiveId: objective.objectiveId,
      label: objective.label,
      status: objective.status,
      progress: objective.progress,
      maximum: objective.maximum,
    })),
    clocks: visibleClocks.map(clock => ({
      clockId: clock.clockId,
      label: clock.label,
      status: clock.status,
      progress: clock.progress,
      maximum: clock.maximum,
    })),
    phase: activePhase ? {
      phaseId: activePhase.phaseId,
      label: activePhase.label,
      status: activePhase.status,
      summary: activePhase.summary,
    } : null,
    stakes: canUseDirector
      ? encounterDocument?.stakes.gm ?? encounterDocument?.stakes.public ?? null
      : encounterDocument?.stakes.public ?? null,
    director: canUseDirector && encounterDocument ? {
      encounterRevision: encounterDocument.revision,
      name: encounterDocument.name,
      lifecycle: encounterDocument.lifecycle,
      recipe: encounterDocument.recipe,
      hiddenParticipantIds: encounterDocument.hiddenParticipantIds,
      castRoles: encounterDocument.castRoles,
      reserves: encounterDocument.reserves,
      waves: encounterDocument.waves,
      objectives: encounterDocument.objectives,
      clocks: encounterDocument.clocks,
      phases: encounterDocument.phases,
      activePhaseId: encounterDocument.activePhaseId,
      stakes: encounterDocument.stakes,
      notes: encounterDocument.notes,
    } : null,
    offers: projection.offers,
    passives: projection.passives,
    affordances: projection.affordances,
    pending: projection.pending,
    accepted: projection.accepted.slice(-512),
    diagnostics: projection.diagnostics,
    system: {
      connection,
      replayGap,
      commandsBlocked,
      blockingMessage: commandsBlocked
        ? options.blockingMessage ?? (replayGap ? 'Refreshing the authoritative encounter before commands resume.' : 'Encounter commands are temporarily paused.')
        : null,
      lastAdoptedRevision: snapshot.mapRevision,
    },
    mapBackedLimitations: encounterDocument ? [] : ['objectives', 'phases', 'stakes', 'notes', 'waves'],
  }
  return assertEncounterWorkspaceViewModel(workspace)
}
