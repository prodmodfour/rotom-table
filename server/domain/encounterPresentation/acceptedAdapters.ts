import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandEnvelope,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import { parseLivePlayMoveStatePatchPayload } from '#shared/livePlayMoveState'
import {
  ENCOUNTER_PRESENTATION_LIMITS,
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  parseAcceptedEncounterPresentation,
  type AcceptedEncounterPresentation,
  type EncounterChangeFact,
  type EncounterChangeKind,
  type EncounterDerivedFactValue,
  type EncounterParticipantPresentationRef,
  type EncounterPresentationTone,
  type EncounterVfxHint,
  type RuleSourceRef,
} from '#shared/encounterPresentation'
import type { AcceptedAbilityResolutionPublicResult } from '#shared/abilityAutomation/results'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const stableSegment = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

const boundedText = (
  value: unknown,
  fallback: string,
  maximum: number = ENCOUNTER_PRESENTATION_LIMITS.descriptionLength,
): string => {
  if (typeof value !== 'string') return fallback
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return normalized ? normalized.slice(0, maximum) : fallback
}

const source = (
  sourceKind: RuleSourceRef['sourceKind'],
  canonicalId: unknown,
  displayName: unknown,
  instanceId: unknown = null,
): RuleSourceRef => ({
  sourceKind,
  canonicalId: boundedText(canonicalId, 'system', ENCOUNTER_PRESENTATION_LIMITS.canonicalIdLength),
  instanceId: typeof instanceId === 'string' && instanceId.trim()
    ? boundedText(instanceId, 'instance', ENCOUNTER_PRESENTATION_LIMITS.identifierLength)
    : null,
  displayName: boundedText(displayName, 'System action', ENCOUNTER_PRESENTATION_LIMITS.labelLength),
  referenceHref: null,
})

const participant = (participantId: string, displayName: string = participantId): EncounterParticipantPresentationRef => ({
  participantId,
  displayName: boundedText(displayName, participantId, ENCOUNTER_PRESENTATION_LIMITS.labelLength),
  portraitUrl: null,
  sideId: null,
  sideLabel: null,
  sideAccent: null,
  sheetKind: null,
  statusLabels: [],
})

const commandPayload = (command: LivePlayCommandEnvelope): Record<string, unknown> => (
  isRecord(command.payload) ? command.payload : {}
)

const firstText = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

const commandActorId = (command: LivePlayCommandEnvelope): string | null => {
  const payload = commandPayload(command)
  const direct = firstText(payload, [
    'actorPlacementId', 'placementId', 'tokenId', 'sourcePlacementId', 'trainerPlacementId',
  ])
  if (direct) return direct
  const placement = payload.placement
  return isRecord(placement) && typeof placement.id === 'string' ? placement.id : null
}

interface ParsedMovePresentation {
  readonly actorPlacementId: string
  readonly moveName: string
  readonly moveType: string
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly cells: readonly { readonly x: number; readonly y: number; readonly z: number }[]
}

const parsedMovePresentation = (result: LivePlayCommandAccepted): ParsedMovePresentation | null => {
  for (const patch of result.patches) {
    if (patch.type !== LIVE_PLAY_PATCH_TYPES.MOVE_STATE) continue
    const parsed = parseLivePlayMoveStatePatchPayload(patch.payload)
    if (!parsed.valid) continue
    const presentation = parsed.payload.presentation
    return {
      actorPlacementId: presentation.actorPlacementId,
      moveName: presentation.move.name,
      moveType: presentation.move.type,
      attackedTargetIds: presentation.attackedTargetIds,
      hitTargetIds: presentation.hitTargetIds,
      cells: presentation.area?.cells ?? presentation.pass?.pathCells ?? [],
    }
  }
  return null
}

const commandSource = (
  command: LivePlayCommandEnvelope,
  result: LivePlayCommandAccepted,
): RuleSourceRef => {
  const payload = commandPayload(command)
  const move = parsedMovePresentation(result)
  if (move) return source('move', move.moveName, move.moveName)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_MOVE || command.type === LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE) {
    const name = firstText(payload, ['moveName', 'canonicalMoveId', 'canonicalId', 'name']) ?? 'Move'
    return source('move', name, name)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_ABILITY) {
    const name = firstText(payload, ['abilityName', 'canonicalId']) ?? 'Ability'
    return source('ability', name, name, firstText(payload, ['abilityInstanceId']))
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER) {
    const name = firstText(payload, ['maneuverId', 'maneuverName', 'name']) ?? 'Maneuver'
    return source('maneuver', name, name)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.USE_ORDER) {
    const name = firstText(payload, ['orderId', 'orderName', 'name']) ?? 'Order'
    return source('order', name, name)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL) {
    const name = firstText(payload, ['itemName', 'pokeballName', 'name']) ?? 'Poké Ball'
    return source('capture', name, name)
  }
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN) return source('movement', 'movement', 'Movement')
  if (command.type === LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY) {
    return source('maneuver', 'attack-of-opportunity', 'Attack of Opportunity')
  }
  if (([
    LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
    LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
    LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
  ] as readonly string[]).includes(command.type)) return source('initiative', command.type, command.type)
  if (([
    LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
    LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
    LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
    LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
  ] as readonly string[]).includes(command.type)) return source('hazard', command.type, command.type)
  if (([
    LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
    LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
    LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
    LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
  ] as readonly string[]).includes(command.type)) return source('field-effect', command.type, command.type)
  if (([
    LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
    LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
    LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
  ] as readonly string[]).includes(command.type)) return source('terrain', command.type, command.type)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.SET_SCENE) return source('scene', command.type, 'Set scene')
  if (command.type === LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE) return source('system', command.type, 'Grant experience')
  const labels: Readonly<Record<string, string>> = {
    [LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN]: 'Turn token',
    [LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN]: 'Spawn token',
    [LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN]: 'Delete token',
    [LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON]: 'Send out Pokémon',
    [LIVE_PLAY_COMMAND_TYPES.SET_SCENE]: 'Set scene',
    [LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE]: 'Next initiative',
    [LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE]: 'Previous initiative',
    correctMove: 'Correct move',
  }
  const label = labels[command.type] ?? command.type
  return source('system', command.type, label)
}

const patchParticipantId = (patch: LivePlayPatch): string | null => {
  for (const scope of patch.scopes) {
    if ('placementId' in scope && typeof scope.placementId === 'string') return scope.placementId
  }
  const payload = isRecord(patch.payload) ? patch.payload : {}
  return firstText(payload, ['placementId', 'actorPlacementId', 'targetPlacementId', 'tokenId'])
}

const safeJsonText = (value: unknown): string => {
  if (typeof value === 'string') return boundedText(value, 'updated')
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  try {
    return boundedText(JSON.stringify(value), 'updated')
  }
  catch {
    return 'updated'
  }
}

const factValue = (value: unknown): EncounterDerivedFactValue => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { kind: 'number', numberValue: value, textValue: null, booleanValue: null, unit: null }
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', numberValue: null, textValue: null, booleanValue: value, unit: null }
  }
  return {
    kind: 'text',
    numberValue: null,
    textValue: safeJsonText(value).slice(0, ENCOUNTER_PRESENTATION_LIMITS.descriptionLength),
    booleanValue: null,
    unit: null,
  }
}

const changeKind = (patchType: string): EncounterChangeKind => {
  if (/temporary.*hp/i.test(patchType)) return 'temporary-hp'
  if (/injur/i.test(patchType)) return 'injury'
  if (/hp/i.test(patchType)) return 'hp'
  if (/condition/i.test(patchType)) return 'condition'
  if (/combat-stage|stage/i.test(patchType)) return 'stage'
  if (/position|facing|terrain-voxel/i.test(patchType)) return 'movement'
  if (/item|inventory|equipment|money/i.test(patchType)) return 'item'
  if (/hazard/i.test(patchType)) return 'zone'
  if (/field|terrain/i.test(patchType)) return 'effect'
  if (/usage|frequency/i.test(patchType)) return 'usage'
  if (/resource/i.test(patchType)) return 'resource'
  if (/initiative|turn|round|encounter|scene/i.test(patchType)) return 'scene'
  if (/spawn|delete|placement/i.test(patchType)) return 'placement'
  return 'effect'
}

const changesFor = (result: LivePlayCommandAccepted): readonly EncounterChangeFact[] => result.patches
  .slice(0, 512)
  .map((patch, index): EncounterChangeFact => {
    const payload = isRecord(patch.payload) ? patch.payload : {}
    const hasPrevious = Object.prototype.hasOwnProperty.call(payload, 'previous')
    const hasCurrent = Object.prototype.hasOwnProperty.call(payload, 'current')
    const previous = hasPrevious ? payload.previous : null
    const current = hasCurrent ? payload.current : null
    const operation = hasPrevious && previous !== null && hasCurrent && current === null
      ? 'delete' as const
      : hasPrevious && previous === null && hasCurrent && current !== null
        ? 'create' as const
        : 'set' as const
    const afterFallback = firstText(payload, ['status', 'command', 'placementId']) ?? patch.type
    const beforeFact = operation === 'create' || !hasPrevious ? null : factValue(previous)
    const afterFact = operation === 'delete' ? null : factValue(hasCurrent ? current : afterFallback)
    const previousNumber = typeof previous === 'number' ? previous : null
    const currentNumber = typeof current === 'number' ? current : null
    const participantId = patchParticipantId(patch)
    return {
      changeId: `change:${result.opId}:${index}`,
      kind: changeKind(patch.type),
      operation,
      participantId,
      subjectId: participantId ?? `map:${result.mapSlug}`,
      field: stableSegment(patch.type, 'state'),
      before: beforeFact,
      after: afterFact,
      delta: previousNumber !== null && currentNumber !== null ? currentNumber - previousNumber : null,
      label: `${patch.type} updated`,
    }
  })

const vfxFor = (
  operationId: string,
  command: LivePlayCommandEnvelope,
  actorId: string | null,
  targetIds: readonly string[],
  move: ParsedMovePresentation | null,
  tone: EncounterPresentationTone,
): readonly EncounterVfxHint[] => {
  const kind = command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
    ? 'movement'
    : command.type === LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL
      ? 'projectile'
      : move?.cells.length
        ? 'area'
        : move
          ? 'impact'
          : 'status'
  return [{
    vfxId: `vfx:${operationId}:0`,
    kind,
    sourceParticipantId: actorId,
    targetParticipantIds: [...targetIds],
    cells: move?.cells.slice(0, 512).map(cell => ({ ...cell })) ?? [],
    tone,
    duration: kind === 'area' ? 'normal' : 'short',
    reducedMotionKind: kind === 'movement' ? 'shorten' : 'static',
    label: kind === 'movement' ? 'Movement' : 'Resolved action',
  }]
}

const buildAccepted = (input: {
  readonly operationId: string
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly source: RuleSourceRef
  readonly actorId: string | null
  readonly targetIds: readonly string[]
  readonly hitTargetIds?: readonly string[]
  readonly outcome?: 'applied' | 'prevented' | 'no-op'
  readonly changes: readonly EncounterChangeFact[]
  readonly command?: LivePlayCommandEnvelope
  readonly move?: ParsedMovePresentation | null
  readonly occurredAt: number
  readonly correctionOriginId?: string | null
}): AcceptedEncounterPresentation => {
  const uniqueTargetIds = [...new Set(input.targetIds.filter(id => id !== input.actorId))].slice(0, 128)
  const actor = input.actorId ? participant(input.actorId) : null
  const affectedParticipants = uniqueTargetIds.map(id => participant(id))
  const hitTargetIds = new Set(input.hitTargetIds ?? uniqueTargetIds)
  const outcomeTone: EncounterPresentationTone = input.outcome === 'prevented' ? 'warning'
    : input.outcome === 'no-op' ? 'neutral' : 'positive'
  const outcomes = uniqueTargetIds.length > 0
    ? uniqueTargetIds.map((targetId, index) => {
        const hit = hitTargetIds.has(targetId)
        return {
          outcomeId: `outcome:${input.operationId}:${index}`,
          kind: input.outcome === 'prevented' ? 'prevented' as const : hit ? 'hit' as const : 'miss' as const,
          participantId: targetId,
          label: input.outcome === 'prevented' ? 'Prevented' : hit ? 'Hit' : 'Miss',
          tone: input.outcome === 'prevented' ? 'warning' as const : hit ? 'positive' as const : 'neutral' as const,
          preventedBy: input.outcome === 'prevented' ? [input.source] : [],
        }
      })
    : [{
        outcomeId: `outcome:${input.operationId}:0`,
        kind: input.outcome === 'prevented' ? 'prevented' as const
          : input.outcome === 'no-op' ? 'no-op' as const : 'accepted' as const,
        participantId: input.actorId,
        label: input.outcome === 'prevented' ? 'Prevented'
          : input.outcome === 'no-op' ? 'No change' : 'Accepted',
        tone: outcomeTone,
        preventedBy: input.outcome === 'prevented' ? [input.source] : [],
      }]
  const headline = input.outcome === 'prevented'
    ? `${input.source.displayName} was prevented`
    : input.outcome === 'no-op'
      ? `${input.source.displayName} caused no change`
      : `${input.source.displayName} resolved`
  const participantIds = [input.actorId, ...uniqueTargetIds].filter((id): id is string => id !== null)
  const presentationId = `accepted:${input.operationId}`
  const command = input.command
  const vfx = command
    ? vfxFor(input.operationId, command, input.actorId, uniqueTargetIds, input.move ?? null, outcomeTone)
    : [{
        vfxId: `vfx:${input.operationId}:0`,
        kind: 'status' as const,
        sourceParticipantId: input.actorId,
        targetParticipantIds: uniqueTargetIds,
        cells: [],
        tone: outcomeTone,
        duration: 'short' as const,
        reducedMotionKind: 'static' as const,
        label: input.source.displayName,
      }]
  return parseAcceptedEncounterPresentation({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    presentationId,
    operationId: input.operationId,
    mapSlug: input.mapSlug,
    previousRevision: input.previousRevision,
    revision: input.revision,
    source: input.source,
    actor,
    affectedParticipants,
    outcomes,
    changes: input.changes,
    explanations: [],
    causal: {
      groupId: `causal:${input.operationId}`,
      parentPresentationId: null,
      depth: 0,
      sequence: 0,
    },
    headline: { label: headline, description: null, iconKey: null, tone: outcomeTone },
    splash: { label: input.source.displayName, description: null, iconKey: null, tone: outcomeTone },
    vfx,
    announcements: [{
      announcementId: `announcement:${input.operationId}:0`,
      priority: input.outcome === 'prevented' ? 'assertive' : 'polite',
      message: headline,
      dedupeKey: `accepted:${input.operationId}`,
    }],
    history: [{
      entryId: `history:${input.operationId}:0`,
      occurredAt: input.occurredAt,
      headline,
      detail: null,
      tone: outcomeTone,
      participantIds,
    }],
    correction: input.correctionOriginId ? {
      correctionId: `correction:${input.operationId}`,
      correctsPresentationId: `accepted:${input.correctionOriginId}`,
      reasonLabel: 'The GM corrected this accepted action.',
      rollbackChangeIds: input.changes.map(change => change.changeId),
    } : null,
  })
}

export const acceptedEncounterPresentationFromLivePlayCommand = (input: {
  readonly command: LivePlayCommandEnvelope
  readonly result: LivePlayCommandAccepted
  readonly occurredAt?: number
}): AcceptedEncounterPresentation => {
  const move = parsedMovePresentation(input.result)
  const actorId = move?.actorPlacementId ?? commandActorId(input.command)
  const patchTargets = input.result.patches.flatMap(patch => {
    const id = patchParticipantId(patch)
    return id ? [id] : []
  })
  const payload = commandPayload(input.command)
  const payloadTargets = [
    ...(['targetPlacementId', 'recipientPlacementId'] as const).flatMap(key => (
      typeof payload[key] === 'string' ? [payload[key] as string] : []
    )),
    ...(Array.isArray(payload.targetPlacementIds)
      ? payload.targetPlacementIds.filter((id): id is string => typeof id === 'string')
      : []),
  ]
  const correctionOriginId = String(input.command.type) === 'correctMove'
    ? firstText(payload, ['originOperationId', 'correctsOperationId'])
    : null
  return buildAccepted({
    operationId: input.result.opId,
    mapSlug: input.result.mapSlug,
    previousRevision: input.result.previousRevision,
    revision: input.result.revision,
    source: commandSource(input.command, input.result),
    actorId,
    targetIds: move?.attackedTargetIds ?? [...patchTargets, ...payloadTargets],
    ...(move ? { hitTargetIds: move.hitTargetIds } : {}),
    changes: changesFor(input.result),
    command: input.command,
    move,
    occurredAt: input.occurredAt ?? input.result.revision,
    correctionOriginId,
  })
}

export const withAcceptedEncounterPresentation = (input: {
  readonly command: LivePlayCommandEnvelope
  readonly result: LivePlayCommandAccepted
  readonly occurredAt?: number
}): LivePlayCommandAccepted => input.result.presentation
  ? input.result
  : {
      ...input.result,
      presentation: acceptedEncounterPresentationFromLivePlayCommand(input),
    }

export const acceptedEncounterPresentationFromAbility = (input: {
  readonly result: AcceptedAbilityResolutionPublicResult
  readonly canonicalId: string
  readonly abilityInstanceId: string
  readonly actorPlacementId: string
  readonly targetPlacementIds: readonly string[]
  readonly occurredAt: number
}): AcceptedEncounterPresentation => buildAccepted({
  operationId: input.result.operationId,
  mapSlug: input.result.mapSlug,
  previousRevision: input.result.previousRevision,
  revision: input.result.revision,
  // Ability accepted realtime is map-public. Keep provenance without exposing a
  // hidden Ability or instance identity to non-owners.
  source: source('ability', 'private-ability', 'Ability'),
  actorId: input.actorPlacementId,
  targetIds: input.targetPlacementIds,
  outcome: input.result.presentation.outcome,
  changes: [],
  occurredAt: input.occurredAt,
})
