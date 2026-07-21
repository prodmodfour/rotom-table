import { deepFreezeStrictJson } from '#shared/automation/strictJson'
import type { AbilitySpecTriggerResponse } from '#shared/abilityAutomation/spec'
import type { AbilityExecutionBudget, AbilityExecutionBudgetCounters } from './executionBudget'
import { createAbilityExecutionBudget } from './executionBudget'
import type { AbilitySubscriptionRoute } from './subscriptionRouter'

export const ABILITY_TRIGGER_CHAIN_SCHEMA_VERSION = 1 as const
export const ABILITY_TRIGGER_CHAIN_LIMITS = Object.freeze({
  identifierLength: 200,
  childEventsPerCompletion: 64,
})

export type AbilityTriggerTerminalDisposition =
  | 'executed'
  | 'passed'
  | 'suppressed-cycle'
  | 'suppressed-once'

export interface AbilityTriggerChainEntry {
  readonly triggerId: string
  readonly eventId: string
  readonly parentEventId: string | null
  readonly depth: number
  readonly priority: number
  readonly canonicalId: string
  readonly ownerPlacementId: string
  readonly abilityInstanceId: string
  readonly subscriptionId: string
  readonly modeId: string
  readonly response: AbilitySpecTriggerResponse
  readonly oncePerCausalChain: boolean
  readonly runtimeVersion: number
  readonly definitionHash: string
  readonly sourceModule: string
  readonly cycleKey: string
  readonly ancestryCycleKeys: readonly string[]
}

export interface AbilityTriggerChainTerminalRecord {
  readonly sequence: number
  readonly triggerId: string
  readonly eventId: string
  readonly disposition: AbilityTriggerTerminalDisposition
  readonly reasonCode: string
}

export interface AbilityTriggerChainSnapshot {
  readonly schemaVersion: typeof ABILITY_TRIGGER_CHAIN_SCHEMA_VERSION
  readonly chainId: string
  readonly rootEventId: string
  readonly status: 'active' | 'completed'
  readonly nextTerminalSequence: number
  readonly pending: readonly AbilityTriggerChainEntry[]
  readonly terminal: readonly AbilityTriggerChainTerminalRecord[]
  readonly eventIds: readonly string[]
  readonly onceGuardKeys: readonly string[]
  readonly budgets: AbilityExecutionBudgetCounters
}

export interface AbilityTriggerChildEvent {
  readonly eventId: string
  readonly parentEventId: string
  readonly routes: readonly AbilitySubscriptionRoute[]
}

export interface AbilityTriggerChainCoordinator {
  readonly current: () => AbilityTriggerChainEntry | null
  readonly completeCurrent: (input: {
    readonly triggerId: string
    readonly disposition: 'executed' | 'passed'
    readonly childEvents?: readonly AbilityTriggerChildEvent[]
  }) => AbilityTriggerChainSnapshot
  readonly snapshot: () => AbilityTriggerChainSnapshot
}

export type AbilityTriggerChainErrorCode =
  | 'invalid-chain'
  | 'invalid-route'
  | 'out-of-order'
  | 'mandatory-pass'
  | 'invalid-child-event'
  | 'duplicate-event-id'
  | 'limit-exceeded'
  | 'completed'

export class AbilityTriggerChainError extends Error {
  constructor(readonly code: AbilityTriggerChainErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityTriggerChainError'
  }
}

type PendingEntry = {
  readonly entry: AbilityTriggerChainEntry
  readonly budget: AbilityExecutionBudget
  readonly suppression: Extract<AbilityTriggerTerminalDisposition, `suppressed-${string}`> | null
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const fail = (code: AbilityTriggerChainErrorCode, detail: string): never => {
  throw new AbilityTriggerChainError(code, detail)
}
const stableId = (value: string, label: string): string => {
  if (typeof value !== 'string' || value.length === 0
    || value.length > ABILITY_TRIGGER_CHAIN_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)) fail('invalid-chain', `${label} must be a stable ID.`)
  return value
}
const compareText = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1
const compareRoutes = (left: AbilitySubscriptionRoute, right: AbilitySubscriptionRoute): number => (
  right.priority - left.priority
  || compareText(left.canonicalId, right.canonicalId)
  || compareText(left.ownerPlacementId, right.ownerPlacementId)
  || compareText(left.abilityInstanceId, right.abilityInstanceId)
  || compareText(left.subscriptionId, right.subscriptionId)
  || compareText(left.routeId, right.routeId)
)
const cycleKeyFor = (route: AbilitySubscriptionRoute): string => (
  `${route.ownerPlacementId}:${route.abilityInstanceId}:${route.subscriptionId}`
)
const onceGuardKeyFor = cycleKeyFor

const validateRoute = (route: AbilitySubscriptionRoute, eventId: string): void => {
  if (!route || route.eventId !== eventId
    || !Number.isSafeInteger(route.priority)
    || (route.response !== 'mandatory' && route.response !== 'optional')
    || typeof route.oncePerCausalChain !== 'boolean'
    || !Number.isSafeInteger(route.runtimeVersion) || route.runtimeVersion < 1
    || !/^[a-f0-9]{64}$/.test(route.definitionHash)
    || typeof route.sourceModule !== 'string' || route.sourceModule.length === 0
    || route.sourceModule.length > ABILITY_TRIGGER_CHAIN_LIMITS.identifierLength) {
    fail('invalid-route', 'Trigger route does not match its event or causal policy.')
  }
  for (const [label, value] of [
    ['routeId', route.routeId],
    ['eventId', route.eventId],
    ['ownerPlacementId', route.ownerPlacementId],
    ['abilityInstanceId', route.abilityInstanceId],
    ['subscriptionId', route.subscriptionId],
    ['modeId', route.modeId],
  ] as const) stableId(value, label)
  if (typeof route.canonicalId !== 'string' || route.canonicalId.length === 0
    || route.canonicalId.length > ABILITY_TRIGGER_CHAIN_LIMITS.identifierLength) {
    fail('invalid-route', 'Trigger route canonical ability identity is invalid.')
  }
}

const frozenSnapshot = (snapshot: AbilityTriggerChainSnapshot): AbilityTriggerChainSnapshot => (
  deepFreezeStrictJson(snapshot) as unknown as AbilityTriggerChainSnapshot
)

export const createAbilityTriggerChainCoordinator = (input: {
  readonly chainId: string
  readonly rootEventId: string
  readonly routes: readonly AbilitySubscriptionRoute[]
  readonly budget?: AbilityExecutionBudget
}): AbilityTriggerChainCoordinator => {
  const chainId = stableId(input.chainId, 'chainId')
  const rootEventId = stableId(input.rootEventId, 'rootEventId')
  const rootBudget = input.budget ?? createAbilityExecutionBudget()
  const eventIds = new Set<string>([rootEventId])
  const onceGuardKeys = new Set<string>()
  const terminal: AbilityTriggerChainTerminalRecord[] = []
  const pending: PendingEntry[] = []
  let nextTerminalSequence = 1

  const appendTerminal = (
    entry: AbilityTriggerChainEntry,
    disposition: AbilityTriggerTerminalDisposition,
  ): void => {
    terminal.push(Object.freeze({
      sequence: nextTerminalSequence,
      triggerId: entry.triggerId,
      eventId: entry.eventId,
      disposition,
      reasonCode: disposition === 'executed'
        ? 'ability.trigger.executed'
        : disposition === 'passed'
          ? 'ability.trigger.passed'
          : disposition === 'suppressed-cycle'
            ? 'ability.trigger.cycle-suppressed'
            : 'ability.trigger.once-per-chain-suppressed',
    }))
    nextTerminalSequence += 1
  }

  const drainSuppressed = (): void => {
    while (pending[0]?.suppression) {
      const next = pending.shift()!
      appendTerminal(next.entry, next.suppression!)
    }
  }

  const schedule = (scheduleInput: {
    readonly eventId: string
    readonly parentEventId: string | null
    readonly routes: readonly AbilitySubscriptionRoute[]
    readonly depth: number
    readonly ancestryCycleKeys: readonly string[]
    readonly parentBudget: AbilityExecutionBudget
  }): PendingEntry[] => {
    scheduleInput.parentBudget.consumeEvent(1, scheduleInput.routes.length)
    const seenRouteIds = new Set<string>()
    return [...scheduleInput.routes].sort(compareRoutes).map(route => {
      validateRoute(route, scheduleInput.eventId)
      if (seenRouteIds.has(route.routeId)) fail('invalid-route', 'An event repeated a trigger route ID.')
      seenRouteIds.add(route.routeId)
      const cycleKey = cycleKeyFor(route)
      const onceGuardKey = onceGuardKeyFor(route)
      const cycle = scheduleInput.ancestryCycleKeys.includes(cycleKey)
      const once = route.oncePerCausalChain && onceGuardKeys.has(onceGuardKey)
      const suppression = cycle ? 'suppressed-cycle' : once ? 'suppressed-once' : null
      if (route.oncePerCausalChain && suppression === null) onceGuardKeys.add(onceGuardKey)
      const entry: AbilityTriggerChainEntry = Object.freeze({
        triggerId: route.routeId,
        eventId: route.eventId,
        parentEventId: scheduleInput.parentEventId,
        depth: scheduleInput.depth,
        priority: route.priority,
        canonicalId: route.canonicalId,
        ownerPlacementId: route.ownerPlacementId,
        abilityInstanceId: route.abilityInstanceId,
        subscriptionId: route.subscriptionId,
        modeId: route.modeId,
        response: route.response,
        oncePerCausalChain: route.oncePerCausalChain,
        runtimeVersion: route.runtimeVersion,
        definitionHash: route.definitionHash,
        sourceModule: route.sourceModule,
        cycleKey,
        ancestryCycleKeys: Object.freeze([...scheduleInput.ancestryCycleKeys]),
      })
      return {
        entry,
        budget: suppression === null && scheduleInput.depth > 0
          ? scheduleInput.parentBudget.child()
          : scheduleInput.parentBudget,
        suppression,
      }
    })
  }

  pending.push(...schedule({
    eventId: rootEventId,
    parentEventId: null,
    routes: input.routes,
    depth: 0,
    ancestryCycleKeys: [],
    parentBudget: rootBudget,
  }))
  drainSuppressed()

  const snapshot = (): AbilityTriggerChainSnapshot => frozenSnapshot({
    schemaVersion: ABILITY_TRIGGER_CHAIN_SCHEMA_VERSION,
    chainId,
    rootEventId,
    status: pending.length === 0 ? 'completed' : 'active',
    nextTerminalSequence,
    pending: pending.map(value => value.entry),
    terminal: [...terminal],
    eventIds: [...eventIds],
    onceGuardKeys: [...onceGuardKeys].sort(compareText),
    budgets: rootBudget.snapshot(),
  })

  return Object.freeze({
    current: (): AbilityTriggerChainEntry | null => pending[0]?.entry ?? null,
    completeCurrent: (completeInput: {
      readonly triggerId: string
      readonly disposition: 'executed' | 'passed'
      readonly childEvents?: readonly AbilityTriggerChildEvent[]
    }): AbilityTriggerChainSnapshot => {
      const current = pending[0]
      if (!current) fail('completed', 'The trigger chain is already complete.')
      if (completeInput.triggerId !== current.entry.triggerId) {
        fail('out-of-order', 'Only the deterministic head trigger can complete.')
      }
      const childEvents = completeInput.childEvents ?? []
      if (childEvents.length > ABILITY_TRIGGER_CHAIN_LIMITS.childEventsPerCompletion) {
        fail('limit-exceeded', 'A trigger emitted too many direct child events.')
      }
      if (completeInput.disposition === 'passed') {
        if (current.entry.response !== 'optional') fail('mandatory-pass', 'A mandatory trigger cannot pass.')
        if (childEvents.length > 0) fail('invalid-child-event', 'A passed trigger cannot emit child events.')
      }
      const prospectiveEventIds = new Set(eventIds)
      for (const childEvent of childEvents) {
        const childEventId = stableId(childEvent.eventId, 'childEvent.eventId')
        if (childEvent.parentEventId !== current.entry.eventId) {
          fail('invalid-child-event', 'Child event ancestry does not match the executing trigger event.')
        }
        if (prospectiveEventIds.has(childEventId)) {
          fail('duplicate-event-id', 'A causal chain repeated an event ID.')
        }
        prospectiveEventIds.add(childEventId)
        const routeIds = new Set<string>()
        for (const route of childEvent.routes) {
          validateRoute(route, childEventId)
          if (routeIds.has(route.routeId)) fail('invalid-route', 'An event repeated a trigger route ID.')
          routeIds.add(route.routeId)
        }
      }
      pending.shift()
      appendTerminal(current.entry, completeInput.disposition)
      if (completeInput.disposition === 'executed') {
        const childPending: PendingEntry[] = []
        for (const childEvent of childEvents) {
          const childEventId = stableId(childEvent.eventId, 'childEvent.eventId')
          eventIds.add(childEventId)
          childPending.push(...schedule({
            eventId: childEventId,
            parentEventId: current.entry.eventId,
            routes: childEvent.routes,
            depth: current.entry.depth + 1,
            ancestryCycleKeys: [...current.entry.ancestryCycleKeys, current.entry.cycleKey],
            parentBudget: current.budget,
          }))
        }
        pending.unshift(...childPending)
      }
      drainSuppressed()
      return snapshot()
    },
    snapshot,
  })
}
