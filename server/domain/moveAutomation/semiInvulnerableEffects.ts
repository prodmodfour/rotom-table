import {
  ENCOUNTER_EFFECT_LIMITS,
  parseEncounterEffect,
  parseEncounterEffects,
  type EncounterCapabilityEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvents,
  type EncounterEffectAddedEvent,
} from '#shared/moveAutomation/events'
import type { MovementSemiInvulnerableState } from '~/types/movement'
import {
  isMoveSemiInvulnerableFamilyId,
  moveSemiInvulnerableDefinition,
  moveSemiInvulnerableDefinitionByFamily,
  type MoveSemiInvulnerableCanonicalId,
  type MoveSemiInvulnerableDefinition,
  type MoveSemiInvulnerableEffectRole,
  type MoveSemiInvulnerableFamilyId,
} from './semiInvulnerableDefinitions'
import {
  MOVE_SEMI_INVULNERABLE_CAPABILITY_PREFIX,
  MOVE_SEMI_INVULNERABLE_EFFECT_TAG,
  MOVE_SEMI_INVULNERABLE_FAMILY_TAG_PREFIX,
  MOVE_SEMI_INVULNERABLE_ROLE_TAG_PREFIX,
  MoveSemiInvulnerableSetupError,
  assertMoveSemiInvulnerableStableId,
  deepFreezeMoveSemiInvulnerable,
  deriveMoveSemiInvulnerableId,
  failMoveSemiInvulnerableSetup,
} from './semiInvulnerableSupport'

export {
  MOVE_SEMI_INVULNERABLE_CAPABILITY_PREFIX,
  MOVE_SEMI_INVULNERABLE_EFFECT_TAG,
  MOVE_SEMI_INVULNERABLE_FAMILY_TAG_PREFIX,
  MOVE_SEMI_INVULNERABLE_LIMITS,
  MOVE_SEMI_INVULNERABLE_ROLE_TAG_PREFIX,
  MoveSemiInvulnerableSetupError,
  type MoveSemiInvulnerableSetupErrorCode,
} from './semiInvulnerableSupport'

export interface MoveSemiInvulnerableSetupAuthority {
  /** Complete authoritative map order. */
  readonly placementIds: readonly string[]
  readonly effects: readonly EncounterEffect[]
}

export interface MoveSemiInvulnerableSetupGroup {
  readonly setupOperationId: string
  readonly definition: MoveSemiInvulnerableDefinition
  readonly actorPlacementId: string
  readonly actorEffect: EncounterCapabilityEffect
  readonly carriedTargetPlacementId: string | null
  readonly carriedTargetEffect: EncounterCapabilityEffect | null
  readonly effects: readonly EncounterCapabilityEffect[]
}

export interface MoveSemiInvulnerableSetupPlan extends MoveSemiInvulnerableSetupGroup {
  readonly events: readonly EncounterEffectAddedEvent[]
}

const canonicalPlacementIds = (
  values: readonly string[],
): readonly string[] => {
  if (!Array.isArray(values) || values.length > ENCOUNTER_EFFECT_LIMITS.affectedPlacements) {
    return failMoveSemiInvulnerableSetup(
      'invalid-authority',
      'Semi-invulnerable authority placement IDs are invalid or unbounded.',
    )
  }
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) {
      return failMoveSemiInvulnerableSetup(
        'invalid-authority',
        'Semi-invulnerable authority has an invalid or duplicate placement ID.',
      )
    }
    seen.add(value)
  }
  return Object.freeze([...values])
}

const assertPlacement = (
  placementIds: readonly string[],
  placementId: string,
  label: string,
): string => placementIds.includes(placementId)
  ? placementId
  : failMoveSemiInvulnerableSetup(
      'placement-not-found',
      `${label} ${placementId} is not authoritative.`,
    )

const familyTag = (familyId: MoveSemiInvulnerableFamilyId): string => (
  `${MOVE_SEMI_INVULNERABLE_FAMILY_TAG_PREFIX}${familyId}`
)

const roleTag = (role: MoveSemiInvulnerableEffectRole): string => (
  `${MOVE_SEMI_INVULNERABLE_ROLE_TAG_PREFIX}${role}`
)

export const activeMoveSemiInvulnerableEffect = (
  effect: EncounterCapabilityEffect,
): boolean => (
  effect.payload.action === 'grant'
  && effect.suppression.sources.length === 0
  && effect.charges !== 0
)

export const moveSemiInvulnerableStateForEffect = (
  effect: EncounterEffect,
): MovementSemiInvulnerableState | null => {
  if (effect.kind !== 'capability' || effect.payload.action !== 'grant') return null
  if (!effect.payload.capabilityId.startsWith(MOVE_SEMI_INVULNERABLE_CAPABILITY_PREFIX)) {
    return null
  }
  const state = effect.payload.capabilityId.slice(MOVE_SEMI_INVULNERABLE_CAPABILITY_PREFIX.length)
  return [
    'underground',
    'underwater',
    'airborne',
    'vanished',
    'carried',
    'phased',
  ].includes(state) ? state as MovementSemiInvulnerableState : null
}

export const activeMoveSemiInvulnerableEffectsForPlacement = (
  effects: readonly EncounterEffect[],
  placementId: string,
): readonly EncounterCapabilityEffect[] => effects.filter(
  (effect): effect is EncounterCapabilityEffect => (
    effect.kind === 'capability'
    && activeMoveSemiInvulnerableEffect(effect)
    && moveSemiInvulnerableStateForEffect(effect) !== null
    && effect.affected.placementIds.includes(placementId)
  ),
)

const exactlyOnePrefixedTag = (
  effect: EncounterCapabilityEffect,
  prefix: string,
  label: string,
): string => {
  const tags = effect.tags.filter(tag => tag.startsWith(prefix))
  if (tags.length !== 1) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Semi-invulnerable effect ${effect.id} must have exactly one ${label} tag.`,
    )
  }
  return tags[0]!.slice(prefix.length)
}

interface ParsedSetupEffect {
  readonly effect: EncounterCapabilityEffect
  readonly familyId: MoveSemiInvulnerableFamilyId
  readonly role: MoveSemiInvulnerableEffectRole
  readonly state: MovementSemiInvulnerableState
  readonly placementId: string
}

const parseSetupEffect = (effect: EncounterCapabilityEffect): ParsedSetupEffect => {
  if (!effect.tags.includes(MOVE_SEMI_INVULNERABLE_EFFECT_TAG)) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Semi-invulnerable capability effect ${effect.id} is missing its reviewed setup tag.`,
    )
  }
  const familyValue = exactlyOnePrefixedTag(
    effect,
    MOVE_SEMI_INVULNERABLE_FAMILY_TAG_PREFIX,
    'family',
  )
  if (!isMoveSemiInvulnerableFamilyId(familyValue)) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Effect ${effect.id} has unknown setup family ${familyValue}.`,
    )
  }
  const roleValue = exactlyOnePrefixedTag(
    effect,
    MOVE_SEMI_INVULNERABLE_ROLE_TAG_PREFIX,
    'role',
  )
  if (roleValue !== 'user' && roleValue !== 'carried-target') {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Effect ${effect.id} has unsupported setup role ${roleValue}.`,
    )
  }
  const state = moveSemiInvulnerableStateForEffect(effect)
    ?? failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Effect ${effect.id} has no supported semi-invulnerable state.`,
    )
  if (!activeMoveSemiInvulnerableEffect(effect)) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Setup effect ${effect.id} must be an active capability grant.`,
    )
  }
  if (
    effect.affected.placementIds.length !== 1
    || effect.affected.sideIds.length !== 0
    || effect.affected.cells.length !== 0
  ) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Setup effect ${effect.id} must address exactly one direct placement.`,
    )
  }
  if (
    effect.duration.kind !== 'scene'
    || effect.stacks !== 1
    || effect.charges !== null
    || effect.stackPolicy.kind !== 'independent-instance'
    || effect.chargePolicy.kind !== 'none'
    || effect.dispel.policy !== 'none'
    || (effect.transferPolicy ?? 'expire') !== 'expire'
  ) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Setup effect ${effect.id} must use the reviewed scene/independent/non-dispellable lifecycle policy.`,
    )
  }

  const definition = moveSemiInvulnerableDefinitionByFamily(familyValue)
  const expectedState = roleValue === 'user'
    ? definition.userState
    : definition.carriedTargetState
  if (state !== expectedState) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Setup effect ${effect.id} state ${state} does not match ${familyValue}/${roleValue}.`,
    )
  }
  if (effect.source.moveId !== `move.${familyValue}`) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Setup effect ${effect.id} move source does not match family ${familyValue}.`,
    )
  }

  return {
    effect,
    familyId: familyValue,
    role: roleValue,
    state,
    placementId: effect.affected.placementIds[0]!,
  }
}

const buildSetupGroup = (
  setupOperationId: string,
  parsedEffects: readonly ParsedSetupEffect[],
): MoveSemiInvulnerableSetupGroup => {
  const familyIds = new Set(parsedEffects.map(entry => entry.familyId))
  if (familyIds.size !== 1) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Setup ${setupOperationId} mixes more than one semi-invulnerable family.`,
    )
  }
  const definition = moveSemiInvulnerableDefinitionByFamily([...familyIds][0]!)
  const actorEffects = parsedEffects.filter(entry => entry.role === 'user')
  const carriedEffects = parsedEffects.filter(entry => entry.role === 'carried-target')
  const expectedCount = definition.carriedTargetState === null ? 1 : 2
  if (
    parsedEffects.length !== expectedCount
    || actorEffects.length !== 1
    || carriedEffects.length !== expectedCount - 1
  ) {
    return failMoveSemiInvulnerableSetup(
      'incomplete-setup-group',
      `Setup ${setupOperationId} does not contain its exact user/carried effect group.`,
    )
  }
  const actor = actorEffects[0]!
  if (actor.effect.source.placementId !== actor.placementId) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Setup ${setupOperationId} user effect source must match its affected actor.`,
    )
  }
  const carried = carriedEffects[0] ?? null
  if (carried && (
    carried.effect.source.placementId !== actor.placementId
    || carried.placementId === actor.placementId
  )) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup-effect',
      `Setup ${setupOperationId} carried effect must name a distinct target and the same actor source.`,
    )
  }
  return deepFreezeMoveSemiInvulnerable({
    setupOperationId,
    definition,
    actorPlacementId: actor.placementId,
    actorEffect: actor.effect,
    carriedTargetPlacementId: carried?.placementId ?? null,
    carriedTargetEffect: carried?.effect ?? null,
    effects: parsedEffects.map(entry => entry.effect),
  })
}

/** Strictly recover durable setup groups from their closed capability-effect encoding. */
export const parseMoveSemiInvulnerableSetupGroups = (
  values: readonly EncounterEffect[],
): readonly MoveSemiInvulnerableSetupGroup[] => {
  const effects = parseEncounterEffects(values, 'semiInvulnerable.effects')
  const setupEffects = effects.filter((effect): effect is EncounterCapabilityEffect => (
    effect.kind === 'capability'
    && effect.tags.includes(MOVE_SEMI_INVULNERABLE_EFFECT_TAG)
  ))
  const byOperation = new Map<string, ParsedSetupEffect[]>()
  for (const effect of setupEffects) {
    const entries = byOperation.get(effect.source.operationId) ?? []
    entries.push(parseSetupEffect(effect))
    byOperation.set(effect.source.operationId, entries)
  }
  const groups = [...byOperation.entries()].map(([operationId, entries]) => (
    buildSetupGroup(operationId, entries)
  ))
  if (new Set(groups.map(group => group.setupOperationId)).size !== groups.length) {
    return failMoveSemiInvulnerableSetup(
      'duplicate-setup-group',
      'Semi-invulnerable setup operation identity is duplicated.',
    )
  }
  return deepFreezeMoveSemiInvulnerable(groups)
}

export const moveSemiInvulnerableSetupGroup = (
  effects: readonly EncounterEffect[],
  setupOperationId: string,
): MoveSemiInvulnerableSetupGroup => parseMoveSemiInvulnerableSetupGroups(effects)
  .find(group => group.setupOperationId === setupOperationId)
  ?? failMoveSemiInvulnerableSetup(
    'setup-group-not-found',
    `Semi-invulnerable setup ${setupOperationId} is not active.`,
  )

export const tryMoveSemiInvulnerableSetupGroup = (
  effects: readonly EncounterEffect[],
  setupOperationId: string,
): MoveSemiInvulnerableSetupGroup | null => {
  try {
    return moveSemiInvulnerableSetupGroup(effects, setupOperationId)
  }
  catch (error) {
    if (error instanceof MoveSemiInvulnerableSetupError) return null
    throw error
  }
}

export const moveSemiInvulnerableEffectRole = (
  group: MoveSemiInvulnerableSetupGroup,
  effectId: string,
): MoveSemiInvulnerableEffectRole | null => {
  if (group.actorEffect.id === effectId) return 'user'
  if (group.carriedTargetEffect?.id === effectId) return 'carried-target'
  return null
}

const setupEffect = (input: {
  readonly definition: MoveSemiInvulnerableDefinition
  readonly role: MoveSemiInvulnerableEffectRole
  readonly operationId: string
  readonly actorPlacementId: string
  readonly placementId: string
  readonly createdRound: number
  readonly createdTurn: number
}): EncounterCapabilityEffect => {
  const state = input.role === 'user'
    ? input.definition.userState
    : input.definition.carriedTargetState
      ?? failMoveSemiInvulnerableSetup(
        'invalid-setup',
        `${input.definition.canonicalId} has no carried-target state.`,
      )
  return parseEncounterEffect({
    id: deriveMoveSemiInvulnerableId(
      'effect.semi-invulnerable',
      input.operationId,
      input.role,
      input.placementId,
    ),
    kind: 'capability',
    source: {
      operationId: input.operationId,
      moveId: `move.${input.definition.familyId}`,
      placementId: input.actorPlacementId,
    },
    affected: { placementIds: [input.placementId], sideIds: [], cells: [] },
    createdRound: input.createdRound,
    createdTurn: input.createdTurn,
    duration: { kind: 'scene', remaining: null },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'independent-instance', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: [
      'movement',
      MOVE_SEMI_INVULNERABLE_EFFECT_TAG,
      familyTag(input.definition.familyId),
      roleTag(input.role),
    ],
    payload: {
      capabilityId: `${MOVE_SEMI_INVULNERABLE_CAPABILITY_PREFIX}${state}`,
      action: 'grant',
    },
    dispel: { policy: 'none', tags: [] },
    transferPolicy: 'expire',
    suppression: { sources: [] },
  }, `semiInvulnerable.${input.definition.familyId}.${input.role}`) as EncounterCapabilityEffect
}

const setupAddedEvent = (
  effect: EncounterCapabilityEffect,
  ordinal: number,
): EncounterEffectAddedEvent => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: deriveMoveSemiInvulnerableId(
    'event.semi-invulnerable.setup',
    effect.source.operationId,
    String(ordinal),
  ),
  kind: 'effect-added',
  sourceOperationId: effect.source.operationId,
  causalParentEventId: null,
  reasonCode: 'semi-invulnerable.setup',
  effect,
})

/**
 * Build one atomic setup event batch. Sky Drop always creates the user and
 * carried-target effects together; every other family rejects a carried target.
 */
export const createMoveSemiInvulnerableSetupPlan = (input: {
  readonly authority: MoveSemiInvulnerableSetupAuthority
  readonly canonicalMoveId: MoveSemiInvulnerableCanonicalId
  readonly operationId: string
  readonly actorPlacementId: string
  readonly carriedTargetPlacementId?: string | null
  readonly createdRound: number
  readonly createdTurn: number
}): MoveSemiInvulnerableSetupPlan => {
  const placementIds = canonicalPlacementIds(input.authority.placementIds)
  const currentEffects = parseEncounterEffects(
    input.authority.effects,
    'semiInvulnerable.authority.effects',
  )
  const operationId = assertMoveSemiInvulnerableStableId(
    input.operationId,
    'Semi-invulnerable setup operation ID',
  )
  const actorPlacementId = assertPlacement(
    placementIds,
    input.actorPlacementId,
    'Semi-invulnerable actor',
  )
  const definition = moveSemiInvulnerableDefinition(input.canonicalMoveId)
  const carriedTargetPlacementId = input.carriedTargetPlacementId ?? null
  if (definition.carriedTargetState !== null) {
    if (carriedTargetPlacementId === null) {
      return failMoveSemiInvulnerableSetup(
        'invalid-setup',
        `${definition.canonicalId} requires one carried target.`,
      )
    }
    assertPlacement(placementIds, carriedTargetPlacementId, 'Carried target')
    if (carriedTargetPlacementId === actorPlacementId) {
      return failMoveSemiInvulnerableSetup(
        'invalid-setup',
        'A semi-invulnerable user cannot carry itself.',
      )
    }
  }
  else if (carriedTargetPlacementId !== null) {
    return failMoveSemiInvulnerableSetup(
      'invalid-setup',
      `${definition.canonicalId} cannot create a carried-target effect.`,
    )
  }

  const participants = [
    actorPlacementId,
    ...(carriedTargetPlacementId ? [carriedTargetPlacementId] : []),
  ]
  for (const placementId of participants) {
    if (activeMoveSemiInvulnerableEffectsForPlacement(currentEffects, placementId).length > 0) {
      return failMoveSemiInvulnerableSetup(
        'setup-conflict',
        `Placement ${placementId} already has an active semi-invulnerable state.`,
      )
    }
  }

  const effects = [
    setupEffect({
      definition,
      role: 'user',
      operationId,
      actorPlacementId,
      placementId: actorPlacementId,
      createdRound: input.createdRound,
      createdTurn: input.createdTurn,
    }),
    ...(carriedTargetPlacementId
      ? [setupEffect({
          definition,
          role: 'carried-target',
          operationId,
          actorPlacementId,
          placementId: carriedTargetPlacementId,
          createdRound: input.createdRound,
          createdTurn: input.createdTurn,
        })]
      : []),
  ]
  if (currentEffects.length + effects.length > ENCOUNTER_EFFECT_LIMITS.count) {
    return failMoveSemiInvulnerableSetup(
      'effect-limit-exceeded',
      `Semi-invulnerable setup would exceed ${ENCOUNTER_EFFECT_LIMITS.count} encounter effects.`,
    )
  }
  const group = buildSetupGroup(operationId, effects.map(parseSetupEffect))
  const events = parseEncounterEvents(
    effects.map((effect, index) => setupAddedEvent(effect, index + 1)),
    'semiInvulnerable.setupEvents',
  ) as readonly EncounterEffectAddedEvent[]
  return deepFreezeMoveSemiInvulnerable({ ...group, events })
}
