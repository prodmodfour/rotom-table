import type { EquipmentEventProviderRoute } from './equipmentEventProviderRouter'

export const EQUIPMENT_PROVIDER_TRIGGER_CHAIN_LIMITS = Object.freeze({
  events: 256,
  routes: 2_048,
  depth: 16,
  childEventsPerCompletion: 64,
})

export type EquipmentProviderTriggerDisposition =
  | 'executed'
  | 'passed'
  | 'suppressed-cycle'
  | 'suppressed-once'

export interface EquipmentProviderTriggerEntry {
  readonly triggerId: string
  readonly eventId: string
  readonly parentEventId: string | null
  readonly depth: number
  readonly cycleKey: string
  readonly ancestryCycleKeys: readonly string[]
  readonly route: EquipmentEventProviderRoute
}
export interface EquipmentProviderTriggerTerminal {
  readonly sequence: number
  readonly triggerId: string
  readonly eventId: string
  readonly disposition: EquipmentProviderTriggerDisposition
  readonly reasonCode:
    | 'equipment-provider.trigger.executed'
    | 'equipment-provider.trigger.passed'
    | 'equipment-provider.trigger.cycle-suppressed'
    | 'equipment-provider.trigger.once-per-chain-suppressed'
}
export interface EquipmentProviderTriggerChainSnapshot {
  readonly chainId: string
  readonly rootEventId: string
  readonly status: 'active' | 'completed'
  readonly pending: readonly EquipmentProviderTriggerEntry[]
  readonly terminal: readonly EquipmentProviderTriggerTerminal[]
  readonly eventIds: readonly string[]
  readonly onceGuardKeys: readonly string[]
}
export interface EquipmentProviderTriggerChildEvent {
  readonly eventId: string
  readonly parentEventId: string
  readonly routes: readonly EquipmentEventProviderRoute[]
}
export interface EquipmentProviderTriggerChainCoordinator {
  current(): EquipmentProviderTriggerEntry | null
  completeCurrent(input: {
    readonly triggerId: string
    readonly disposition: 'executed' | 'passed'
    readonly childEvents?: readonly EquipmentProviderTriggerChildEvent[]
  }): EquipmentProviderTriggerChainSnapshot
  snapshot(): EquipmentProviderTriggerChainSnapshot
}

export class EquipmentProviderTriggerChainError extends Error {
  constructor(readonly code:
    | 'invalid-chain' | 'invalid-route' | 'out-of-order' | 'mandatory-pass'
    | 'invalid-child-event' | 'duplicate-event-id' | 'limit-exceeded' | 'completed',
  detail: string) {
    super(detail)
    this.name = 'EquipmentProviderTriggerChainError'
  }
}
const fail = (code: EquipmentProviderTriggerChainError['code'], detail: string): never => {
  throw new EquipmentProviderTriggerChainError(code, detail)
}
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const stableId = (value: string, label: string): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || !ID.test(value)) {
    fail('invalid-chain', `${label} must be a bounded stable identity.`)
  }
  return value
}
const cycleKeyFor = (route: EquipmentEventProviderRoute): string => (
  `${route.ownerPlacementId}:${route.sourceBindingSha256}:${route.providerId}`
)
const compareRoutes = (left: EquipmentEventProviderRoute, right: EquipmentEventProviderRoute): number => (
  right.priority - left.priority
  || left.ownerPlacementId.localeCompare(right.ownerPlacementId)
  || left.providerId.localeCompare(right.providerId)
  || left.routeId.localeCompare(right.routeId)
)
const validateRoutes = (
  routes: readonly EquipmentEventProviderRoute[],
  eventId: string,
): void => {
  const routeIds = new Set<string>()
  for (const route of routes) {
    if (route.eventId !== eventId || route.oncePerCausalChain !== true
      || !Number.isSafeInteger(route.priority) || !/^[a-f0-9]{64}$/.test(route.sourceBindingSha256)) {
      fail('invalid-route', 'Equipment provider route does not match its causal event and reviewed source policy.')
    }
    stableId(route.routeId, 'routeId')
    stableId(route.providerId, 'providerId')
    stableId(route.ownerPlacementId, 'ownerPlacementId')
    if (routeIds.has(route.routeId)) fail('invalid-route', 'A causal event repeated a route identity.')
    routeIds.add(route.routeId)
  }
}
const freeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    freeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

/** Deterministic equipment-only causal coordinator; it never fabricates Ability identities. */
export const createEquipmentProviderTriggerChainCoordinator = (input: {
  readonly chainId: string
  readonly rootEventId: string
  readonly routes: readonly EquipmentEventProviderRoute[]
}): EquipmentProviderTriggerChainCoordinator => {
  const chainId = stableId(input.chainId, 'chainId')
  const rootEventId = stableId(input.rootEventId, 'rootEventId')
  validateRoutes(input.routes, rootEventId)
  const eventIds = new Set([rootEventId])
  const onceGuardKeys = new Set<string>()
  const pending: EquipmentProviderTriggerEntry[] = []
  const terminal: EquipmentProviderTriggerTerminal[] = []
  let terminalSequence = 1
  let routeCount = 0

  const appendTerminal = (
    entry: EquipmentProviderTriggerEntry,
    disposition: EquipmentProviderTriggerDisposition,
  ): void => {
    terminal.push(freeze({
      sequence: terminalSequence++,
      triggerId: entry.triggerId,
      eventId: entry.eventId,
      disposition,
      reasonCode: disposition === 'executed'
        ? 'equipment-provider.trigger.executed'
        : disposition === 'passed'
          ? 'equipment-provider.trigger.passed'
          : disposition === 'suppressed-cycle'
            ? 'equipment-provider.trigger.cycle-suppressed'
            : 'equipment-provider.trigger.once-per-chain-suppressed',
    }))
  }
  const schedule = (options: {
    readonly eventId: string
    readonly parentEventId: string | null
    readonly depth: number
    readonly ancestryCycleKeys: readonly string[]
    readonly routes: readonly EquipmentEventProviderRoute[]
  }): EquipmentProviderTriggerEntry[] => {
    if (options.depth > EQUIPMENT_PROVIDER_TRIGGER_CHAIN_LIMITS.depth) {
      fail('limit-exceeded', 'Equipment provider causal depth exceeded.')
    }
    validateRoutes(options.routes, options.eventId)
    routeCount += options.routes.length
    if (routeCount > EQUIPMENT_PROVIDER_TRIGGER_CHAIN_LIMITS.routes) {
      fail('limit-exceeded', 'Equipment provider causal route budget exceeded.')
    }
    const scheduled: EquipmentProviderTriggerEntry[] = []
    for (const route of [...options.routes].sort(compareRoutes)) {
      const cycleKey = cycleKeyFor(route)
      const entry = freeze({
        triggerId: route.routeId,
        eventId: options.eventId,
        parentEventId: options.parentEventId,
        depth: options.depth,
        cycleKey,
        ancestryCycleKeys: [...options.ancestryCycleKeys],
        route,
      })
      if (options.ancestryCycleKeys.includes(cycleKey)) {
        appendTerminal(entry, 'suppressed-cycle')
        continue
      }
      if (onceGuardKeys.has(cycleKey)) {
        appendTerminal(entry, 'suppressed-once')
        continue
      }
      onceGuardKeys.add(cycleKey)
      scheduled.push(entry)
    }
    return scheduled
  }
  pending.push(...schedule({
    eventId: rootEventId,
    parentEventId: null,
    depth: 0,
    ancestryCycleKeys: [],
    routes: input.routes,
  }))

  const snapshot = (): EquipmentProviderTriggerChainSnapshot => freeze({
    chainId,
    rootEventId,
    status: pending.length ? 'active' : 'completed',
    pending: [...pending],
    terminal: [...terminal],
    eventIds: [...eventIds],
    onceGuardKeys: [...onceGuardKeys].sort(),
  })

  return Object.freeze({
    current: () => pending[0] ?? null,
    completeCurrent: (completion) => {
      const current = pending[0]
      if (!current) fail('completed', 'The equipment provider trigger chain is complete.')
      if (completion.triggerId !== current.triggerId) {
        fail('out-of-order', 'Only the deterministic head equipment trigger may complete.')
      }
      if (completion.disposition === 'passed' && current.route.response !== 'optional') {
        fail('mandatory-pass', 'A mandatory equipment provider cannot pass.')
      }
      const children = completion.childEvents ?? []
      if (children.length > EQUIPMENT_PROVIDER_TRIGGER_CHAIN_LIMITS.childEventsPerCompletion) {
        fail('limit-exceeded', 'An equipment provider emitted too many child events.')
      }
      if (completion.disposition === 'passed' && children.length) {
        fail('invalid-child-event', 'A passed equipment provider cannot emit child events.')
      }
      const prospective = new Set(eventIds)
      for (const child of children) {
        stableId(child.eventId, 'childEvent.eventId')
        if (child.parentEventId !== current.eventId) {
          fail('invalid-child-event', 'Equipment provider child event ancestry is invalid.')
        }
        if (prospective.has(child.eventId)) fail('duplicate-event-id', 'A causal event identity was repeated.')
        prospective.add(child.eventId)
        validateRoutes(child.routes, child.eventId)
      }
      if (eventIds.size + children.length > EQUIPMENT_PROVIDER_TRIGGER_CHAIN_LIMITS.events) {
        fail('limit-exceeded', 'Equipment provider causal event budget exceeded.')
      }
      pending.shift()
      appendTerminal(current, completion.disposition)
      if (completion.disposition === 'executed') {
        const childEntries: EquipmentProviderTriggerEntry[] = []
        for (const child of children) {
          eventIds.add(child.eventId)
          childEntries.push(...schedule({
            eventId: child.eventId,
            parentEventId: current.eventId,
            depth: current.depth + 1,
            ancestryCycleKeys: [...current.ancestryCycleKeys, current.cycleKey],
            routes: child.routes,
          }))
        }
        pending.unshift(...childEntries)
      }
      return snapshot()
    },
    snapshot,
  })
}
