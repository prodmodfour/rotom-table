import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  createOpId as defaultCreateOpId,
  type OpId,
  type SessionCommandEnvelope,
  type SessionCommandScope,
} from '#shared/sessionCommands'
import type { SessionClientIdentity } from '#shared/sessionClientIdentity'
import type { SessionActor, SessionSheetResourceRef, SessionTokenResourceRef } from '#shared/sessionPermissions'
import { INITIAL_SESSION_REVISION, type SessionRevision } from '#shared/sessionRevisions'
import {
  DELETE_TOKEN_COMMAND_TYPE,
  SEND_OUT_POKEMON_COMMAND_TYPE,
  createDeleteTokenCommandScope,
  createSendOutPokemonSpawnCommandScope,
  createSendOutPokemonTrainerCommandScope,
  type DeleteTokenCommand,
  type MoveTokenPosition,
  type SendOutPokemonCommand,
} from '#shared/sessionTokenCommands'
import {
  MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  MODIFY_CONDITIONS_COMMAND_TYPE,
  MODIFY_HP_COMMAND_TYPE,
  USE_ABILITY_COMMAND_TYPE,
  USE_MANEUVER_COMMAND_TYPE,
  USE_MOVE_COMMAND_TYPE,
  USE_ORDER_COMMAND_TYPE,
  createModifyCombatStagesSheetCommandScope,
  createModifyCombatStagesTokenCommandScope,
  createModifyConditionsSheetCommandScope,
  createModifyConditionsTokenCommandScope,
  createModifyHpSheetCommandScope,
  createModifyHpTokenCommandScope,
  createUseAbilitySheetCommandScope,
  createUseAbilityTokenCommandScope,
  createUseManeuverSheetCommandScope,
  createUseManeuverTokenCommandScope,
  createUseMoveSheetCommandScope,
  createUseMoveTokenCommandScope,
  createUseOrderSheetCommandScope,
  createUseOrderTokenCommandScope,
  type ModifyCombatStagesCommand,
  type ModifyConditionsCommand,
  type ModifyHpCommand,
  type UseAbilityCommand,
  type UseManeuverCommand,
  type UseMoveCommand,
  type UseOrderCommand,
} from '#shared/sessionTableActionCommands'
import {
  NEXT_INITIATIVE_COMMAND_TYPE,
  PREVIOUS_INITIATIVE_COMMAND_TYPE,
  createInitiativeCommandScope,
  type NextInitiativeCommand,
  type PreviousInitiativeCommand,
} from '#shared/sessionInitiativeCommands'
import {
  PLACE_HAZARD_COMMAND_TYPE,
  REMOVE_HAZARD_COMMAND_TYPE,
  createHazardCommandScope,
  type PlaceHazardCommand,
  type RemoveHazardCommand,
} from '#shared/sessionHazardCommands'
import {
  SET_FIELD_EFFECT_COMMAND_TYPE,
  createFieldEffectCommandScope,
  type SetFieldEffectCommand,
} from '#shared/sessionFieldEffectCommands'
import {
  BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
  REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
  createTerrainVoxelCommandScope,
  type BuildTerrainVoxelCommand,
  type RemoveTerrainVoxelCommand,
} from '#shared/sessionTerrainCommands'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  GridAnchor,
  MapHazardV2,
  MapVoxelV2,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type { MoveAutomationFieldEffectApply, MoveAutomationHpUpdate } from '~/types/moveAutomation'
import { createPlacementId as defaultCreatePlacementId } from '~/utils/placement'
import { DEFAULT_TOKEN_FACING_DIRECTION } from '~/utils/tokenFacing'
import { sessionActorFromClientIdentity } from '~/composables/map-editor/useSessionMoveTokenDispatch'
import type { SessionMapCommandDispatchResult } from '~/composables/map-editor/useSessionMap'

interface BooleanRef {
  readonly value: boolean
}

type MaybeRef<TValue> = TValue | Ref<TValue>

type SessionMapSceneCommand =
  | DeleteTokenCommand
  | SendOutPokemonCommand
  | ModifyHpCommand
  | ModifyCombatStagesCommand
  | ModifyConditionsCommand
  | UseMoveCommand
  | UseManeuverCommand
  | UseAbilityCommand
  | UseOrderCommand
  | NextInitiativeCommand
  | PreviousInitiativeCommand
  | PlaceHazardCommand
  | RemoveHazardCommand
  | SetFieldEffectCommand
  | BuildTerrainVoxelCommand
  | RemoveTerrainVoxelCommand

export type SessionMapSceneCommandDispatchFailureReason =
  | 'not-session-mode'
  | 'missing-session-identity'
  | 'missing-map'
  | 'missing-placement'
  | 'missing-action-name'
  | 'send-failed'

export type SessionMapSceneCommandDispatchResult<TCommand extends SessionMapSceneCommand = SessionMapSceneCommand> =
  | {
      readonly dispatched: true
      readonly command: TCommand
      readonly result: Extract<SessionMapCommandDispatchResult<TCommand>, { readonly dispatched: true }>
    }
  | {
      readonly dispatched: false
      readonly reason: SessionMapSceneCommandDispatchFailureReason
      readonly message: string
    }

export interface SessionMapSceneCommandDispatcherLike {
  readonly identity: Ref<SessionClientIdentity | null>
  readonly socket: {
    readonly lastKnownRevision: Ref<SessionRevision | null>
  }
  dispatchCommand<TCommand extends SessionCommandEnvelope>(command: TCommand): SessionMapCommandDispatchResult<TCommand>
}

export interface UseSessionMapSceneCommandsOptions {
  readonly enabled: BooleanRef
  readonly map: Ref<TabletopMap | null>
  readonly mapSlug: MaybeRef<string>
  readonly session: SessionMapSceneCommandDispatcherLike
  readonly createOpId?: () => OpId
  readonly createPlacementId?: () => string
  readonly now?: () => string
}

export interface UseSessionMapSceneCommandsReturn {
  readonly enabled: ComputedRef<boolean>
  readonly lastError: Ref<string | null>
  dispatchDeletePokemon(tokenId: string): SessionMapSceneCommandDispatchResult<DeleteTokenCommand>
  dispatchSendOutPokemon(input: { trainerId: string; pokemonSlug: string; position: GridAnchor }): SessionMapSceneCommandDispatchResult<SendOutPokemonCommand>
  dispatchModifyHp(payload: MoveAutomationHpUpdate): SessionMapSceneCommandDispatchResult<ModifyHpCommand>
  dispatchModifyCombatStages(payload: { id: string; stages: CombatStageMap }): SessionMapSceneCommandDispatchResult<ModifyCombatStagesCommand>
  dispatchModifyConditions(payload: { id: string; conditions: string[] }): SessionMapSceneCommandDispatchResult<ModifyConditionsCommand>
  dispatchUseMove(payload: { id: string; moveName?: string | null }): SessionMapSceneCommandDispatchResult<UseMoveCommand>
  dispatchUseManeuver(payload: { id: string; maneuverName?: string | null; targetTokenId?: string }): SessionMapSceneCommandDispatchResult<UseManeuverCommand>
  dispatchUseAbility(payload: { id: string; abilityName?: string | null; targetTokenId?: string }): SessionMapSceneCommandDispatchResult<UseAbilityCommand>
  dispatchUseOrder(payload: { id: string; orderName?: string | null; targetTokenId?: string }): SessionMapSceneCommandDispatchResult<UseOrderCommand>
  dispatchNextInitiative(): SessionMapSceneCommandDispatchResult<NextInitiativeCommand>
  dispatchPreviousInitiative(): SessionMapSceneCommandDispatchResult<PreviousInitiativeCommand>
  dispatchPlaceHazard(hazard: MapHazardV2): SessionMapSceneCommandDispatchResult<PlaceHazardCommand>
  dispatchRemoveHazard(cell: { x: number; y: number; z: number; kind?: MapHazardV2['kind'] }): SessionMapSceneCommandDispatchResult<RemoveHazardCommand>
  dispatchApplyFieldEffect(effect: MoveAutomationFieldEffectApply): SessionMapSceneCommandDispatchResult<SetFieldEffectCommand>
  dispatchPlaceVoxel(voxel: MapVoxelV2): SessionMapSceneCommandDispatchResult<BuildTerrainVoxelCommand>
  dispatchRemoveVoxel(cell: { x: number; y: number; z: number }): SessionMapSceneCommandDispatchResult<RemoveTerrainVoxelCommand>
}

const readMaybeRef = <TValue>(value: MaybeRef<TValue>): TValue => {
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return (value as Ref<TValue>).value
  }
  return value as TValue
}

const defaultClock = (): string => new Date().toISOString()

const clonePosition = (position: GridAnchor | MoveTokenPosition): MoveTokenPosition => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const tokenResourceForPlacement = (
  placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>,
  mapSlug: string,
): SessionTokenResourceRef => ({
  kind: 'token',
  tokenId: placement.id,
  mapSlug,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
})

const sheetResourceForPlacement = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): SessionSheetResourceRef => ({
  kind: 'sheet',
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
})

export const useSessionMapSceneCommands = (
  options: UseSessionMapSceneCommandsOptions,
): UseSessionMapSceneCommandsReturn => {
  const enabled = computed(() => options.enabled.value)
  const lastError = ref<string | null>(null)
  const createOpId = options.createOpId ?? defaultCreateOpId
  const createPlacementId = options.createPlacementId ?? defaultCreatePlacementId
  const now = options.now ?? defaultClock

  const fail = <TCommand extends SessionMapSceneCommand>(
    reason: SessionMapSceneCommandDispatchFailureReason,
    message: string,
  ): Extract<SessionMapSceneCommandDispatchResult<TCommand>, { readonly dispatched: false }> => {
    lastError.value = message
    return { dispatched: false, reason, message }
  }

  const currentMapSlug = (): string => readMaybeRef(options.mapSlug)

  const placementById = (tokenId: string): SheetPlacement | null =>
    options.map.value?.placements.find((placement) => placement.id === tokenId) ?? null

  const currentActor = (): { readonly identity: SessionClientIdentity; readonly actor: SessionActor; readonly baseRevision: SessionRevision } | null => {
    if (!enabled.value) return null
    const identity = options.session.identity.value
    if (identity === null) return null
    return {
      identity,
      actor: sessionActorFromClientIdentity(identity),
      baseRevision: options.session.socket.lastKnownRevision.value
        ?? identity.lastSeenRevision
        ?? INITIAL_SESSION_REVISION,
    }
  }

  const commandMetadata = (source: string): SessionCommandEnvelope['metadata'] => ({
    clientIssuedAt: now(),
    attributes: {
      source,
      mapSlug: currentMapSlug(),
    },
  })

  const dispatch = <TCommand extends SessionMapSceneCommand>(
    command: TCommand,
  ): SessionMapSceneCommandDispatchResult<TCommand> => {
    const result = options.session.dispatchCommand(command)
    if (!result.dispatched) return fail<TCommand>('send-failed', result.message)
    lastError.value = null
    return { dispatched: true, command, result }
  }

  const buildCommand = <
    TType extends SessionMapSceneCommand['type'],
    TPayload,
  >(
    type: TType,
    payload: TPayload,
    scopes: readonly SessionCommandScope[],
    source: string,
  ): (SessionCommandEnvelope<TType, TPayload, SessionActor, SessionRevision> & { readonly type: TType }) | null => {
    if (!enabled.value) return null
    const actorContext = currentActor()
    if (actorContext === null) return null
    return {
      schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
      type,
      sessionId: actorContext.identity.sessionId,
      actor: actorContext.actor,
      opId: createOpId(),
      baseRevision: actorContext.baseRevision,
      scopes,
      payload,
      metadata: commandMetadata(source),
    }
  }

  const requireActor = <TCommand extends SessionMapSceneCommand>(): true | Extract<SessionMapSceneCommandDispatchResult<TCommand>, { readonly dispatched: false }> => {
    if (!enabled.value) return fail<TCommand>('not-session-mode', 'Session command dispatch is not enabled for this map view.')
    if (options.session.identity.value === null) {
      return fail<TCommand>('missing-session-identity', 'No remembered live session identity was found; open the session lobby and start or join a session first.')
    }
    return true
  }

  const requireMap = <TCommand extends SessionMapSceneCommand>(): TabletopMap | Extract<SessionMapSceneCommandDispatchResult<TCommand>, { readonly dispatched: false }> => {
    const actor = requireActor<TCommand>()
    if (actor !== true) return actor
    if (!options.map.value) return fail<TCommand>('missing-map', 'Cannot dispatch a session command before the map is loaded.')
    return options.map.value
  }

  const requirePlacement = <TCommand extends SessionMapSceneCommand>(
    tokenId: string,
  ): SheetPlacement | Extract<SessionMapSceneCommandDispatchResult<TCommand>, { readonly dispatched: false }> => {
    const map = requireMap<TCommand>()
    if ('dispatched' in map) return map
    const placement = placementById(tokenId)
    if (!placement) return fail<TCommand>('missing-placement', 'Cannot dispatch a session command because the token is no longer on the map.')
    return placement
  }

  const tokenAndSheetScopes = (
    placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>,
    tokenScopeFactory: (resource: SessionTokenResourceRef) => SessionCommandScope,
    sheetScopeFactory: (resource: SessionSheetResourceRef) => SessionCommandScope,
  ): readonly SessionCommandScope[] => {
    const tokenResource = tokenResourceForPlacement(placement, currentMapSlug())
    const sheetResource = sheetResourceForPlacement(placement)
    return [tokenScopeFactory(tokenResource), sheetScopeFactory(sheetResource)]
  }

  const dispatchDeletePokemon = (tokenId: string): SessionMapSceneCommandDispatchResult<DeleteTokenCommand> => {
    const placement = requirePlacement<DeleteTokenCommand>(tokenId)
    if ('dispatched' in placement) return placement
    const resource = tokenResourceForPlacement(placement, currentMapSlug())
    const command = buildCommand(
      DELETE_TOKEN_COMMAND_TYPE,
      { tokenId },
      [createDeleteTokenCommandScope(resource)],
      'map-scene-token-delete',
    ) as DeleteTokenCommand | null
    if (command === null) return requireActor<DeleteTokenCommand>() as Extract<SessionMapSceneCommandDispatchResult<DeleteTokenCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchSendOutPokemon = (
    input: { trainerId: string; pokemonSlug: string; position: GridAnchor },
  ): SessionMapSceneCommandDispatchResult<SendOutPokemonCommand> => {
    const trainerPlacement = requirePlacement<SendOutPokemonCommand>(input.trainerId)
    if ('dispatched' in trainerPlacement) return trainerPlacement
    const mapSlug = currentMapSlug()
    const tokenId = createPlacementId()
    const trainerResource = tokenResourceForPlacement(trainerPlacement, mapSlug)
    const spawnResource: SessionTokenResourceRef = {
      kind: 'token',
      tokenId,
      mapSlug,
      sheetKind: 'pokemon',
      sheetSlug: input.pokemonSlug,
    }
    const command = buildCommand(
      SEND_OUT_POKEMON_COMMAND_TYPE,
      {
        trainerTokenId: input.trainerId,
        pokemonSlug: input.pokemonSlug,
        tokenId,
        position: clonePosition(input.position),
        facing: DEFAULT_TOKEN_FACING_DIRECTION,
      },
      [
        createSendOutPokemonTrainerCommandScope(trainerResource),
        createSendOutPokemonSpawnCommandScope(spawnResource),
      ],
      'map-scene-send-out-pokemon',
    ) as SendOutPokemonCommand | null
    if (command === null) return requireActor<SendOutPokemonCommand>() as Extract<SessionMapSceneCommandDispatchResult<SendOutPokemonCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchModifyHp = (payload: MoveAutomationHpUpdate): SessionMapSceneCommandDispatchResult<ModifyHpCommand> => {
    const placement = requirePlacement<ModifyHpCommand>(payload.id)
    if ('dispatched' in placement) return placement
    const command = buildCommand(
      MODIFY_HP_COMMAND_TYPE,
      {
        tokenId: payload.id,
        currentHp: payload.currentHp,
        ...(payload.injuries === undefined ? {} : { injuries: payload.injuries }),
      },
      tokenAndSheetScopes(placement, createModifyHpTokenCommandScope, createModifyHpSheetCommandScope),
      'map-scene-modify-hp',
    ) as ModifyHpCommand | null
    if (command === null) return requireActor<ModifyHpCommand>() as Extract<SessionMapSceneCommandDispatchResult<ModifyHpCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchModifyCombatStages = (
    payload: { id: string; stages: CombatStageMap },
  ): SessionMapSceneCommandDispatchResult<ModifyCombatStagesCommand> => {
    const placement = requirePlacement<ModifyCombatStagesCommand>(payload.id)
    if ('dispatched' in placement) return placement
    const command = buildCommand(
      MODIFY_COMBAT_STAGES_COMMAND_TYPE,
      { tokenId: payload.id, stages: { ...payload.stages } },
      tokenAndSheetScopes(
        placement,
        createModifyCombatStagesTokenCommandScope,
        createModifyCombatStagesSheetCommandScope,
      ),
      'map-scene-modify-combat-stages',
    ) as ModifyCombatStagesCommand | null
    if (command === null) return requireActor<ModifyCombatStagesCommand>() as Extract<SessionMapSceneCommandDispatchResult<ModifyCombatStagesCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchModifyConditions = (
    payload: { id: string; conditions: string[] },
  ): SessionMapSceneCommandDispatchResult<ModifyConditionsCommand> => {
    const placement = requirePlacement<ModifyConditionsCommand>(payload.id)
    if ('dispatched' in placement) return placement
    const command = buildCommand(
      MODIFY_CONDITIONS_COMMAND_TYPE,
      { tokenId: payload.id, action: 'replace' as const, conditions: [...payload.conditions] },
      tokenAndSheetScopes(
        placement,
        createModifyConditionsTokenCommandScope,
        createModifyConditionsSheetCommandScope,
      ),
      'map-scene-modify-conditions',
    ) as ModifyConditionsCommand | null
    if (command === null) return requireActor<ModifyConditionsCommand>() as Extract<SessionMapSceneCommandDispatchResult<ModifyConditionsCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const actionName = <TCommand extends SessionMapSceneCommand>(
    value: string | null | undefined,
    label: string,
  ): string | Extract<SessionMapSceneCommandDispatchResult<TCommand>, { readonly dispatched: false }> => {
    const trimmed = value?.trim()
    if (!trimmed) return fail<TCommand>('missing-action-name', `Cannot dispatch ${label} without an action name.`)
    return trimmed
  }

  const dispatchUseMove = (payload: { id: string; moveName?: string | null }): SessionMapSceneCommandDispatchResult<UseMoveCommand> => {
    const moveName = actionName<UseMoveCommand>(payload.moveName, 'useMove')
    if (typeof moveName !== 'string') return moveName
    const placement = requirePlacement<UseMoveCommand>(payload.id)
    if ('dispatched' in placement) return placement
    const command = buildCommand(
      USE_MOVE_COMMAND_TYPE,
      { tokenId: payload.id, moveName },
      tokenAndSheetScopes(placement, createUseMoveTokenCommandScope, createUseMoveSheetCommandScope),
      'map-scene-use-move',
    ) as UseMoveCommand | null
    if (command === null) return requireActor<UseMoveCommand>() as Extract<SessionMapSceneCommandDispatchResult<UseMoveCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchUseManeuver = (
    payload: { id: string; maneuverName?: string | null; targetTokenId?: string },
  ): SessionMapSceneCommandDispatchResult<UseManeuverCommand> => {
    const maneuverName = actionName<UseManeuverCommand>(payload.maneuverName, 'useManeuver')
    if (typeof maneuverName !== 'string') return maneuverName
    const placement = requirePlacement<UseManeuverCommand>(payload.id)
    if ('dispatched' in placement) return placement
    const command = buildCommand(
      USE_MANEUVER_COMMAND_TYPE,
      {
        tokenId: payload.id,
        maneuverName,
        ...(payload.targetTokenId === undefined ? {} : { targetTokenId: payload.targetTokenId }),
      },
      tokenAndSheetScopes(placement, createUseManeuverTokenCommandScope, createUseManeuverSheetCommandScope),
      'map-scene-use-maneuver',
    ) as UseManeuverCommand | null
    if (command === null) return requireActor<UseManeuverCommand>() as Extract<SessionMapSceneCommandDispatchResult<UseManeuverCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchUseAbility = (
    payload: { id: string; abilityName?: string | null; targetTokenId?: string },
  ): SessionMapSceneCommandDispatchResult<UseAbilityCommand> => {
    const abilityName = actionName<UseAbilityCommand>(payload.abilityName, 'useAbility')
    if (typeof abilityName !== 'string') return abilityName
    const placement = requirePlacement<UseAbilityCommand>(payload.id)
    if ('dispatched' in placement) return placement
    const command = buildCommand(
      USE_ABILITY_COMMAND_TYPE,
      {
        tokenId: payload.id,
        abilityName,
        ...(payload.targetTokenId === undefined ? {} : { targetTokenId: payload.targetTokenId }),
      },
      tokenAndSheetScopes(placement, createUseAbilityTokenCommandScope, createUseAbilitySheetCommandScope),
      'map-scene-use-ability',
    ) as UseAbilityCommand | null
    if (command === null) return requireActor<UseAbilityCommand>() as Extract<SessionMapSceneCommandDispatchResult<UseAbilityCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchUseOrder = (
    payload: { id: string; orderName?: string | null; targetTokenId?: string },
  ): SessionMapSceneCommandDispatchResult<UseOrderCommand> => {
    const orderName = actionName<UseOrderCommand>(payload.orderName, 'useOrder')
    if (typeof orderName !== 'string') return orderName
    const placement = requirePlacement<UseOrderCommand>(payload.id)
    if ('dispatched' in placement) return placement
    const command = buildCommand(
      USE_ORDER_COMMAND_TYPE,
      {
        tokenId: payload.id,
        orderName,
        ...(payload.targetTokenId === undefined ? {} : { targetTokenId: payload.targetTokenId }),
      },
      tokenAndSheetScopes(placement, createUseOrderTokenCommandScope, createUseOrderSheetCommandScope),
      'map-scene-use-order',
    ) as UseOrderCommand | null
    if (command === null) return requireActor<UseOrderCommand>() as Extract<SessionMapSceneCommandDispatchResult<UseOrderCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchNextInitiative = (): SessionMapSceneCommandDispatchResult<NextInitiativeCommand> => {
    const actor = requireActor<NextInitiativeCommand>()
    if (actor !== true) return actor
    const command = buildCommand(
      NEXT_INITIATIVE_COMMAND_TYPE,
      { mapSlug: currentMapSlug() },
      [createInitiativeCommandScope(currentMapSlug())],
      'map-scene-next-initiative',
    ) as NextInitiativeCommand | null
    if (command === null) return requireActor<NextInitiativeCommand>() as Extract<SessionMapSceneCommandDispatchResult<NextInitiativeCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchPreviousInitiative = (): SessionMapSceneCommandDispatchResult<PreviousInitiativeCommand> => {
    const actor = requireActor<PreviousInitiativeCommand>()
    if (actor !== true) return actor
    const command = buildCommand(
      PREVIOUS_INITIATIVE_COMMAND_TYPE,
      { mapSlug: currentMapSlug() },
      [createInitiativeCommandScope(currentMapSlug())],
      'map-scene-previous-initiative',
    ) as PreviousInitiativeCommand | null
    if (command === null) return requireActor<PreviousInitiativeCommand>() as Extract<SessionMapSceneCommandDispatchResult<PreviousInitiativeCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchPlaceHazard = (hazard: MapHazardV2): SessionMapSceneCommandDispatchResult<PlaceHazardCommand> => {
    const map = requireMap<PlaceHazardCommand>()
    if ('dispatched' in map) return map
    const command = buildCommand(
      PLACE_HAZARD_COMMAND_TYPE,
      {
        mapSlug: currentMapSlug(),
        hazard: {
          kind: hazard.kind,
          x: hazard.x,
          y: hazard.y,
          z: hazard.z,
          ...(hazard.layer === undefined ? {} : { layer: hazard.layer }),
          ...(hazard.owner === undefined ? {} : { owner: hazard.owner }),
        },
      },
      [createHazardCommandScope(currentMapSlug())],
      'map-scene-place-hazard',
    ) as PlaceHazardCommand | null
    if (command === null) return requireActor<PlaceHazardCommand>() as Extract<SessionMapSceneCommandDispatchResult<PlaceHazardCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchRemoveHazard = (
    cell: { x: number; y: number; z: number; kind?: MapHazardV2['kind'] },
  ): SessionMapSceneCommandDispatchResult<RemoveHazardCommand> => {
    const map = requireMap<RemoveHazardCommand>()
    if ('dispatched' in map) return map
    const command = buildCommand(
      REMOVE_HAZARD_COMMAND_TYPE,
      {
        mapSlug: currentMapSlug(),
        cell: {
          x: cell.x,
          y: cell.y,
          z: cell.z,
          ...(cell.kind === undefined ? {} : { kind: cell.kind }),
        },
      },
      [createHazardCommandScope(currentMapSlug())],
      'map-scene-remove-hazard',
    ) as RemoveHazardCommand | null
    if (command === null) return requireActor<RemoveHazardCommand>() as Extract<SessionMapSceneCommandDispatchResult<RemoveHazardCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchApplyFieldEffect = (
    effect: MoveAutomationFieldEffectApply,
  ): SessionMapSceneCommandDispatchResult<SetFieldEffectCommand> => {
    const map = requireMap<SetFieldEffectCommand>()
    if ('dispatched' in map) return map
    const command = buildCommand(
      SET_FIELD_EFFECT_COMMAND_TYPE,
      {
        mapSlug: currentMapSlug(),
        category: effect.kind,
        kind: effect.value,
        source: effect.source ?? 'Move automation',
      },
      [createFieldEffectCommandScope(currentMapSlug())],
      'map-scene-apply-field-effect',
    ) as SetFieldEffectCommand | null
    if (command === null) return requireActor<SetFieldEffectCommand>() as Extract<SessionMapSceneCommandDispatchResult<SetFieldEffectCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchPlaceVoxel = (voxel: MapVoxelV2): SessionMapSceneCommandDispatchResult<BuildTerrainVoxelCommand> => {
    const map = requireMap<BuildTerrainVoxelCommand>()
    if ('dispatched' in map) return map
    const command = buildCommand(
      BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
      {
        mapSlug: currentMapSlug(),
        voxel: {
          x: voxel.x,
          y: voxel.y,
          z: voxel.z,
          materialId: voxel.materialId,
          ...(voxel.color === undefined ? {} : { color: voxel.color }),
          ...(voxel.ghost === undefined ? {} : { ghost: voxel.ghost }),
          ...(voxel.blocksMovement === undefined ? {} : { blocksMovement: voxel.blocksMovement }),
          ...(voxel.blocksSight === undefined ? {} : { blocksSight: voxel.blocksSight }),
          ...(voxel.tags === undefined ? {} : { tags: [...voxel.tags] }),
        },
      },
      [createTerrainVoxelCommandScope(voxel, currentMapSlug())],
      'map-scene-place-voxel',
    ) as BuildTerrainVoxelCommand | null
    if (command === null) return requireActor<BuildTerrainVoxelCommand>() as Extract<SessionMapSceneCommandDispatchResult<BuildTerrainVoxelCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  const dispatchRemoveVoxel = (
    cell: { x: number; y: number; z: number },
  ): SessionMapSceneCommandDispatchResult<RemoveTerrainVoxelCommand> => {
    const map = requireMap<RemoveTerrainVoxelCommand>()
    if ('dispatched' in map) return map
    const command = buildCommand(
      REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
      {
        mapSlug: currentMapSlug(),
        cell: { x: cell.x, y: cell.y, z: cell.z },
      },
      [createTerrainVoxelCommandScope(cell, currentMapSlug())],
      'map-scene-remove-voxel',
    ) as RemoveTerrainVoxelCommand | null
    if (command === null) return requireActor<RemoveTerrainVoxelCommand>() as Extract<SessionMapSceneCommandDispatchResult<RemoveTerrainVoxelCommand>, { readonly dispatched: false }>
    return dispatch(command)
  }

  return {
    enabled,
    lastError,
    dispatchDeletePokemon,
    dispatchSendOutPokemon,
    dispatchModifyHp,
    dispatchModifyCombatStages,
    dispatchModifyConditions,
    dispatchUseMove,
    dispatchUseManeuver,
    dispatchUseAbility,
    dispatchUseOrder,
    dispatchNextInitiative,
    dispatchPreviousInitiative,
    dispatchPlaceHazard,
    dispatchRemoveHazard,
    dispatchApplyFieldEffect,
    dispatchPlaceVoxel,
    dispatchRemoveVoxel,
  }
}
