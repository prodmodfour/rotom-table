import { createHash } from 'node:crypto'
import {
  parseMoveEffectOperation,
  type MoveDirectHpEffectOperation,
} from '#shared/moveAutomation/effects'
import type { TabletopMap } from '~/types/map'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from './context'
import type {
  MoveCoreTokenEffectImmunityDecision,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectRecipient,
} from './reducers/coreTokenEffectTypes'
import type { EncounterLifecycleTriggerHandler } from './reduceLifecycle'
import { equipmentHpChangePreventionReason } from './equipmentProviderMechanics'
import {
  createMoveAutomationWeatherResolver,
  type AuthoritativeWeatherInstance,
} from './weather'

export const WEATHER_RESIDUAL_KINDS = ['hail', 'sandstorm'] as const
export type WeatherResidualKind = (typeof WEATHER_RESIDUAL_KINDS)[number]

export const WEATHER_RESIDUAL_LIFECYCLE_HANDLER_ID = 'handler.weather-residual' as const

const WEATHER_RESIDUAL_REASON_CODES = Object.freeze({
  hail: 'weather.hail.round-end-residual',
  sandstorm: 'weather.sandstorm.round-end-residual',
} as const)

const WEATHER_RESIDUAL_IMMUNE_TYPES = Object.freeze({
  hail: Object.freeze(['ice']),
  sandstorm: Object.freeze(['ground', 'rock', 'steel']),
} as const)

const UNIVERSAL_WEATHER_IMMUNITY_ABILITIES = Object.freeze([
  'Magic Guard',
  'Overcoat',
  'Permafrost',
] as const)

const WEATHER_SELF_IMMUNITY_ABILITIES = Object.freeze({
  hail: Object.freeze(['Ice Face', 'Snow Cloak', 'Snow Warning']),
  sandstorm: Object.freeze(['Desert Weather', 'Sand Veil']),
} as const)

const WEATHER_ALLY_IMMUNITY_ABILITIES = Object.freeze({
  hail: 'Snow Cloak',
  sandstorm: 'Sand Veil',
} as const)

const operationDigest = (input: {
  readonly eventId: string
  readonly zoneId: string
  readonly weatherKind: WeatherResidualKind
}): string => createHash('sha256')
  .update(`${input.eventId}\u0000${input.zoneId}\u0000${input.weatherKind}`)
  .digest('hex')
  .slice(0, 32)

const residualOperationId = (input: {
  readonly eventId: string
  readonly weather: AuthoritativeWeatherInstance & { readonly kind: WeatherResidualKind }
}): string => `weather.residual.${input.weather.kind}.${operationDigest({
  eventId: input.eventId,
  zoneId: input.weather.zoneId,
  weatherKind: input.weather.kind,
})}`

const residualOperation = (input: {
  readonly eventId: string
  readonly weather: AuthoritativeWeatherInstance & { readonly kind: WeatherResidualKind }
}): MoveDirectHpEffectOperation => parseMoveEffectOperation({
  id: residualOperationId(input),
  kind: 'direct-hp',
  source: { kind: 'lifecycle-event', id: input.eventId },
  recipients: { kind: 'area-targets' },
  phase: 'cleanup',
  reasonCode: WEATHER_RESIDUAL_REASON_CODES[input.weather.kind],
  payload: {
    mode: 'lose',
    pool: 'hit-points',
    calculation: { kind: 'percent-max', percent: 10 },
    copySource: null,
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: true,
    cost: null,
    injury: {
      hitPointMarkers: 'apply-after-operation',
      massiveDamage: 'never',
    },
  },
}, `weather.${input.weather.kind}.residual`) as MoveDirectHpEffectOperation

const isResidualWeather = (
  weather: AuthoritativeWeatherInstance,
): weather is AuthoritativeWeatherInstance & { readonly kind: WeatherResidualKind } => (
  weather.kind === 'hail' || weather.kind === 'sandstorm'
)

/**
 * Materialize the built-in weather handler from the same active-field query as
 * move calculations. Registered encounter-effect handlers run first; this
 * handler runs last, and global-field duration advancement follows all handlers.
 */
export const createWeatherResidualLifecycleHandler = (
  map: Pick<TabletopMap, 'placements' | 'initiative' | 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): EncounterLifecycleTriggerHandler | null => {
  const weather = createMoveAutomationWeatherResolver(map).active().filter(isResidualWeather)
  if (weather.length === 0) return null

  const handler: EncounterLifecycleTriggerHandler = {
    id: WEATHER_RESIDUAL_LIFECYCLE_HANDLER_ID,
    resolve: ({ event }) => {
      if (event.kind !== 'round-end') return []
      return weather.map(instance => ({
        effectId: null,
        reasonCode: `${WEATHER_RESIDUAL_REASON_CODES[instance.kind]}-trigger`,
        operations: [residualOperation({ eventId: event.eventId, weather: instance })],
        emittedEvents: [],
      }))
    },
  }
  return Object.freeze(handler)
}

/** Recover only server-materialized weather residual identities. */
export const weatherResidualKindForOperation = (
  operation: MoveDirectHpEffectOperation,
): WeatherResidualKind | null => {
  for (const kind of WEATHER_RESIDUAL_KINDS) {
    if (
      operation.reasonCode === WEATHER_RESIDUAL_REASON_CODES[kind]
      && operation.id.startsWith(`weather.residual.${kind}.`)
    ) return kind
  }
  return null
}

const normalizedTypes = (
  recipient: MoveCoreTokenEffectRecipient,
): ReadonlySet<string> => new Set(
  recipient.token.defenderTypes.map(type => type.trim().toLowerCase()).filter(Boolean),
)

const hasEffectiveWeatherAbility = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
  readonly ability: string
}): boolean => input.context.queries.abilities.has(input.placementId, input.ability)

const adjacentAllyAbilityImmunity = (input: {
  readonly weatherKind: WeatherResidualKind
  readonly context: AuthoritativeMoveRulesContext
  readonly recipient: MoveCoreTokenEffectRecipient
}): MoveCoreTokenEffectImmunityDecision => {
  const ability = WEATHER_ALLY_IMMUNITY_ABILITIES[input.weatherKind]
  const consultedPlacementIds: string[] = []
  for (const provider of input.context.queries.tokens.all()) {
    if (provider.id === input.recipient.placement.id) continue
    if (!input.context.queries.relationships.match(
      provider.id,
      input.recipient.placement.id,
      'ally',
    ).matches) continue

    // Only adjacent allies can affect this result. Establish geometry before
    // consulting their effective Ability projection so distant sheets do not
    // inflate optimistic-concurrency scope.
    if (ptuGridDistanceBetweenFootprints(provider, input.recipient.token) !== 1) continue
    consultedPlacementIds.push(provider.id)
    if (!hasEffectiveWeatherAbility({
      context: input.context,
      placementId: provider.id,
      ability,
    })) continue
    return {
      blockedBy: `${ability} (${provider.id})`,
      consultedPlacementIds,
    }
  }
  return { blockedBy: null, consultedPlacementIds }
}

/** Resolve canonical type, self-ability, and adjacent-ally weather immunity. */
export const resolveWeatherResidualImmunity = (input: {
  readonly weatherKind: WeatherResidualKind
  readonly context: AuthoritativeMoveRulesContext
  readonly recipient: MoveCoreTokenEffectRecipient
}): MoveCoreTokenEffectImmunityDecision => {
  const types = normalizedTypes(input.recipient)
  const immuneType = WEATHER_RESIDUAL_IMMUNE_TYPES[input.weatherKind]
    .find(type => types.has(type))
  if (immuneType) {
    return {
      blockedBy: `${immuneType[0]!.toUpperCase()}${immuneType.slice(1)} type`,
      consultedPlacementIds: [],
    }
  }
  if (input.weatherKind === 'sandstorm'
    && input.context.queries.abilities.has(input.recipient.placement.id, 'Desert Weather')) {
    return { blockedBy: 'Desert Weather', consultedPlacementIds: [] }
  }
  if (input.weatherKind === 'hail'
    && input.context.queries.abilities.has(input.recipient.placement.id, 'Ice Face')) {
    return { blockedBy: 'Ice Face', consultedPlacementIds: [] }
  }

  if (input.context.queries.abilities.has(input.recipient.placement.id, 'Magic Guard')) {
    return { blockedBy: 'Magic Guard', consultedPlacementIds: [] }
  }
  const directAbility = [
    ...UNIVERSAL_WEATHER_IMMUNITY_ABILITIES.filter(ability => ability !== 'Magic Guard'),
    ...WEATHER_SELF_IMMUNITY_ABILITIES[input.weatherKind].filter(ability => ability !== 'Ice Face'),
  ].find(ability => hasEffectiveWeatherAbility({
    context: input.context,
    placementId: input.recipient.placement.id,
    ability,
  })) ?? null
  if (directAbility) return { blockedBy: directAbility, consultedPlacementIds: [] }

  return adjacentAllyAbilityImmunity(input)
}

/** Decorate only built-in weather HP operations; every other query is delegated. */
export const createWeatherLifecycleImmunityQueries = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly fallback: MoveCoreTokenEffectImmunityQueries
}): MoveCoreTokenEffectImmunityQueries => {
  const queries: MoveCoreTokenEffectImmunityQueries = {
    directHp: (query) => {
      const weatherKind = weatherResidualKindForOperation(query.operation)
      if (weatherKind === null) return input.fallback.directHp(query)
      const equipmentBlocker = equipmentHpChangePreventionReason({
        context: input.context,
        placementId: query.recipient.placement.id,
        reasonCode: query.operation.reasonCode,
      })
      return equipmentBlocker
        ? { blockedBy: equipmentBlocker, consultedPlacementIds: [] }
        : resolveWeatherResidualImmunity({
            weatherKind,
            context: input.context,
            recipient: query.recipient,
          })
    },
    condition: input.fallback.condition,
    combatStage: input.fallback.combatStage,
  }
  return Object.freeze(queries)
}
