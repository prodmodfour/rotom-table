import { createHash } from 'node:crypto'
import type {
  MoveDirectHpEffectOperation,
  MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type { TabletopMap } from '~/types/map'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'
import type {
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerHandler,
} from '../../moveAutomation/reduceLifecycle'

export const AA068_DRY_SKIN_SUNNY_TURN_END_REASON = 'ability.dry-skin.sunny-turn-end' as const
export const AA068_DRY_SKIN_RAINY_TURN_END_REASON = 'ability.dry-skin.rainy-turn-end' as const

const suffix = (eventId: string, recipientId: string, weather: string): string => createHash('sha256')
  .update(`${eventId}\u0000${recipientId}\u0000${weather}`)
  .digest('hex')
  .slice(0, 24)

const hpLoss = (input: {
  readonly eventId: string
  readonly recipientId: string
}): MoveDirectHpEffectOperation => ({
  id: `ability.dry-skin.sunny.${suffix(input.eventId, input.recipientId, 'sunny')}`,
  kind: 'direct-hp',
  source: { kind: 'lifecycle-event', id: input.eventId },
  recipients: { kind: 'actor' },
  phase: 'cleanup',
  reasonCode: AA068_DRY_SKIN_SUNNY_TURN_END_REASON,
  payload: {
    mode: 'lose', pool: 'hit-points',
    calculation: { kind: 'percent-max', percent: 10 },
    copySource: null,
    bounds: { minimum: 0, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: false,
    cost: null,
    injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
  },
})

const healing = (input: {
  readonly eventId: string
  readonly recipientId: string
}): MoveHealEffectOperation => ({
  id: `ability.dry-skin.rainy.${suffix(input.eventId, input.recipientId, 'rainy')}`,
  kind: 'heal',
  source: { kind: 'lifecycle-event', id: input.eventId },
  recipients: { kind: 'actor' },
  phase: 'cleanup',
  reasonCode: AA068_DRY_SKIN_RAINY_TURN_END_REASON,
  payload: {
    mode: 'gain', pool: 'hit-points',
    calculation: { kind: 'percent-max', percent: 10 },
    bounds: { minimum: 0, maximum: null },
    rounding: 'floor',
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
})

export const aa068DrySkinLifecycleRecipientIds = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: { readonly reasonCode: string }
  readonly candidateRecipientIds: readonly string[]
}): readonly string[] => (
  input.operation.reasonCode === AA068_DRY_SKIN_SUNNY_TURN_END_REASON
  || input.operation.reasonCode === AA068_DRY_SKIN_RAINY_TURN_END_REASON
)
  ? input.candidateRecipientIds.filter(id => input.context.queries.abilities.has(id, 'Dry Skin'))
  : input.candidateRecipientIds

/** Turn-end Dry Skin Weather clauses; effective owners are supplied by the caller. */
export const createAa068DrySkinLifecycleHandler = (input: {
  readonly map: TabletopMap
  readonly drySkinPlacementIds: readonly string[]
}): EncounterLifecycleTriggerHandler => {
  const owners = new Set(input.drySkinPlacementIds)
  const weather = createMoveAutomationWeatherResolver(input.map).active()
  const sunny = weather.some(candidate => candidate.kind === 'sunny')
  const rainy = weather.some(candidate => candidate.kind === 'rainy')
  return Object.freeze({
    id: 'handler.ability.aa068.dry-skin',
    resolve: ({ event }: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]) => {
      if (event.kind !== 'turn-end' || !owners.has(event.placementId)) return []
      const triggers: EncounterLifecycleTrigger[] = []
      if (sunny) triggers.push({
        effectId: null,
        reasonCode: `${AA068_DRY_SKIN_SUNNY_TURN_END_REASON}-trigger`,
        operations: [hpLoss({ eventId: event.eventId, recipientId: event.placementId })],
        emittedEvents: [],
      })
      if (rainy) triggers.push({
        effectId: null,
        reasonCode: `${AA068_DRY_SKIN_RAINY_TURN_END_REASON}-trigger`,
        operations: [healing({ eventId: event.eventId, recipientId: event.placementId })],
        emittedEvents: [],
      })
      return triggers
    },
  })
}
