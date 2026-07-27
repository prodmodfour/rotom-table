import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDamageEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveHealEffectOperation,
  MoveHazardEffectOperation,
  MoveMultiHitEffectOperation,
  MoveMovementRequestEffectOperation,
  MoveNestedMoveEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveRollEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import type { PokemonTypeId } from '#shared/pokemonTypes'
import pokedexData from '../../../../data/reference/pokedex.json'
import { findMove } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PokedexRecord } from '~/types/pokemon'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { computeTickValue } from '~/utils/ptuHp'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { moveUsageKey } from '~/utils/moveUsage'

import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveSpecResponseResolver } from '../../moveAutomation/responses'
import { planMoveUsageTransition } from '../../planMoveUsageTransition'
import { activelyCommandingTrainerPlacementId } from '../../moveAutomation/activePokemonCommands'
import { reviewedNestedMoveInvocationAvailable } from '../../moveAutomation/reviewedNestedMoveTargeting'
import { abilityIsCopyable, abilityIsTransferable } from '../effectiveAbilities'
import { abilityRequiresInstanceParameters } from '../instanceParameters'
import { aa085to100StraightLineMovementToward } from './aa085to100StaticIntegration'

export const AA085TO100_REASON_PREFIX = 'ability.remaining.' as const
export const AA085_REFRIGERATE_REASON = 'ability.refrigerate.optional-ice-type' as const
export const AA085_RKS_SYSTEM_REASON = 'ability.rks-system.optional-normal-defense' as const
export const AA085_QUICK_DRAW_REASON = 'ability.quick-draw.optional-interrupt' as const
export const AA085_QUEENLY_MAJESTY_REASON = 'ability.queenly-majesty.optional-stomp' as const
export const AA086_RATTLED_REASON = 'ability.rattled.optional-boost' as const
export const AA086_REVELATION_REASON = 'ability.revelation.optional-copy' as const
export const AA088_SAP_SIPPER_REASON = 'ability.sap-sipper.optional-stage' as const
export const AA088_SEQUENCE_REASON = 'ability.sequence.optional-damage' as const
export const AA088_SAP_SIPPER_ATTACK_OPTION_ID = 'ability.sap-sipper.attack' as const
export const AA088_SAP_SIPPER_SPECIAL_ATTACK_OPTION_ID = 'ability.sap-sipper.special-attack' as const
export const AA089_SHELL_CANNON_REASON = 'ability.shell-cannon.optional-boost' as const
export const AA089_SKILL_LINK_REASON = 'ability.skill-link.optional-five-hits' as const
export const AA090_SOLAR_POWER_REASON = 'ability.solar-power.optional-damage' as const
export const AA090_SOUL_HEART_REASON = 'ability.soul-heart.optional-boost' as const
export const AA091_SOULSTEALER_REASON = 'ability.soulstealer.optional-heal' as const
export const AA091_SPINNING_DANCE_REASON = 'ability.spinning-dance.optional-shift' as const
export const AA091_SPRAY_DOWN_REASON = 'ability.spray-down.optional-ground' as const
export const AA092_STALWART_REASON = 'ability.stalwart.optional-stages' as const
export const AA092_STAMINA_REASON = 'ability.stamina.optional-defense' as const
export const AA092_STATIC_REASON = 'ability.static.optional-paralysis' as const
export const AA092_STEADFAST_REASON = 'ability.steadfast.optional-speed' as const
export const AA092_STEELWORKER_REASON = 'ability.steelworker.optional-steel-defense' as const
export const AA092_STICKY_SMOKE_REASON = 'ability.sticky-smoke.optional-zone' as const
export const AA093_STORM_DRAIN_REASON = 'ability.storm-drain.optional-redirection' as const
export const AA093_STORM_DRAIN_OPTION_ID = 'ability.storm-drain.redirect' as const
export const AA093_SUMO_STANCE_REASON = 'ability.sumo-stance.optional-push' as const
export const AA093_SWAY_REASON = 'ability.sway.optional-reflect' as const
export const AA094_SYNCHRONIZE_REASON = 'ability.synchronize.optional-copy-condition' as const
export const AA094_TANGLING_HAIR_REASON = 'ability.tangling-hair.optional-slow' as const
export const AA095_THUNDER_BOOST_REASON = 'ability.thunder-boost.optional-damage' as const
export const AA095_THUNDER_BOOST_OPTION_ID = 'ability.thunder-boost.apply' as const
export const AA095_TINGLE_REASON = 'ability.tingle.optional-debuff' as const
export const AA095_TINGLY_TONGUE_REASON = 'ability.tingly-tongue.optional-lick' as const
export const AA095_TONGUELASH_REASON = 'ability.tonguelash.optional-lick' as const
export const AA096_TRANSISTOR_REASON = 'ability.transistor.optional-vulnerability' as const
export const AA096_TRANSPORTER_REASON = 'ability.transporter.optional-teleport' as const
export const AA096_TRINITY_REASON = 'ability.trinity.optional-damage-class' as const
export const AA096_TRINITY_PHYSICAL_OPTION_ID = 'ability.trinity.physical' as const
export const AA096_TRINITY_SPECIAL_OPTION_ID = 'ability.trinity.special' as const
export const AA097_VICIOUS_REASON = 'ability.vicious.optional-branch' as const
export const AA097_VIGOR_REASON = 'ability.vigor.optional-heal' as const
export const AA098_VOODOO_DOLL_REASON = 'ability.voodoo-doll.optional-curse' as const
export const AA098_WANDERING_SPIRIT_REASON = 'ability.wandering-spirit.optional-swap' as const
export const AA098_WASH_AWAY_REASON = 'ability.wash-away.optional-reset' as const
export const AA098_WATER_COMPACTION_REASON = 'ability.water-compaction.optional-defense' as const
export const AA098_WEAK_ARMOR_REASON = 'ability.weak-armor.optional-stages' as const
export const AA098_WEEBLE_REASON = 'ability.weeble.optional-retaliation' as const
export const AA098_WEAPONIZE_REASON = 'ability.weaponize.optional-intercept' as const
export const AA098_WALLMASTER_REASON = 'ability.wallmaster.optional-barrier-effect' as const
export const AA099_WIND_POWER_REASON = 'ability.wind-power.optional-charge' as const
export const AA099_WISHMASTER_REASON = 'ability.wishmaster.optional-wish-effect' as const
export const AA099_WISTFUL_MELODY_REASON = 'ability.wistful-melody.optional-stages' as const
export const AA099_WOBBLE_REASON = 'ability.wobble.optional-counter' as const

const hash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)
const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')

const currentOffensiveStat = (
  context: AuthoritativeMoveRulesContext,
  stat: 'attack' | 'special-attack',
): number => Math.max(0, context.queries.stats.resolve(context.actor.placement.id, {
  stat,
  combatStagePolicy: 'honor',
  stageModifierPolicy: 'honor',
})?.value ?? (stat === 'attack' ? context.actor.token.atk : context.actor.token.satk))

const instance = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  canonicalId: string,
): string | null => context.queries.abilities.activeForPlacement(placementId)
  .find(ability => ability.canonicalId === canonicalId)?.instanceId ?? null

const SCENE_USE_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  'Queenly Majesty': 2,
  Revelation: 2,
  'Solar Power': 2,
  'Soul Heart': 2,
  'Sound Lance': 2,
  'Spray Down': 2,
  'Steam Engine': 2,
  'Tingly Tongue': 2,
  Tonguelash: 2,
  Transistor: 2,
})

const sceneAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly clauseId?: string
  readonly limit?: number
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  const entry = ledger?.entries.find(candidate => (
    candidate.ownerId === input.ownerId
    && candidate.abilityInstanceId === input.abilityInstanceId
    && candidate.canonicalId === input.canonicalId
    && candidate.clauseId === (input.clauseId ?? 'base')
  ))
  const limit = input.limit ?? entry?.limit ?? SCENE_USE_LIMITS[input.canonicalId] ?? 1
  return (entry?.spent ?? 0) < limit
}

const moveFrequencyAvailable = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  moveName: string,
): boolean => {
  const placement = context.queries.placements.get(placementId)
  const resolved = placement ? context.queries.sheets.forPlacement(placement) : null
  const canonical = findMove(moveName)
  const moveKey = canonical ? moveUsageKey(canonical.name) : null
  if (!placement || !resolved || !canonical || !moveKey) return false
  try {
    return planMoveUsageTransition({
      map: context.map,
      sheetMoveUsage: resolved.sheet.moveUsage,
      placementId,
      move: {
        moveName: canonical.name,
        moveKey,
        frequency: canonical.frequency,
      },
    }).previousUsage.available
  }
  catch {
    return false
  }
}

const triggerSource = (
  requirement: 'attacked' | 'damaged' | 'fainted' | 'hit' | 'massive' | 'missed',
  targetId: string,
): string => `ability.remaining.trigger:${requirement}:${targetId}`

export interface Aa085To100TriggerRequirement {
  readonly requirement: 'attacked' | 'damaged' | 'fainted' | 'hit' | 'massive' | 'missed'
  readonly targetId: string
}

/** Recover the server-owned trigger target from an operation or its response request. */
export const aa085to100TriggerRequirement = (input: {
  readonly operation: MoveEffectOperation
  readonly request?: MoveReactionRequestEffectOperation | null
}): Aa085To100TriggerRequirement | null => {
  const sourceId = input.operation.source.kind === 'lifecycle-event'
    ? input.operation.source.id
    : input.request?.source.kind === 'lifecycle-event'
      ? input.request.source.id : null
  const match = sourceId?.match(/^ability\.remaining\.trigger:(attacked|damaged|fainted|hit|massive|missed):(.+)$/)
  return match?.[1] && match[2]
    ? { requirement: match[1] as Aa085To100TriggerRequirement['requirement'], targetId: match[2] }
    : null
}

const request = (input: {
  readonly identity: string
  readonly canonicalId: string
  readonly reasonCode: string
  readonly ownerId: string
  readonly optionIds?: readonly string[]
  readonly phase: MoveReactionRequestEffectOperation['phase']
  readonly timing: MoveReactionRequestEffectOperation['payload']['timing']
  readonly priority?: number
  readonly trigger?: Aa085To100TriggerRequirement
  /** Distinguishes multiple exact source events for one owner/reason in a resolution. */
  readonly requestKey?: string
}): MoveReactionRequestEffectOperation => {
  const suffix = hash(input.identity, input.canonicalId, input.ownerId, input.reasonCode,
    input.trigger?.targetId ?? 'none', input.requestKey ?? 'default')
  const id = `ability.${slug(input.canonicalId)}.request.${suffix}`
  return {
    id,
    kind: 'reaction-request',
    source: input.trigger
      ? { kind: 'lifecycle-event', id: triggerSource(input.trigger.requirement, input.trigger.targetId) }
      : { kind: 'move', id: input.identity },
    recipients: { kind: 'none' },
    phase: input.phase,
    reasonCode: input.reasonCode,
    payload: {
      requestId: `${id}.response`,
      promptKey: `${input.reasonCode}.prompt`,
      options: (input.optionIds ?? [`${input.reasonCode}.use`]).map(optionId => ({
        id: optionId, labelKey: optionId,
      })),
      allowPass: true,
      timing: input.timing,
      priority: input.priority ?? 70,
      ownerPlacementIds: [input.ownerId],
    },
  }
}

const stage = (input: {
  readonly id: string
  readonly source: MoveEffectOperation['source']
  readonly recipients: MoveCombatStageEffectOperation['recipients']['kind']
  readonly reasonCode: string
  readonly stat: 'atk' | 'def' | 'satk' | 'sdef' | 'spd'
  readonly value: number
  readonly phase?: MoveCombatStageEffectOperation['phase']
  readonly trigger?: MoveCombatStageEffectOperation['payload']['trigger']
}): MoveCombatStageEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'combat-stage', source: input.source,
  recipients: { kind: input.recipients }, phase: input.phase ?? 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    action: 'modify', stage: input.stat, selectedStage: null, value: input.value,
    stageSource: null, rounding: null,
    ...(input.trigger ? { trigger: input.trigger } : {}),
  },
}, input.id) as MoveCombatStageEffectOperation

const condition = (input: {
  readonly id: string
  readonly source: MoveEffectOperation['source']
  readonly recipients: MoveConditionEffectOperation['recipients']['kind']
  readonly reasonCode: string
  readonly conditionId: string
  readonly phase?: MoveConditionEffectOperation['phase']
  readonly rounds?: number
  readonly duration?: Record<string, unknown>
  readonly sourcePlacementId?: string
  readonly accuracyRollId?: string | null
  readonly minimum?: number
}): MoveConditionEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'condition', source: input.source,
  recipients: { kind: input.recipients }, phase: input.phase ?? 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    action: 'apply', conditionId: slug(input.conditionId), conditionSource: null,
    filter: null, randomChoice: null,
    ...(input.accuracyRollId && input.minimum
      ? { accuracyRollTrigger: {
          rollId: input.accuracyRollId,
          trigger: { kind: 'range', minimum: input.minimum },
        } }
      : {}),
    duration: input.duration || input.rounds
      ? {
          effectId: `${input.id}.duration`,
          ...(input.sourcePlacementId ? { sourcePlacementId: input.sourcePlacementId } : {}),
          duration: input.duration ?? { kind: 'rounds', boundary: 'end', remaining: input.rounds },
          transferPolicy: 'expire',
        }
      : null,
    saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
  },
}, input.id) as MoveConditionEffectOperation

const directHp = (input: {
  readonly id: string
  readonly source: MoveEffectOperation['source']
  readonly recipients: MoveDirectHpEffectOperation['recipients']['kind']
  readonly reasonCode: string
  readonly calculation: MoveDirectHpEffectOperation['payload']['calculation']
  readonly mode?: 'lose'
  readonly pool?: 'hit-points' | 'temporary-hit-points'
  readonly phase?: MoveDirectHpEffectOperation['phase']
  readonly accuracyRollId?: string | null
}): MoveDirectHpEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'direct-hp', source: input.source,
  recipients: { kind: input.recipients }, phase: input.phase ?? 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    mode: input.mode ?? 'lose', pool: input.pool ?? 'hit-points',
    calculation: input.calculation, copySource: null,
    ...(input.accuracyRollId ? { accuracyRollId: input.accuracyRollId } : {}),
    bounds: { minimum: 0, maximum: null }, rounding: 'floor',
    applyTypeImmunity: false, cost: null,
    injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
  },
}, input.id) as MoveDirectHpEffectOperation

const heal = (input: {
  readonly id: string
  readonly source: MoveEffectOperation['source']
  readonly recipients: MoveHealEffectOperation['recipients']['kind']
  readonly reasonCode: string
  readonly percent?: number
  readonly value?: number
  readonly pool?: 'hit-points' | 'temporary-hit-points'
  readonly phase?: MoveHealEffectOperation['phase']
}): MoveHealEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'heal', source: input.source,
  recipients: { kind: input.recipients }, phase: input.phase ?? 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    mode: 'gain', pool: input.pool ?? 'hit-points',
    calculation: input.percent !== undefined
      ? { kind: 'percent-max', percent: input.percent }
      : { kind: 'fixed', value: input.value ?? 0 },
    bounds: { minimum: 0, maximum: null }, rounding: 'floor',
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
}, input.id) as MoveHealEffectOperation

const temporary = (input: {
  readonly id: string
  readonly source: MoveEffectOperation['source']
  readonly recipients: MoveTemporaryEffectOperation['recipients']['kind']
  readonly reasonCode: string
  readonly tag: string
  readonly kind?: 'capability' | 'creature-rule-overlay' | 'numeric-modifier'
  readonly payload: Record<string, unknown>
  readonly duration?: Record<string, unknown>
  readonly phase?: MoveTemporaryEffectOperation['phase']
}): MoveTemporaryEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'temporary-effect', source: input.source,
  recipients: { kind: input.recipients }, phase: input.phase ?? 'schedule',
  reasonCode: input.reasonCode,
  payload: {
    action: 'add', effectId: input.id, recipientScope: 'placements',
    definition: {
      kind: input.kind ?? 'capability',
      duration: input.duration ?? { kind: 'rounds', boundary: 'end', remaining: 1 },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'remaining-catalog', input.tag],
      payload: input.payload,
      dispel: { policy: 'matching-tags', tags: [input.tag] },
      transferPolicy: 'expire',
    },
  },
}, input.id) as MoveTemporaryEffectOperation

const nested = (input: {
  readonly id: string
  readonly requestId: string
  readonly canonicalId: string
  readonly reasonCode: string
  readonly recipients?: MoveNestedMoveEffectOperation['recipients']['kind']
  readonly phase?: MoveNestedMoveEffectOperation['phase']
  readonly targeting?: 'fresh-choice' | 'operation-recipients'
}): MoveNestedMoveEffectOperation => ({
  id: input.id,
  kind: 'nested-move', source: { kind: 'operation', id: input.requestId },
  recipients: { kind: input.recipients ?? 'response-owner' },
  phase: input.phase ?? 'cleanup', reasonCode: input.reasonCode,
  payload: {
    canonicalId: input.canonicalId,
    actor: { kind: 'response-owner' },
    source: { kind: 'registered-spec' },
    targeting: input.targeting === 'operation-recipients'
      ? { kind: 'operation-recipients' }
      : {
          kind: 'fresh-choice', requestId: `${input.id}.target`,
          promptKey: `${input.reasonCode}.target`, selector: { kind: 'candidate-targets' },
        },
  },
})

const selectedRequests = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
  readonly reasonCode: string
}): readonly MoveReactionRequestEffectOperation[] => input.operations.flatMap((operation) => {
  if (operation.kind !== 'reaction-request' || operation.reasonCode !== input.reasonCode) return []
  const response = input.responses.resolve({
    requestId: operation.payload.requestId,
    options: operation.payload.options,
    allowPass: operation.payload.allowPass,
  })
  return response?.optionId ? [operation] : []
})

const selectedRequest = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
  readonly reasonCode: string
}): MoveReactionRequestEffectOperation | null => selectedRequests(input)[0] ?? null

const accuracyRollId = (operations: readonly MoveEffectOperation[]): string | null => operations.flatMap(operation => (
  operation.kind === 'damage' && operation.payload.accuracyRollId
    ? [operation.payload.accuracyRollId]
    : operation.kind === 'multi-hit' && operation.payload.accuracy.kind !== 'automatic'
      ? [operation.payload.accuracy.rollId]
      : operation.kind === 'roll' && operation.phase === 'accuracy'
        ? [operation.payload.rollId]
        : []
))[0] ?? null

const faintReactionOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly identity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const triggerProviders = input.context.queries.tokens.all().filter(provider => (
    provider.currentHp > 0
    && (instance(input.context, provider.id, 'Receiver') !== null
      || instance(input.context, provider.id, 'Soul Heart') !== null)
  ))
  const hasOwnFaintReceiver = input.targetIds.some(targetId => (
    instance(input.context, targetId, 'Receiver') !== null
  ))
  if (triggerProviders.length === 0 && !hasOwnFaintReceiver) return operations
  for (const faintCandidate of input.targetIds) {
    const faintedToken = input.context.queries.tokens.get(faintCandidate)
    const receiverOwnerId = instance(input.context, faintCandidate, 'Receiver')
    const faintedPlacement = receiverOwnerId
      ? input.context.queries.placements.get(faintCandidate) : null
    const faintedSheet = faintedPlacement
      ? input.context.queries.sheets.forPlacement(faintedPlacement) : null
    const species = faintedSheet?.kind === 'pokemon'
      ? (faintedSheet.sheet as CharacterSheet).species.trim().toLowerCase() : null
    const basicAbilityNames = species
      ? ((pokedexData as readonly PokedexRecord[]).find(entry => (
          entry.species.trim().toLowerCase() === species
        ))?.abilities?.basic ?? [])
      : []
    const grantableBasics = input.context.queries.abilities.activeForPlacement(faintCandidate)
      .filter(candidate => basicAbilityNames.includes(candidate.canonicalId)
        && candidate.canonicalId !== 'Receiver'
        && abilityIsCopyable(candidate.canonicalId))
      .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
    const livingAllies = receiverOwnerId ? input.context.queries.tokens.all().filter(candidate => (
      candidate.id !== faintCandidate
      && candidate.currentHp > 0
      && input.context.queries.relationships.resolve(faintCandidate, candidate.id).relationship === 'ally'
    )).sort((left, right) => left.id.localeCompare(right.id)) : []
    if (receiverOwnerId && grantableBasics.length > 0 && livingAllies.length > 0
      && input.context.queries.resources.actionAvailable(faintCandidate, 'free')
      && sceneAvailable({
        context: input.context, ownerId: faintCandidate, abilityInstanceId: receiverOwnerId,
        canonicalId: 'Receiver', clauseId: 'grant-on-faint', limit: 1,
      })) {
      const grants = livingAllies.flatMap(ally => grantableBasics.map(granted => ({
        ally,
        granted,
        optionId: `ability.receiver.grant.${ally.id}.ability.${slug(granted.canonicalId)}.${hash(granted.instanceId)}`,
      })))
      const req = request({
        identity: input.identity,
        canonicalId: 'Receiver',
        reasonCode: 'ability.receiver.optional-grant',
        ownerId: faintCandidate,
        optionIds: grants.map(grant => grant.optionId),
        phase: 'cleanup', timing: 'cleanup', priority: 78,
        trigger: { requirement: 'fainted', targetId: faintCandidate },
      })
      operations.push(req, ...grants.map((grant) => {
        const operationId = `ability.receiver.grant.${hash(input.identity, faintCandidate, grant.ally.id, grant.granted.instanceId)}`
        const copiedInstanceId = `granted:${operationId}:0`
        return temporary({
          id: operationId,
          source: { kind: 'operation', id: req.id }, recipients: 'all-placements',
          reasonCode: grant.optionId, tag: 'aa086-receiver-grant',
          kind: 'creature-rule-overlay',
          payload: {
            domain: 'ability', action: 'add', values: [grant.granted.canonicalId],
            referencePlacementId: null, suppressionScope: null,
            abilitySnapshots: [{
              instanceId: copiedInstanceId,
              canonicalId: grant.granted.canonicalId,
              definitionHash: grant.granted.runtime.definitionHash,
              sourcePlacementId: faintCandidate,
              parameterStatus: grant.granted.parameterData
                ? 'ready'
                : abilityRequiresInstanceParameters(grant.granted.canonicalId)
                  ? 'missing-required-data'
                  : 'not-parameterized',
              parameterData: grant.granted.parameterData
                ? { ...grant.granted.parameterData, instanceId: copiedInstanceId }
                : null,
            }],
          },
          duration: { kind: 'scene', remaining: null },
          phase: 'cleanup',
        })
      }))
    }
    for (const provider of triggerProviders) {
    if (faintedToken && provider.id !== faintCandidate
      && input.context.queries.relationships.resolve(provider.id, faintCandidate).relationship === 'ally') {
      const receiverId = instance(input.context, provider.id, 'Receiver')
      const copyable = input.context.queries.abilities.activeForPlacement(faintCandidate)
        .filter(candidate => candidate.canonicalId !== 'Receiver'
          && abilityIsCopyable(candidate.canonicalId))
        .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
      if (receiverId && copyable.length > 0
        && input.context.queries.resources.actionAvailable(provider.id, 'free')
        && sceneAvailable({
          context: input.context, ownerId: provider.id, abilityInstanceId: receiverId,
          canonicalId: 'Receiver', clauseId: 'copy-on-ally-faint', limit: 1,
        })) {
        const optionIds = copyable.map(candidate => (
          `ability.receiver.copy.${slug(candidate.canonicalId)}.${hash(candidate.instanceId)}`
        ))
        const req = request({
          identity: input.identity, canonicalId: 'Receiver',
          reasonCode: 'ability.receiver.optional-copy', ownerId: provider.id,
          optionIds, phase: 'cleanup', timing: 'cleanup', priority: 77,
          trigger: { requirement: 'fainted', targetId: faintCandidate },
        })
        operations.push(req)
        copyable.forEach((candidate, index) => {
          const operationId = `ability.receiver.copy.${hash(input.identity, faintCandidate, provider.id, candidate.instanceId)}`
          const copiedInstanceId = `granted:${operationId}:0`
          operations.push(temporary({
            id: operationId,
            source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
            reasonCode: optionIds[index]!, tag: 'aa086-receiver-copy',
            kind: 'creature-rule-overlay',
            payload: {
              domain: 'ability', action: 'add', values: [candidate.canonicalId],
              referencePlacementId: null, suppressionScope: null,
              abilitySnapshots: [{
                instanceId: copiedInstanceId,
                canonicalId: candidate.canonicalId,
                definitionHash: candidate.runtime.definitionHash,
                sourcePlacementId: faintCandidate,
                parameterStatus: candidate.parameterData
                  ? 'ready'
                  : abilityRequiresInstanceParameters(candidate.canonicalId)
                    ? 'missing-required-data'
                    : 'not-parameterized',
                parameterData: candidate.parameterData
                  ? { ...candidate.parameterData, instanceId: copiedInstanceId }
                  : null,
              }],
            },
            duration: { kind: 'scene', remaining: null },
            phase: 'cleanup',
          }))
        })
      }
    }
    const abilityId = instance(input.context, provider.id, 'Soul Heart')
    if (!abilityId
      || !input.context.queries.resources.actionAvailable(provider.id, 'free')
      || !sceneAvailable({
        context: input.context, ownerId: provider.id, abilityInstanceId: abilityId,
        canonicalId: 'Soul Heart', limit: 2,
      })) continue
    const req = request({
      identity: input.identity, canonicalId: 'Soul Heart', reasonCode: AA090_SOUL_HEART_REASON,
      ownerId: provider.id, phase: 'cleanup', timing: 'cleanup', priority: 75,
      trigger: { requirement: 'fainted', targetId: faintCandidate },
    })
    operations.push(
      req,
      stage({
        id: `ability.soul-heart.satk.${hash(input.identity, faintCandidate, provider.id)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.soul-heart.special-attack', stat: 'satk', value: 2,
        phase: 'cleanup',
      }),
      heal({
        id: `ability.soul-heart.temporary-hp.${hash(input.identity, faintCandidate, provider.id)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.soul-heart.temporary-hp',
        pool: 'temporary-hit-points', percent: 10, phase: 'cleanup',
      }),
    )
    }
  }
  return operations
}

const conditionReactionOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly identity: string
  readonly targetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const eligible = new Set([
    'burned', 'frozen', 'paralysis', 'paralyzed', 'poisoned', 'badly-poisoned', 'sleep', 'asleep',
  ])
  for (const sourceOperation of input.reviewedOperations) {
    if (sourceOperation.kind !== 'condition' || sourceOperation.payload.action !== 'apply'
      || !sourceOperation.payload.conditionId) continue
    const conditionId = sourceOperation.payload.conditionId.trim().toLowerCase().replace(/\s+/g, '-')
    for (const targetId of input.targetIds) {
      if (conditionId === 'flinch' || conditionId === 'flinched') {
        const abilityId = instance(input.context, targetId, 'Steadfast')
        if (abilityId && input.context.queries.resources.actionAvailable(targetId, 'free')) {
          const req = {
            ...request({
              identity: input.identity, canonicalId: 'Steadfast', reasonCode: AA092_STEADFAST_REASON,
              ownerId: targetId, phase: 'cleanup', timing: 'cleanup', priority: 82,
              requestKey: sourceOperation.id,
            }),
            source: { kind: 'operation' as const, id: sourceOperation.id },
          }
          operations.push(req, stage({
            id: `ability.steadfast.speed.${hash(input.identity, targetId, sourceOperation.id)}`,
            source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
            reasonCode: 'ability.steadfast.speed', stat: 'spd', value: 1, phase: 'cleanup',
          }))
        }
      }
      if (!eligible.has(conditionId)
        || input.context.queries.relationships.resolve(actorId, targetId).relationship !== 'enemy') continue
      const abilityId = instance(input.context, targetId, 'Synchronize')
      if (!abilityId
        || !input.context.queries.resources.actionAvailable(targetId, 'free')
        || !sceneAvailable({
          context: input.context, ownerId: targetId, abilityInstanceId: abilityId,
          canonicalId: 'Synchronize',
        })) continue
      const req = {
        ...request({
          identity: input.identity, canonicalId: 'Synchronize', reasonCode: AA094_SYNCHRONIZE_REASON,
          ownerId: targetId, phase: 'cleanup', timing: 'cleanup', priority: 81,
          requestKey: sourceOperation.id,
        }),
        source: { kind: 'operation' as const, id: sourceOperation.id },
      }
      operations.push(req, condition({
        id: `ability.synchronize.condition.${hash(input.identity, targetId, sourceOperation.id)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'actor',
        reasonCode: 'ability.synchronize.copy-condition', conditionId, phase: 'cleanup',
      }))
    }
  }
  return operations
}

const staticEffectRangeOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
  readonly reviewedOperations: readonly MoveEffectOperation[]
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const operations: MoveEffectOperation[] = []
  // Handler-backed reviewed specs materialize their standard accuracy
  // operation after overlays are planned. Their roll identity is nevertheless
  // canonical and review-owned, so static hit riders can bind to it now.
  const rollId = accuracyRollId(input.reviewedOperations)
    ?? (input.script.requiresAccuracy ? `${slug(input.script.moveName)}.accuracy-roll` : null)
  if (rollId && input.script.damaging
    && input.script.damageClass?.trim().toLowerCase() === 'physical'
    && input.context.queries.abilities.has(actorId, 'Ragelope')) {
    const enraged = normalizeConditionNames(input.context.actor.token.conditions).includes('Rage')
    const suffix = hash(input.identity, 'ragelope')
    if (!enraged) operations.push(condition({
      id: `ability.ragelope.rage.${suffix}`,
      source: { kind: 'move', id: input.identity }, recipients: 'actor',
      reasonCode: 'ability.ragelope.enraged', conditionId: 'Rage',
      accuracyRollId: rollId, minimum: 18,
    }))
    operations.push(stage({
      id: `ability.ragelope.stage.${suffix}`,
      source: { kind: 'move', id: input.identity }, recipients: 'actor',
      reasonCode: enraged ? 'ability.ragelope.attack' : 'ability.ragelope.speed',
      stat: enraged ? 'atk' : 'spd', value: 1,
      trigger: {
        kind: 'accuracy-roll', rollId,
        trigger: { kind: 'range', minimum: 18 }, scope: 'resolution', application: 'once',
      },
    }))
  }
  const hasStench = rollId !== null && input.context.queries.abilities.has(actorId, 'Stench')
  const hasUgly = rollId !== null && input.context.queries.abilities.has(actorId, 'Ugly')
  if (rollId && (hasStench || hasUgly)) {
    const existingFlinch = input.reviewedOperations.find((operation): operation is MoveConditionEffectOperation => (
      operation.kind === 'condition'
      && ['flinch', 'flinched'].includes(operation.payload.conditionId?.trim().toLowerCase() ?? '')
    ))
    const grantedFlinch = existingFlinch ?? condition({
      id: `ability.${hasStench ? 'stench' : 'ugly'}.flinch.${hash(input.identity, hasStench ? 'stench' : 'ugly')}`,
      source: { kind: 'move', id: input.identity }, recipients: 'hit-targets',
      reasonCode: hasStench ? 'ability.stench.flinch' : 'ability.ugly.flinch',
      conditionId: 'Flinch', accuracyRollId: rollId,
      minimum: hasStench ? (hasUgly ? 16 : 18) : 19,
    })
    if (!existingFlinch) operations.push(grantedFlinch)
    if (hasStench) operations.push(temporary({
      id: `ability.stench.accuracy-penalty.${hash(input.identity, 'stench')}`,
      source: { kind: 'operation', id: grantedFlinch.id },
      recipients: 'hit-targets',
      reasonCode: 'ability.stench.flinch-accuracy-penalty',
      tag: 'aa092-stench-accuracy-penalty',
      kind: 'numeric-modifier',
      payload: { attribute: 'accuracy', operation: 'add', value: -2, rounding: 'none' },
      duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
    }))
  }
  if (input.script.moveName.trim().toLowerCase() === 'tri attack'
    && input.context.queries.abilities.has(actorId, 'Trinity')) {
    operations.push(request({
      identity: input.identity,
      canonicalId: 'Trinity',
      reasonCode: AA096_TRINITY_REASON,
      ownerId: actorId,
      optionIds: [AA096_TRINITY_SPECIAL_OPTION_ID, AA096_TRINITY_PHYSICAL_OPTION_ID],
      phase: 'declare',
      timing: 'declare',
      priority: 95,
    }))
    const trinityConditions = ['Frozen', 'Burned', 'Paralysis'] as const
    if (rollId) input.targetIds.slice(0, 3).forEach((targetId, index) => {
      operations.push(condition({
        id: `ability.trinity.condition.${index + 1}.${hash(input.identity, targetId)}`,
        source: { kind: 'lifecycle-event', id: triggerSource('hit', targetId) },
        recipients: 'hit-targets',
        reasonCode: `ability.trinity.condition.${index + 1}`,
        conditionId: trinityConditions[index]!,
        accuracyRollId: rollId,
        minimum: 17,
      }))
    })
  }
  if (input.script.moveName.trim().toLowerCase() === 'string shot'
    && input.context.queries.abilities.has(actorId, 'Silk Threads')) {
    const suffix = hash(input.identity, 'silk-threads')
    operations.push(
      condition({
        id: `ability.silk-threads.slowed.${suffix}`,
        source: { kind: 'move', id: input.identity }, recipients: 'hit-targets',
        reasonCode: 'ability.silk-threads.slowed', conditionId: 'Slowed',
        duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
      }),
      condition({
        id: `ability.silk-threads.vulnerable.${suffix}`,
        source: { kind: 'move', id: input.identity }, recipients: 'hit-targets',
        reasonCode: 'ability.silk-threads.vulnerable', conditionId: 'Vulnerable',
        duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
      }),
    )
  }
  const stanceChangeAegislash = input.context.actor.sheet.kind === 'pokemon'
    && (input.context.actor.sheet.sheet as CharacterSheet).species
      .trim().toLowerCase().includes('aegislash')
  if (stanceChangeAegislash && input.context.queries.abilities.has(actorId, 'Stance Change')) {
    const shieldMove = ['king’s shield', "king's shield", 'protect'].includes(input.script.moveName.trim().toLowerCase())
      || input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'blessing')
      || (input.script.damageClass?.trim().toLowerCase() === 'status'
        && (/(?:raise|gain).*(?:defense|special defense)|blessing/i.test(input.script.effect)
          || input.reviewedOperations.some(operation => (
            operation.kind === 'combat-stage'
            && operation.payload.action === 'modify'
            && (operation.payload.stage === 'def' || operation.payload.stage === 'sdef')
            && (operation.payload.value ?? 0) > 0
          ))))
    if (input.script.damaging || shieldMove) {
      const desiredTag = shieldMove ? 'aa092-stance-change-shield' : 'aa092-stance-change-sword'
      const staleStances = input.context.map.encounterState?.effects.filter(effect => (
        effect.affected.placementIds.includes(actorId)
        && effect.tags.some(tag => (
          tag === 'aa092-stance-change-shield' || tag === 'aa092-stance-change-sword'
        ))
        && !effect.tags.includes(desiredTag)
      )) ?? []
      for (const stale of staleStances) operations.push({
        id: `ability.stance-change.remove.${hash(input.identity, stale.id)}`,
        kind: 'temporary-effect', source: { kind: 'move', id: input.identity },
        recipients: { kind: 'actor' }, phase: 'schedule',
        reasonCode: 'ability.stance-change.remove-previous-stance',
        payload: { action: 'remove', effectId: stale.id },
      } as MoveTemporaryEffectOperation)
      operations.push(temporary({
      id: `ability.stance-change.form.${hash(input.identity, shieldMove ? 'shield' : 'sword')}`,
      source: { kind: 'move', id: input.identity }, recipients: 'actor',
      reasonCode: `ability.stance-change.${shieldMove ? 'shield' : 'sword'}`,
      tag: shieldMove ? 'aa092-stance-change-shield' : 'aa092-stance-change-sword',
      kind: 'capability',
      payload: {
        capabilityId: shieldMove ? 'aa092.stance-change.shield' : 'aa092.stance-change.sword',
        action: 'grant',
      },
      duration: { kind: 'scene', remaining: null },
    }))
    }
  }
  if (input.context.queries.abilities.has(actorId, 'Soothing Tone')) {
    for (const targetId of input.targetIds) {
      if (input.context.queries.relationships.resolve(actorId, targetId).relationship !== 'ally'
        || input.context.map.encounterState?.effects.some(effect => (
          effect.tags.includes('aa090-soothing-tone-used')
          && effect.affected.placementIds.includes(targetId)
          && effect.source.placementId === actorId
          && effect.suppression.sources.length === 0
        ))) continue
      const source = { kind: 'lifecycle-event' as const, id: triggerSource('attacked', targetId) }
      const suffix = hash(input.identity, targetId)
      operations.push(
        heal({
          id: `ability.soothing-tone.temporary-hp.${suffix}`, source,
          recipients: 'attacked-targets', reasonCode: 'ability.soothing-tone.temporary-hp',
          pool: 'temporary-hit-points',
          value: currentOffensiveStat(input.context, 'special-attack'),
        }),
        temporary({
          id: `ability.soothing-tone.used.${suffix}`, source,
          recipients: 'attacked-targets', reasonCode: 'ability.soothing-tone.used-marker',
          tag: 'aa090-soothing-tone-used',
          payload: { capabilityId: 'aa090.soothing-tone.used', action: 'grant' },
          duration: { kind: 'scene', remaining: null },
        }),
      )
    }
  }
  const moveConsultsAttack = input.reviewedOperations.some(operation => (
    operation.kind === 'damage' && operation.payload.damageClass === 'physical'
    || operation.kind === 'multi-hit' && operation.payload.damage.damageClass === 'physical'
  ))
  if (input.context.queries.abilities.has(actorId, 'Thrust')
    && input.script.damaging
    && moveConsultsAttack
    && !input.reviewedOperations.some(operation => (
      operation.kind === 'movement-request'
      && operation.payload.mode === 'forced'
      && operation.payload.displacement?.vector.kind === 'away'
    ))) {
    const damage = input.reviewedOperations.find(operation => (
      operation.kind === 'damage' || operation.kind === 'multi-hit'
    ))
    if (damage) operations.push({
      id: `ability.thrust.push.${hash(input.identity)}`,
      kind: 'movement-request', source: { kind: 'operation', id: damage.id },
      recipients: { kind: 'damaged-targets' }, phase: 'movement',
      reasonCode: 'ability.thrust.push',
      payload: {
        requestId: `ability.thrust.push.${hash(input.identity)}`,
        mode: 'forced', distance: 1, destinationSetId: null,
        displacement: {
          vector: { kind: 'away', source: { kind: 'actor' } },
          distancePolicy: 'up-to-distance', opportunityAttacks: 'ignore',
        },
      },
    } as MoveMovementRequestEffectOperation)
  }
  if (input.context.queries.abilities.has(actorId, 'Type Strategist')) {
    const ability = input.context.queries.abilities.activeForPlacement(actorId)
      .find(candidate => candidate.canonicalId === 'Type Strategist')
    const parameterType = ability?.parameterData?.selections
      .find(parameter => parameter.parameterId === 'type')?.optionIds[0]
    if (parameterType && parameterType === input.script.type.trim().toLowerCase()) operations.push(temporary({
      id: `ability.type-strategist.dr.${hash(input.identity, input.script.type)}`,
      source: { kind: 'move', id: input.identity }, recipients: 'actor',
      reasonCode: 'ability.type-strategist.damage-reduction', tag: 'aa096-type-strategist',
      kind: 'capability', payload: { capabilityId: 'aa096.type-strategist.dr', action: 'grant' },
      duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
    }))
  }
  const starswirl = input.script.moveName.trim().toLowerCase() === 'rapid spin'
    ? input.context.map.encounterState?.effects.find(effect => (
        effect.tags.includes('aa092-starswirl-rapid-spin')
        && effect.affected.placementIds.includes(actorId)
        && effect.suppression.sources.length === 0
        && (effect.duration.remaining === null || effect.duration.remaining > 0)
      ))
    : null
  if (starswirl) operations.push(parseMoveEffectOperation({
    id: `ability.starswirl.consume.${hash(input.identity, starswirl.id)}`,
    kind: 'temporary-effect', source: { kind: 'move', id: input.identity },
    recipients: { kind: 'actor' }, phase: 'cleanup',
    reasonCode: 'ability.starswirl.consume-rapid-spin-grant',
    payload: { action: 'remove', effectId: starswirl.id },
  }, 'aa092.starswirl.consume') as MoveTemporaryEffectOperation)
  const lockOn = input.script.requiresAccuracy === true
    ? input.context.map.encounterState?.effects.find(effect => (
        effect.tags.includes('aa094-targeting-system-lock-on')
        && effect.source.placementId === actorId
        && effect.affected.placementIds.includes(actorId)
        && input.targetIds.some(targetId => effect.affected.placementIds.includes(targetId))
        && effect.suppression.sources.length === 0
        && (effect.duration.remaining === null || effect.duration.remaining > 0)
      ))
    : null
  if (lockOn) operations.push({
    id: `ability.targeting-system.consume.${hash(input.identity, lockOn.id)}`,
    kind: 'temporary-effect',
    source: { kind: 'move', id: input.identity },
    recipients: { kind: 'actor' },
    phase: 'cleanup',
    reasonCode: 'ability.targeting-system.consume-lock-on',
    payload: { action: 'remove', effectId: lockOn.id },
  } as MoveTemporaryEffectOperation)
  if (input.script.type.trim().toLowerCase() === 'ice'
    && input.context.queries.abilities.has(actorId, 'Winter’s Kiss')) {
    operations.push(heal({
      id: `ability.winters-kiss.user-heal.${hash(input.identity, actorId)}`,
      source: { kind: 'move', id: input.identity }, recipients: 'actor',
      reasonCode: 'ability.winters-kiss.user-heal', percent: 10,
    }))
  }

  if (normalizeConditionNames(input.context.actor.token.conditions).includes('Confused')) {
    const tempoBypass = input.context.map.encounterState?.effects.find(effect => (
      effect.tags.includes('aa093-strange-tempo-ignore-confusion-check')
      && effect.affected.placementIds.includes(actorId)
      && effect.suppression.sources.length === 0
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
    ))
    if (tempoBypass) {
      operations.push(parseMoveEffectOperation({
        id: `ability.strange-tempo.consume.${hash(input.identity, tempoBypass.id)}`,
        kind: 'temporary-effect', source: { kind: 'move', id: input.identity },
        recipients: { kind: 'actor' }, phase: 'cleanup',
        reasonCode: 'ability.strange-tempo.consume-confusion-bypass',
        payload: { action: 'remove', effectId: tempoBypass.id },
      }, 'aa093.strangeTempo.consume') as MoveTemporaryEffectOperation)
    }
    else {
      const suffix = hash(input.identity, actorId, 'confusion-check')
      const rollOperationId = `condition.confusion.roll.${suffix}`
      const hpOperationId = `condition.confusion.hp-loss.${suffix}`
      const tableId = `condition.confusion.table.${suffix}`
      const damageClass = input.script.damageClass?.trim().toLowerCase()
      const calculation: MoveDirectHpEffectOperation['payload']['calculation'] = damageClass === 'physical'
        ? {
            kind: 'fixed',
            value: Math.floor(currentOffensiveStat(input.context, 'attack') / 2),
          }
        : damageClass === 'special'
          ? {
              kind: 'fixed',
              value: Math.floor(currentOffensiveStat(input.context, 'special-attack') / 2),
            }
          : { kind: 'percent-max', percent: 20 }
      operations.push(parseMoveEffectOperation({
        id: rollOperationId,
        kind: 'roll', source: { kind: 'move', id: input.identity },
        recipients: { kind: 'none' }, phase: 'after-damage',
        reasonCode: 'condition.confusion.attack-check',
        payload: {
          rollId: `${rollOperationId}.die`,
          formula: { kind: 'table', tableId },
          table: {
            tableId,
            distribution: 'weighted',
            entries: [
              { id: 'self-hit', weight: 1, operationIds: [hpOperationId], predicate: null },
              { id: 'act-normally', weight: 1, operationIds: [], predicate: null },
            ],
            maximumRerolls: 0,
          },
        },
      }, 'condition.confusion.roll') as MoveRollEffectOperation)
      operations.push(directHp({
        id: hpOperationId,
        source: { kind: 'operation', id: rollOperationId },
        recipients: 'actor', phase: 'after-damage',
        reasonCode: 'condition.confusion.self-hit-point-loss',
        calculation,
      }))
    }
  }
  return operations
}

const defensiveAutomaticOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const type = input.script.type.trim().toLowerCase()
  const melee = /\bmelee\b/i.test(input.script.range)
  for (const targetId of input.targetIds) {
    const token = input.context.queries.tokens.get(targetId)
    if (!token) continue
    const source = { kind: 'lifecycle-event' as const, id: triggerSource('hit', targetId) }
    const suffix = hash(input.identity, targetId)
    const schooling = input.context.map.encounterState?.effects.find(effect => (
      effect.tags.includes('aa088-schooling')
      && effect.affected.placementIds.includes(targetId)
      && effect.suppression.sources.length === 0
    ))
    if (schooling && input.script.damaging) operations.push({
      id: `ability.schooling.exit.${suffix}`,
      kind: 'temporary-effect',
      source: { kind: 'lifecycle-event', id: triggerSource('damaged', targetId) },
      recipients: { kind: 'damaged-targets' },
      phase: 'cleanup',
      reasonCode: 'ability.schooling.exit-solo-form',
      payload: { action: 'remove', effectId: schooling.id },
    } as MoveTemporaryEffectOperation)
    if (input.script.damaging
      && input.context.queries.abilities.has(targetId, 'Shields Down')) operations.push(temporary({
      id: `ability.shields-down.core.${suffix}`,
      source: { kind: 'lifecycle-event', id: triggerSource('damaged', targetId) },
      recipients: 'damaged-targets',
      reasonCode: 'ability.shields-down.enter-core-form',
      tag: 'aa089-shields-down-core',
      kind: 'creature-rule-overlay',
      payload: {
        domain: 'form', action: 'replace', value: 'minior-core',
        referencePlacementId: null,
      },
      duration: { kind: 'scene', remaining: null },
    }))
    const quickCloak = input.context.map.encounterState?.effects.find(effect => (
      effect.tags.includes('aa085-quick-cloak')
      && effect.affected.placementIds.includes(targetId)
      && effect.suppression.sources.length === 0
    ))
    if (quickCloak && input.script.damaging) operations.push({
      id: `ability.quick-cloak.break.${suffix}`,
      kind: 'temporary-effect',
      source: { kind: 'lifecycle-event', id: triggerSource('damaged', targetId) },
      recipients: { kind: 'damaged-targets' }, phase: 'cleanup',
      reasonCode: 'ability.quick-cloak.break-super-effective',
      payload: { action: 'remove', effectId: quickCloak.id },
    } as MoveTemporaryEffectOperation)
    if (type === 'water' && input.context.queries.abilities.has(targetId, 'Water Absorb')) {
      operations.push(heal({
        id: `ability.water-absorb.heal.${suffix}`, source, recipients: 'hit-targets',
        reasonCode: 'ability.water-absorb.heal', percent: 10,
      }))
    }
    if (type === 'electric' && input.context.queries.abilities.has(targetId, 'Volt Absorb')) {
      operations.push(heal({
        id: `ability.volt-absorb.heal.${suffix}`, source, recipients: 'hit-targets',
        reasonCode: 'ability.volt-absorb.heal', percent: 10,
      }))
    }
    if (type === 'ice' && input.context.queries.abilities.has(targetId, 'Winter’s Kiss')) {
      operations.push(heal({
        id: `ability.winters-kiss.target-heal.${suffix}`, source, recipients: 'hit-targets',
        reasonCode: 'ability.winters-kiss.target-heal', percent: 10,
      }))
    }
    if (type === 'flying' && input.context.queries.abilities.has(targetId, 'Windveiled')) {
      operations.push(stage({
        id: `ability.windveiled.speed.${suffix}`, source, recipients: 'hit-targets',
        reasonCode: 'ability.windveiled.speed', stat: 'spd', value: 1,
      }))
    }
    if (type === 'water' && input.context.queries.abilities.has(targetId, 'Water Compaction')) {
      const abilityId = instance(input.context, targetId, 'Water Compaction')!
      const req = request({
        identity: input.identity, canonicalId: 'Water Compaction',
        reasonCode: AA098_WATER_COMPACTION_REASON, ownerId: targetId,
        phase: 'hit', timing: 'post-hit', trigger: { requirement: 'hit', targetId },
      })
      if (input.context.queries.resources.actionAvailable(targetId, 'free')) operations.push(
        req,
        stage({
          id: `ability.water-compaction.defense.${suffix}.${hash(abilityId)}`,
          source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
          reasonCode: 'ability.water-compaction.defense', stat: 'def', value: 2,
        }),
      )
    }
    if (input.script.damaging && melee && input.context.queries.abilities.has(targetId, 'Rough Skin')) {
      const req = request({
        identity: input.identity, canonicalId: 'Rough Skin',
        reasonCode: 'ability.rough-skin.optional-hp-loss', ownerId: targetId,
        phase: 'hit', timing: 'post-hit', trigger: { requirement: 'hit', targetId },
      })
      if (input.context.queries.resources.actionAvailable(targetId, 'free')) operations.push(
        req,
        directHp({
          id: `ability.rough-skin.hp.${suffix}`, source: { kind: 'operation', id: req.id },
          recipients: 'actor', reasonCode: 'ability.rough-skin.attacker-tick',
          calculation: { kind: 'percent-max', percent: 10 },
        }),
      )
    }
  }
  return operations
}

const optionalMoveOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
  readonly targetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const type = input.script.type.trim().toLowerCase()
  const melee = /\bmelee\b/i.test(input.script.range)
  const oneTarget = input.targetIds.length === 1
  const oneTargetAttack = oneTarget
    && input.script.targetMode === 'one-target'
    && (input.script.areaTemplates?.length ?? 0) === 0
  const addActorRequest = (
    canonicalId: string,
    reasonCode: string,
    options?: readonly string[],
    trigger?: Aa085To100TriggerRequirement,
  ): MoveReactionRequestEffectOperation | null => {
    const abilityId = instance(input.context, actorId, canonicalId)
    const dailyAbility = ['Transporter', 'Vigor', 'Voodoo Doll', 'Wash Away'].includes(canonicalId)
    const dailySpent = dailyAbility
      ? input.context.actor.sheet.sheet.abilityUsage?.entries.some(entry => (
          entry.canonicalId === canonicalId && entry.clauseId === 'base' && entry.spent >= entry.limit
        )) === true
      : false
    const action = canonicalId === 'Sound Lance' ? 'swift'
      : canonicalId === 'Sumo Stance' ? 'shift' : 'free'
    if (!abilityId
      || !input.context.queries.resources.actionAvailable(actorId, action)
      || dailySpent
      || (!dailyAbility && !sceneAvailable({
        context: input.context, ownerId: actorId, abilityInstanceId: abilityId, canonicalId,
      }))) return null
    return request({
      identity: input.identity, canonicalId, reasonCode, ownerId: actorId,
      optionIds: options,
      phase: trigger?.requirement === 'fainted' ? 'cleanup'
        : trigger ? 'hit' : 'declare',
      timing: trigger?.requirement === 'fainted' ? 'cleanup'
        : trigger ? 'post-hit' : 'declare',
      priority: 90, trigger,
    })
  }

  if (input.script.moveName.trim().toLowerCase() === 'curse'
    && input.context.actor.token.defenderTypes.some(candidate => candidate.trim().toLowerCase() === 'ghost')) {
    const candidates = input.context.queries.tokens.all().filter(candidate => (
      candidate.id !== actorId
      && !input.targetIds.includes(candidate.id)
      && ptuGridDistanceBetweenFootprints(input.context.actor.token, candidate) <= 8
    )).sort((left, right) => left.id.localeCompare(right.id))
    const req = candidates.length > 0
      ? addActorRequest(
          'Voodoo Doll',
          AA098_VOODOO_DOLL_REASON,
          candidates.map(candidate => `ability.voodoo-doll.target.${candidate.id}`),
        )
      : null
    if (req) operations.push({
      ...req,
      phase: 'target',
      payload: { ...req.payload, timing: 'target' },
    })
  }
  if (input.script.moveName.trim().toLowerCase() === 'barrier'
    && input.context.queries.abilities.has(actorId, 'Wallmaster')) {
    const req = request({
      identity: input.identity,
      canonicalId: 'Wallmaster',
      reasonCode: AA098_WALLMASTER_REASON,
      ownerId: actorId,
      optionIds: ['ability.wallmaster.defense', 'ability.wallmaster.segments'],
      phase: 'declare',
      timing: 'declare',
      priority: 94,
    })
    operations.push(req, stage({
      id: `ability.wallmaster.defense.${hash(input.identity)}`,
      source: { kind: 'operation', id: req.id },
      recipients: 'response-owner',
      reasonCode: 'ability.wallmaster.defense',
      stat: 'def',
      value: 2,
      phase: 'after-damage',
    }))
  }
  if (input.script.moveName.trim().toLowerCase() === 'smokescreen') {
    const req = addActorRequest('Sticky Smoke', AA092_STICKY_SMOKE_REASON)
    if (req) operations.push(req)
  }
  if (input.script.moveName.trim().toLowerCase() === 'teleport') {
    const teleportOperation = input.reviewedOperations.find(
      (operation): operation is MoveMovementRequestEffectOperation => (
        operation.kind === 'movement-request'
        && operation.payload.mode === 'teleport'
        && typeof operation.payload.distance === 'number'
      ),
    )
    const teleportDistance = typeof teleportOperation?.payload.distance === 'number'
      ? teleportOperation.payload.distance
      : 4
    const companions = input.context.queries.tokens.all().filter(candidate => (
      candidate.id !== actorId
      && input.context.queries.relationships.resolve(actorId, candidate.id).relationship === 'ally'
      && ptuGridDistanceBetweenFootprints(input.context.actor.token, candidate) <= 1
    )).sort((left, right) => left.id.localeCompare(right.id))
    const transporterUsage = input.context.actor.sheet.sheet.abilityUsage?.entries.find(entry => (
      entry.canonicalId === 'Transporter' && entry.clauseId === 'base'
    ))
    const transporterRemaining = (transporterUsage?.limit ?? 3) - (transporterUsage?.spent ?? 0)
    const options = [
      'ability.transporter.extended-range',
      ...companions.flatMap(candidate => [
        `ability.transporter.carry.${candidate.id}`,
        ...(transporterRemaining >= 2 ? [`ability.transporter.both.${candidate.id}`] : []),
      ]),
    ]
    const req = addActorRequest('Transporter', AA096_TRANSPORTER_REASON, options)
    if (req) {
      operations.push(req)
      for (const companion of companions) {
        for (const branch of ['carry', 'both'] as const) operations.push({
          id: `ability.transporter.${branch}.${hash(input.identity, companion.id)}`,
          kind: 'movement-request',
          source: { kind: 'operation', id: req.id },
          recipients: { kind: 'all-placements' },
          phase: 'movement',
          reasonCode: `ability.transporter.${branch}.${companion.id}`,
          payload: {
            requestId: `ability.transporter.${branch}.destination.${hash(input.identity, companion.id)}`,
            mode: 'teleport',
            distance: branch === 'both' ? teleportDistance * 3 : teleportDistance,
            destinationSetId: `ability.transporter.${branch}.destinations.${hash(input.identity, companion.id)}`,
            choice: {
              kind: 'destination',
              promptKey: 'ability.transporter.choose-companion-destination',
              allowPass: false,
            },
          },
        } as MoveMovementRequestEffectOperation)
      }
    }
  }
  if (input.script.moveName.trim().toLowerCase() === 'wish'
    && input.context.queries.abilities.has(actorId, 'Wishmaster')) {
    const stageIds = ['atk', 'def', 'satk', 'sdef', 'spd'] as const
    const req = request({
      identity: input.identity,
      canonicalId: 'Wishmaster',
      reasonCode: AA099_WISHMASTER_REASON,
      ownerId: actorId,
      optionIds: [
        'ability.wishmaster.instant',
        ...stageIds.map(statId => `ability.wishmaster.stage.${statId}`),
        'ability.wishmaster.cure',
      ],
      phase: 'declare',
      timing: 'declare',
      priority: 94,
    })
    operations.push(req, heal({
      id: `ability.wishmaster.instant.${hash(input.identity)}`,
      source: { kind: 'operation', id: req.id },
      recipients: 'attacked-targets',
      reasonCode: 'ability.wishmaster.instant',
      percent: 50,
      phase: 'after-damage',
    }))
  }
  if (input.script.damaging && type === 'electric') {
    const adjacentElectric = input.context.queries.tokens.all().some(token => (
      token.id !== actorId
      && token.defenderTypes.some(defenderType => defenderType.trim().toLowerCase() === 'electric')
      && ptuGridDistanceBetweenFootprints(token, input.context.actor.token) <= 1
    ))
    const req = adjacentElectric ? addActorRequest('Sequence', AA088_SEQUENCE_REASON) : null
    if (req) operations.push(req)
  }
  if (input.script.damaging && type === 'normal') {
    const req = addActorRequest('Refrigerate', AA085_REFRIGERATE_REASON)
    if (req) {
      operations.push(req)
      if (input.context.queries.abilities.has(actorId, 'Winter’s Kiss')) {
        operations.push(heal({
          id: `ability.refrigerate.winters-kiss-user-heal.${hash(input.identity, actorId)}`,
          source: { kind: 'operation', id: req.id }, recipients: 'actor',
          reasonCode: 'ability.refrigerate.winters-kiss-user-heal', percent: 10,
        }))
      }
      for (const targetId of input.targetIds) {
        if (!input.context.queries.abilities.has(targetId, 'Winter’s Kiss')) continue
        operations.push(heal({
          id: `ability.refrigerate.winters-kiss-target-heal.${hash(input.identity, targetId)}`,
          source: { kind: 'operation', id: req.id }, recipients: 'all-placements',
          reasonCode: `ability.refrigerate.winters-kiss-target-heal.${targetId}`,
          percent: 10,
        }))
      }
    }
  }
  if (input.script.keywords.some(keyword => /five\s*strike/i.test(keyword))) {
    const req = addActorRequest(
      'Skill Link', AA089_SKILL_LINK_REASON, undefined,
      input.targetIds.length > 0 ? { requirement: 'hit', targetId: '*' } : undefined,
    )
    if (req) operations.push(req)
  }
  if (input.script.damaging) {
    const abilityId = instance(input.context, actorId, 'Solar Power')
    if (abilityId && input.context.queries.resources.actionAvailable(actorId, 'swift')
      && (input.context.queries.weather.active().some(weather => weather.kind === 'sunny')
        || sceneAvailable({ context: input.context, ownerId: actorId, abilityInstanceId: abilityId, canonicalId: 'Solar Power', limit: 2 }))) {
      const req = request({
        identity: input.identity, canonicalId: 'Solar Power', reasonCode: AA090_SOLAR_POWER_REASON,
        ownerId: actorId, phase: 'hit', timing: 'post-hit', priority: 92,
        trigger: { requirement: 'hit', targetId: '*' },
      })
      operations.push(
        req,
        directHp({
          id: `ability.solar-power.hp.${hash(input.identity, actorId)}`,
          source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
          reasonCode: 'ability.solar-power.tick-cost',
          calculation: { kind: 'percent-max', percent: 10 }, phase: 'hit',
        }),
      )
    }
  }
  if (input.script.damaging) for (const faintCandidate of input.targetIds) {
    if (input.context.queries.relationships.resolve(actorId, faintCandidate).relationship !== 'enemy') continue
    const req = addActorRequest('Soulstealer', AA091_SOULSTEALER_REASON, [
      'ability.soulstealer.use-normal',
      'ability.soulstealer.use-killed',
    ], {
      requirement: 'fainted', targetId: faintCandidate,
    })
    if (req) operations.push(
      req,
      heal({
        id: `ability.soulstealer.heal.normal.${hash(input.identity, faintCandidate)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.soulstealer.use-normal', percent: 25, phase: 'cleanup',
      }),
      heal({
        id: `ability.soulstealer.heal.killed.${hash(input.identity, faintCandidate)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.soulstealer.use-killed', percent: 50, phase: 'cleanup',
      }),
    )
  }
  const shellMoves = new Set([
    'aqua jet', 'dive', 'flash cannon', 'hydro cannon', 'hydro pump',
    'tackle', 'waterfall', 'water gun', 'water spout',
  ])
  const shellChargeMoves = new Set(['aqua jet', 'dive', 'tackle', 'waterfall'])
  const shellMoveName = input.script.moveName.trim().toLowerCase()
  const actorSpecies = input.context.actor.sheet.kind === 'pokemon'
    ? (input.context.actor.sheet.sheet as CharacterSheet).species.trim().toLowerCase() : ''
  const shellTarget = input.targetIds.length === 1
    ? input.context.queries.tokens.get(input.targetIds[0]!) ?? null : null
  const hasReviewedShellShift = !shellChargeMoves.has(shellMoveName)
    || shellTarget !== null
      && aa085to100StraightLineMovementToward({
        context: input.context,
        actor: input.context.actor.token,
        recipient: shellTarget,
      }) > 0
  if (shellMoves.has(shellMoveName)
    && actorSpecies.includes('blastoise')
    && hasReviewedShellShift) {
    const req = addActorRequest('Shell Cannon', AA089_SHELL_CANNON_REASON)
    if (req) operations.push(req)
  }
  if (input.script.moveName.trim().toLowerCase() === 'aqua ring') {
    const req = addActorRequest('Refreshing Veil', 'ability.refreshing-veil.optional-cure')
    if (req) operations.push(req, parseMoveEffectOperation({
      id: `ability.refreshing-veil.cure.${hash(input.identity)}`,
      kind: 'condition', source: { kind: 'operation', id: req.id },
      recipients: { kind: 'response-owner' }, phase: 'cleanup',
      reasonCode: 'ability.refreshing-veil.cure-persistent',
      payload: {
        action: 'clear', conditionId: null, conditionSource: null,
        filter: {
          groups: ['persistent'], conditionIds: [], excludedConditionIds: [],
        },
        randomChoice: null, duration: null, saveTiming: 'canonical',
        stackPolicy: { kind: 'refresh', maxStacks: null },
      },
    }, 'ability.refreshingVeil.cure'))
  }
  if (input.script.moveName.trim().toLowerCase() === 'supersonic') {
    const req = addActorRequest('Sound Lance', 'ability.sound-lance.optional-hp-loss')
    if (req) operations.push(req, directHp({
      id: `ability.sound-lance.hp.${hash(input.identity)}`,
      source: { kind: 'operation', id: req.id }, recipients: 'attacked-targets',
      reasonCode: 'ability.sound-lance.special-attack-hp-loss',
      calculation: {
        kind: 'fixed',
        value: currentOffensiveStat(input.context, 'special-attack'),
      },
    }))
  }
  if (input.script.moveName.trim().toLowerCase() === 'lick') {
    const lickTrigger = input.targetIds[0]
      ? { requirement: 'hit' as const, targetId: input.targetIds[0] }
      : undefined
    const tingly = addActorRequest('Tingly Tongue', AA095_TINGLY_TONGUE_REASON, undefined, lickTrigger)
    if (tingly) operations.push(
      tingly,
      condition({
        id: `ability.tingly-tongue.paralysis.${hash(input.identity)}`,
        source: { kind: 'operation', id: tingly.id }, recipients: 'hit-targets',
        reasonCode: 'ability.tingly-tongue.paralysis', conditionId: 'Paralysis',
      }),
      temporary({
        id: `ability.tingly-tongue.failed-save.${hash(input.identity)}`,
        source: { kind: 'operation', id: tingly.id }, recipients: 'hit-targets',
        reasonCode: 'ability.tingly-tongue.fail-next-paralysis-save',
        tag: 'aa095-tingly-tongue-fail-next-paralysis-save',
        payload: { capabilityId: 'aa095.tingly-tongue.fail-next-paralysis-save', action: 'grant' },
        duration: { kind: 'until-triggered', remaining: null },
      }),
    )
    const lash = addActorRequest('Tonguelash', AA095_TONGUELASH_REASON, undefined, lickTrigger)
    if (lash) operations.push(
      lash,
      condition({
        id: `ability.tonguelash.paralysis.${hash(input.identity)}`,
        source: { kind: 'operation', id: lash.id }, recipients: 'hit-targets',
        reasonCode: 'ability.tonguelash.paralysis', conditionId: 'Paralysis',
      }),
      condition({
        id: `ability.tonguelash.flinch.${hash(input.identity)}`,
        source: { kind: 'operation', id: lash.id }, recipients: 'hit-targets',
        reasonCode: 'ability.tonguelash.flinch', conditionId: 'Flinch',
      }),
    )
  }
  if (input.script.damaging && oneTargetAttack
    && !/\bmelee\b/i.test(input.script.range)) {
    const targetId = input.targetIds[0]!
    const target = input.context.queries.tokens.get(targetId)
    const groundLevel = input.context.map.groundLevelY ?? 0
    const airborne = Boolean(target && (
      target.position.y > groundLevel
      || normalizeConditionNames(target.conditions).includes('Airborne')
      || input.context.map.encounterState?.effects.some(effect => (
        effect.affected.placementIds.includes(targetId)
        && effect.tags.some(tag => /(?:airborne|flying|levitating)/i.test(tag))
        && effect.suppression.sources.length === 0
      ))
    ))
    const req = airborne
      ? addActorRequest('Spray Down', AA091_SPRAY_DOWN_REASON, undefined, {
          requirement: 'hit', targetId,
        })
      : null
    if (req) {
      operations.push(req, temporary({
        id: `ability.spray-down.grounded.${hash(input.identity, targetId)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'hit-targets',
        reasonCode: 'ability.spray-down.grounded', tag: 'aa091-spray-down-grounded',
        payload: { capabilityId: 'aa091.spray-down.grounded', action: 'grant' },
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 3 },
      }))
      if (target && target.position.y > groundLevel) operations.push({
        id: `ability.spray-down.descend.${hash(input.identity, targetId)}`,
        kind: 'movement-request', source: { kind: 'operation', id: req.id },
        recipients: { kind: 'hit-targets' }, phase: 'movement',
        reasonCode: 'ability.spray-down.knock-to-ground',
        payload: {
          requestId: `ability.spray-down.descend.${hash(input.identity, targetId)}`,
          mode: 'forced', distance: target.position.y - groundLevel,
          destinationSetId: null,
          displacement: {
            vector: { kind: 'cardinal', direction: 'down' },
            distancePolicy: 'up-to-distance', opportunityAttacks: 'ignore',
          },
        },
      } as MoveMovementRequestEffectOperation)
    }
  }
  if (type === 'water' && input.targetIds.length > 0) {
    const req = addActorRequest('Wash Away', AA098_WASH_AWAY_REASON, undefined, {
      requirement: 'hit', targetId: '*',
    })
    if (req) {
      operations.push(req, parseMoveEffectOperation({
        id: `ability.wash-away.reset.${hash(input.identity)}`,
        kind: 'combat-stage', source: { kind: 'operation', id: req.id },
        recipients: { kind: 'hit-targets' }, phase: 'hit',
        reasonCode: 'ability.wash-away.reset-stages',
        payload: {
          action: 'reset', stage: 'all-stats', selectedStage: null,
          value: null, stageSource: null, rounding: null,
        },
      }, 'ability.washAway.reset'))
      for (const targetId of input.targetIds) {
        const coats = input.context.map.encounterState?.effects.filter(effect => (
          effect.affected.placementIds.includes(targetId)
          && effect.tags.some(tag => tag.trim().toLowerCase() === 'coat')
          && !effect.tags.some(tag => tag.trim().toLowerCase().includes('water-sport'))
        )) ?? []
        for (const coat of coats) operations.push({
          id: `ability.wash-away.coat.${hash(input.identity, targetId, coat.id)}`,
          kind: 'temporary-effect', source: { kind: 'operation', id: req.id },
          recipients: { kind: 'hit-targets' }, phase: 'hit',
          reasonCode: `ability.wash-away.remove-coat.${targetId}`,
          payload: { action: 'remove', effectId: coat.id },
        } as MoveTemporaryEffectOperation)
      }
    }
  }
  if (type === 'electric' && input.script.damaging && input.targetIds.length > 0) {
    const req = addActorRequest(
      'Transistor',
      AA096_TRANSISTOR_REASON,
      input.targetIds.map(targetId => `ability.transistor.target.${targetId}`),
      { requirement: 'hit', targetId: '*' },
    )
    if (req) operations.push(req)
  }
  if (input.script.moveName.trim().toLowerCase() === 'hone claws') {
    const req = addActorRequest('Vicious', AA097_VICIOUS_REASON, [
      'ability.vicious.extra-standard', 'ability.vicious.critical-range',
    ])
    if (req) operations.push(
      req,
      temporary({
        id: `ability.vicious.critical.${hash(input.identity)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.vicious.critical-range', tag: 'aa097-vicious-critical',
        kind: 'capability',
        payload: { capabilityId: 'aa097.vicious.critical-range-plus-two', action: 'grant' },
        duration: { kind: 'scene', remaining: null },
      }),
    )
  }
  if (input.script.moveName.trim().toLowerCase() === 'sing') {
    const req = addActorRequest('Wistful Melody', AA099_WISTFUL_MELODY_REASON)
    if (req) for (const statId of ['atk', 'satk'] as const) operations.push(stage({
      id: `ability.wistful-melody.${statId}.${hash(input.identity)}`,
      source: { kind: 'operation', id: req.id }, recipients: 'attacked-targets',
      reasonCode: `ability.wistful-melody.${statId}`, stat: statId, value: -2,
    }))
  }
  if (oneTarget) {
    const targetId = input.targetIds[0]!
    const target = input.context.queries.tokens.get(targetId)
    const enemy = input.context.queries.relationships.resolve(actorId, targetId).relationship === 'enemy'
    if (melee && enemy) {
      const sumo = addActorRequest('Sumo Stance', AA093_SUMO_STANCE_REASON, undefined, {
        requirement: 'hit', targetId,
      })
      if (sumo) operations.push(
        sumo,
        {
          id: `ability.sumo-stance.push.${hash(input.identity, targetId)}`,
          kind: 'movement-request', source: { kind: 'operation', id: sumo.id },
          recipients: { kind: 'hit-targets' }, phase: 'movement',
          reasonCode: 'ability.sumo-stance.push',
          payload: {
            requestId: `ability.sumo-stance.push.${hash(input.identity, targetId)}`,
            mode: 'forced', distance: 1, destinationSetId: null,
            displacement: {
              vector: { kind: 'away', source: { kind: 'actor' } },
              distancePolicy: 'up-to-distance', opportunityAttacks: 'ignore',
            },
          },
        } as MoveMovementRequestEffectOperation,
        temporary({
          id: `ability.sumo-stance.push-immunity.${hash(input.identity)}`,
          source: { kind: 'operation', id: sumo.id }, recipients: 'response-owner',
          reasonCode: 'ability.sumo-stance.push-immunity', tag: 'aa093-sumo-push-immunity',
          payload: { capabilityId: 'aa093.sumo-stance.push-immunity', action: 'grant' },
          duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
        }),
      )
    }
    if (oneTargetAttack && target && enemy
      && ptuGridDistanceBetweenFootprints(input.context.actor.token, target) <= 1) {
      const req = addActorRequest('Tingle', AA095_TINGLE_REASON, undefined, {
        requirement: 'hit', targetId,
      })
      if (req) operations.push(
        req,
        directHp({
          id: `ability.tingle.hp.${hash(input.identity, targetId)}`,
          source: { kind: 'operation', id: req.id }, recipients: 'hit-targets',
          reasonCode: 'ability.tingle.target-tick', calculation: { kind: 'percent-max', percent: 10 },
        }),
        temporary({
          id: `ability.tingle.damage-penalty.${hash(input.identity, targetId)}`,
          source: { kind: 'operation', id: req.id }, recipients: 'hit-targets',
          reasonCode: 'ability.tingle.damage-penalty', tag: 'aa095-tingle-damage-penalty',
          kind: 'numeric-modifier',
          payload: { attribute: 'damage', operation: 'add', value: -5, rounding: 'none' },
          duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
        }),
      )
    }
  }
  return operations
}

const interruptCopyOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const priorityMove = input.script.keywords.some(keyword => /\b(?:priority|interrupt)\b/i.test(keyword))
    || /\b(?:priority|interrupt)\b/i.test(input.script.range)
    || (input.context.queries.abilities.has(actorId, 'Triage')
      && input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'healing'))
    || (input.context.queries.abilities.has(actorId, 'Prankster')
      && input.script.damageClass?.trim().toLowerCase() === 'status')
  const danceMove = input.script.damaging
    && input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'dance')
  for (const provider of input.context.queries.tokens.all()) {
    if (provider.id === actorId) continue
    const relationship = input.context.queries.relationships.resolve(provider.id, actorId).relationship
    const providerPlacement = input.context.queries.placements.get(provider.id)
    if (!providerPlacement) continue
    if (relationship === 'enemy' && priorityMove
      && ptuGridDistanceBetweenFootprints(provider, input.context.actor.token) <= 1) {
      const abilityId = instance(input.context, provider.id, 'Queenly Majesty')
      if (abilityId
        && input.context.queries.resources.actionAvailable(provider.id, 'free')
        && moveFrequencyAvailable(input.context, provider.id, 'Stomp')
        && reviewedNestedMoveInvocationAvailable({
          context: input.context,
          actorPlacementId: provider.id,
          canonicalId: 'Stomp',
          requiredTargetPlacementId: actorId,
        })
        && sceneAvailable({
          context: input.context, ownerId: provider.id, abilityInstanceId: abilityId,
          canonicalId: 'Queenly Majesty', limit: 2,
        })) {
        const req = request({
          identity: input.identity, canonicalId: 'Queenly Majesty',
          reasonCode: AA085_QUEENLY_MAJESTY_REASON, ownerId: provider.id,
          // Optional Prankster must resolve first so Queenly Majesty can
          // deterministically observe whether this Status Move became Priority.
          phase: 'declare', timing: 'declare', priority: 115,
        })
        operations.push(req, nested({
          id: `ability.queenly-majesty.stomp.${hash(input.identity, provider.id)}`,
          requestId: req.id, canonicalId: 'Stomp', reasonCode: 'ability.queenly-majesty.stomp',
          recipients: 'actor', targeting: 'operation-recipients', phase: 'declare',
        }))
      }
    }
    if (danceMove && ptuGridDistanceBetweenFootprints(provider, input.context.actor.token) <= 10) {
      const abilityId = instance(input.context, provider.id, 'Revelation')
      if (abilityId
        && input.context.queries.resources.actionAvailable(provider.id, 'free')
        && moveFrequencyAvailable(input.context, provider.id, input.script.moveName)
        && reviewedNestedMoveInvocationAvailable({
          context: input.context,
          actorPlacementId: provider.id,
          canonicalId: input.script.moveName,
        })
        && sceneAvailable({
          context: input.context, ownerId: provider.id, abilityInstanceId: abilityId,
          canonicalId: 'Revelation', limit: 2,
        })) {
        const req = request({
          identity: input.identity, canonicalId: 'Revelation', reasonCode: AA086_REVELATION_REASON,
          ownerId: provider.id, phase: 'declare', timing: 'declare', priority: 175,
        })
        operations.push(req, nested({
          id: `ability.revelation.copy.${hash(input.identity, provider.id)}`,
          requestId: req.id, canonicalId: input.script.moveName,
          reasonCode: 'ability.revelation.copy-triggering-dance', phase: 'declare',
        }))
      }
    }
    if (relationship === 'enemy'
      && !input.context.map.encounterState?.history.actedThisRoundPlacementIds.includes(provider.id)) {
      const abilityId = instance(input.context, provider.id, 'Quick Draw')
      const sheet = abilityId
        ? input.context.queries.sheets.forPlacement(providerPlacement) : null
      const moves = sheet?.kind === 'pokemon'
        ? [...new Set((sheet.sheet as CharacterSheet).movelist?.map(move => move.name.trim()).filter(Boolean) ?? [])]
          .filter(moveName => input.context.queries.rules.runtimeFor(moveName) !== null
            && moveFrequencyAvailable(input.context, provider.id, moveName)
            && reviewedNestedMoveInvocationAvailable({
              context: input.context,
              actorPlacementId: provider.id,
              canonicalId: moveName,
              requiredTargetPlacementId: actorId,
            }))
          .sort((left, right) => left.localeCompare(right))
        : []
      if (abilityId && moves.length > 0
        && input.context.queries.resources.actionAvailable(provider.id, 'free')
        && input.context.queries.resources.actionAvailable(provider.id, 'standard')
        && sceneAvailable({
          context: input.context, ownerId: provider.id, abilityInstanceId: abilityId,
          canonicalId: 'Quick Draw',
        })) {
        const optionIds = moves.map(moveName => `ability.quick-draw.move.${slug(moveName)}.${hash(moveName)}`)
        const req = request({
          identity: input.identity, canonicalId: 'Quick Draw', reasonCode: AA085_QUICK_DRAW_REASON,
          ownerId: provider.id, optionIds, phase: 'declare', timing: 'declare', priority: 170,
        })
        operations.push(req)
        moves.forEach((moveName, index) => operations.push(nested({
          id: `ability.quick-draw.move.${hash(input.identity, provider.id, moveName)}`,
          requestId: req.id, canonicalId: moveName, reasonCode: optionIds[index]!,
          recipients: 'actor', targeting: 'operation-recipients', phase: 'declare',
        })))
      }
    }
    const protectedAllyIds = input.targetIds.filter(targetId => (
      targetId !== provider.id
      && input.context.queries.relationships.resolve(provider.id, targetId).relationship === 'ally'
    ))
    const weaponizeAbilityId = instance(input.context, provider.id, 'Weaponize')
    const providerSheet = weaponizeAbilityId
      ? input.context.queries.sheets.forPlacement(providerPlacement) : null
    const providerPokemonSheet = providerSheet?.kind === 'pokemon'
      ? providerSheet.sheet as CharacterSheet : null
    const providerPokedex = providerPokemonSheet
      ? (pokedexData as readonly PokedexRecord[]).find(entry => (
          entry.species.trim().toLowerCase() === providerPokemonSheet.species.trim().toLowerCase()
        )) : null
    const livingWeapon = [
      ...(providerPokedex?.capabilities?.other ?? []),
      ...(providerPokemonSheet?.capabilities?.other ?? []),
    ].some(capability => capability.trim().toLowerCase() === 'living weapon')
    const wielderId = weaponizeAbilityId ? activelyCommandingTrainerPlacementId({
      map: input.context.map,
      pokemonPlacementId: provider.id,
    }) : null
    const wielderPlacement = wielderId
      ? input.context.queries.placements.get(wielderId) : null
    const wielderResolved = wielderPlacement
      ? input.context.queries.sheets.forPlacement(wielderPlacement) : null
    const wielder = wielderResolved?.kind === 'trainer'
      ? wielderResolved.sheet as TrainerSheet : null
    const providerAliases = new Set([
      providerPlacement.sheetSlug,
      providerPokemonSheet?.slug ?? '',
      providerPokemonSheet?.nickname ?? '',
      providerPokemonSheet?.species ?? '',
    ].map(value => value.trim().toLowerCase()).filter(Boolean))
    const heldAsWeapon = wielder !== null
      && (wielder.currentTeam ?? []).some(teamSlug => teamSlug.trim() === providerPlacement.sheetSlug)
      && [wielder.equipmentSlots?.mainHand, wielder.equipmentSlots?.offHand]
        .some(name => typeof name === 'string' && providerAliases.has(name.trim().toLowerCase()))
    if (wielderId && input.targetIds.includes(wielderId) && livingWeapon && heldAsWeapon
      && (input.script.areaTemplates?.length ?? 0) === 0
      && weaponizeAbilityId
      && input.context.queries.resources.actionAvailable(provider.id, 'free')) {
      operations.push(request({
        identity: input.identity, canonicalId: 'Weaponize',
        reasonCode: AA098_WEAPONIZE_REASON, ownerId: provider.id,
        phase: 'hit', timing: 'post-hit', priority: 166,
        trigger: { requirement: 'hit', targetId: wielderId },
      }))
    }
    if (protectedAllyIds.length > 0 && instance(input.context, provider.id, 'Spiteful Intervention')
      && input.context.queries.resources.actionAvailable(provider.id, 'free')
      && moveFrequencyAvailable(input.context, provider.id, 'Spite')
      && reviewedNestedMoveInvocationAvailable({
        context: input.context,
        actorPlacementId: provider.id,
        canonicalId: 'Spite',
        requiredTargetPlacementId: actorId,
      })) {
      for (const protectedAllyId of protectedAllyIds) {
        const req = request({
          identity: input.identity, canonicalId: 'Spiteful Intervention',
          reasonCode: 'ability.spiteful-intervention.optional-spite', ownerId: provider.id,
          phase: 'hit', timing: 'post-hit', priority: 165,
          trigger: { requirement: 'hit', targetId: protectedAllyId },
        })
        operations.push(req, nested({
          id: `ability.spiteful-intervention.spite.${hash(input.identity, provider.id, protectedAllyId)}`,
          requestId: req.id, canonicalId: 'Spite', reasonCode: 'ability.spiteful-intervention.spite',
          recipients: 'actor', targeting: 'operation-recipients', phase: 'cleanup',
        }))
      }
    }
    const areaAttack = input.script.damaging && (input.script.areaTemplates?.length ?? 0) > 0
    const telepathyShiftDistance = Math.max(0, ...Object.values(
      provider.movementProfile?.speeds ?? provider.movementCapabilities ?? {},
    ).flatMap(value => typeof value === 'number' && Number.isFinite(value)
      ? [Math.max(0, Math.floor(value))]
      : []))
    if (areaAttack && input.targetIds.includes(provider.id) && relationship === 'ally'
      && telepathyShiftDistance > 0
      && instance(input.context, provider.id, 'Telepathy')
      && input.context.queries.resources.actionAvailable(provider.id, 'shift')) {
      const req = request({
        identity: input.identity, canonicalId: 'Telepathy',
        reasonCode: 'ability.telepathy.optional-disengage', ownerId: provider.id,
        phase: 'hit', timing: 'post-hit', priority: 164,
        trigger: { requirement: 'hit', targetId: provider.id },
      })
      const suffix = hash(input.identity, provider.id)
      operations.push(req, {
        id: `ability.telepathy.move.${suffix}`, kind: 'movement-request',
        source: { kind: 'operation', id: req.id }, recipients: { kind: 'response-owner' },
        phase: 'movement', reasonCode: 'ability.telepathy.disengage-movement',
        payload: {
          requestId: `ability.telepathy.destination.${suffix}`,
          mode: 'voluntary', distance: telepathyShiftDistance,
          destinationSetId: `ability.telepathy.destinations.${suffix}`,
          choice: { kind: 'destination', promptKey: 'ability.telepathy.choose-destination', allowPass: false },
        },
      } as MoveMovementRequestEffectOperation)
    }
  }
  return operations
}

const fieldReactionOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  if (input.script.damaging && input.script.type.trim().toLowerCase() === 'electric') {
    for (const provider of input.context.queries.tokens.all()) {
      if (provider.id === actorId
        || input.context.queries.relationships.resolve(provider.id, actorId).relationship !== 'ally'
        || ptuGridDistanceBetweenFootprints(provider, input.context.actor.token) > 1
        || !instance(input.context, provider.id, 'Thunder Boost')
        || !input.context.queries.resources.actionAvailable(provider.id, 'free')) continue
      operations.push(request({
        identity: input.identity, canonicalId: 'Thunder Boost',
        reasonCode: AA095_THUNDER_BOOST_REASON, ownerId: provider.id,
        optionIds: [AA095_THUNDER_BOOST_OPTION_ID],
        phase: 'declare', timing: 'declare', priority: 158,
      }))
    }
  }
  const rangedWater = input.script.type.trim().toLowerCase() === 'water'
    && !/\bmelee\b/i.test(input.script.range)
  if (rangedWater) {
    for (const provider of input.context.queries.tokens.all()) {
      if (provider.id === actorId
        || ptuGridDistanceBetweenFootprints(input.context.actor.token, provider) > 10) continue
      const abilityId = instance(input.context, provider.id, 'Storm Drain')
      if (!abilityId
        || !input.context.queries.resources.actionAvailable(provider.id, 'free')
        || !sceneAvailable({
          context: input.context, ownerId: provider.id, abilityInstanceId: abilityId,
          canonicalId: 'Storm Drain',
        })) continue
      const req = request({
        identity: input.identity, canonicalId: 'Storm Drain',
        reasonCode: AA093_STORM_DRAIN_REASON, ownerId: provider.id,
        optionIds: [AA093_STORM_DRAIN_OPTION_ID], phase: 'target', timing: 'target', priority: 156,
      })
      operations.push(req, stage({
        id: `ability.storm-drain.satk.${hash(input.identity, provider.id)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.storm-drain.special-attack', stat: 'satk', value: 1,
        phase: 'after-damage',
      }))
    }
  }
  return operations
}

const defensiveReactionOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
  readonly targetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const type = input.script.type.trim().toLowerCase()
  const melee = /\bmelee\b/i.test(input.script.range)
  const preReducedMultiHit = input.reviewedOperations.some(operation => operation.kind === 'multi-hit')
  for (const targetId of input.targetIds) {
    const target = input.context.queries.tokens.get(targetId)
    if (!target) continue
    const suffix = hash(input.identity, targetId)
    const optional = (canonicalId: string, reasonCode: string, requirement: Aa085To100TriggerRequirement['requirement'] = 'hit', options?: readonly string[]) => {
      const abilityId = instance(input.context, targetId, canonicalId)
      const action = canonicalId === 'Weeble' || canonicalId === 'Sway' ? 'standard'
        : canonicalId === 'Steam Engine' ? 'swift' : 'free'
      const actionAvailable = canonicalId === 'Sap Sipper'
        || input.context.queries.resources.actionAvailable(targetId, action)
      if (!abilityId || !actionAvailable) return null
      if (!['Rattled', 'Rough Skin', 'Spinning Dance', 'Stamina', 'Water Compaction', 'Weak Armor'].includes(canonicalId)
        && !sceneAvailable({
          context: input.context, ownerId: targetId, abilityInstanceId: abilityId,
          canonicalId, limit: canonicalId === 'Steam Engine' ? 2 : 1,
        })) return null
      const resolvesAfterDamage = preReducedMultiHit
        || requirement === 'damaged' || requirement === 'massive'
        || canonicalId === 'Weeble' || canonicalId === 'Wobble'
      return request({
        identity: input.identity, canonicalId, reasonCode, ownerId: targetId,
        optionIds: options,
        phase: resolvesAfterDamage ? 'after-damage' : 'hit',
        timing: resolvesAfterDamage ? 'post-damage' : 'post-hit',
        trigger: { requirement, targetId }, priority: 80,
      })
    }
    if (type === 'grass') {
      const sapSipper = optional('Sap Sipper', AA088_SAP_SIPPER_REASON, 'hit', [
        AA088_SAP_SIPPER_ATTACK_OPTION_ID,
        AA088_SAP_SIPPER_SPECIAL_ATTACK_OPTION_ID,
      ])
      if (sapSipper) operations.push(
        sapSipper,
        stage({
          id: `ability.sap-sipper.attack.${suffix}`,
          source: { kind: 'operation', id: sapSipper.id }, recipients: 'response-owner',
          reasonCode: AA088_SAP_SIPPER_ATTACK_OPTION_ID, stat: 'atk', value: 1,
        }),
        stage({
          id: `ability.sap-sipper.special-attack.${suffix}`,
          source: { kind: 'operation', id: sapSipper.id }, recipients: 'response-owner',
          reasonCode: AA088_SAP_SIPPER_SPECIAL_ATTACK_OPTION_ID, stat: 'satk', value: 1,
        }),
      )
    }
    if (['bug', 'dark', 'ghost'].includes(type)) {
      const req = optional('Rattled', AA086_RATTLED_REASON)
      if (req) operations.push(
        req,
        stage({
          id: `ability.rattled.speed.${suffix}`, source: { kind: 'operation', id: req.id },
          recipients: 'response-owner', reasonCode: 'ability.rattled.speed', stat: 'spd', value: 1,
        }),
        {
          id: `ability.rattled.disengage.${suffix}`,
          kind: 'movement-request',
          source: { kind: 'operation', id: req.id },
          recipients: { kind: 'response-owner' },
          phase: 'movement',
          reasonCode: 'ability.rattled.disengage',
          payload: {
            requestId: `ability.rattled.destination.${suffix}`,
            mode: 'voluntary',
            distance: 1,
            destinationSetId: `ability.rattled.destinations.${suffix}`,
            choice: {
              kind: 'destination',
              promptKey: 'ability.rattled.choose-destination',
              allowPass: true,
            },
          },
        } as MoveMovementRequestEffectOperation,
      )
    }
    if (input.script.damaging) {
      const anchorAdjacent = (input.context.map.encounterState?.abilityEntities?.entries ?? []).some(entity => (
        entity.kind === 'anchor'
        && entity.payload.kind === 'anchor'
        && entity.payload.anchorKind === 'aa060.anchored'
        && entity.payload.anchoredPlacementIds.includes(targetId)
        && Math.max(
          Math.abs(entity.position.x - target.position.x),
          Math.abs(entity.position.y - target.position.y),
          Math.abs(entity.position.z - target.position.z),
        ) <= 1
      ))
      const steelworker = anchorAdjacent
        ? optional('Steelworker', AA092_STEELWORKER_REASON, 'damaged') : null
      if (steelworker) operations.push(steelworker)
      const stalwart = optional('Stalwart', AA092_STALWART_REASON, 'massive')
      if (stalwart) for (const statId of ['atk', 'satk', 'def', 'sdef'] as const) operations.push(
        ...(statId === 'atk' ? [stalwart] : []),
        stage({
          id: `ability.stalwart.${statId}.${suffix}`,
          source: { kind: 'operation', id: stalwart.id }, recipients: 'response-owner',
          reasonCode: `ability.stalwart.${statId}`, stat: statId, value: 1,
        }),
      )
      const endureActive = input.context.map.encounterState?.effects.some(effect => (
        effect.affected.placementIds.includes(targetId)
        && effect.tags.some(tag => tag.trim().toLowerCase() === 'endure')
        && effect.tags.some(tag => tag.trim().toLowerCase() === 'shield')
        && effect.suppression.sources.length === 0
      )) === true
      const vigor = endureActive ? optional('Vigor', AA097_VIGOR_REASON, 'damaged') : null
      if (vigor) operations.push(vigor, heal({
        id: `ability.vigor.heal.${suffix}`,
        source: { kind: 'operation', id: vigor.id }, recipients: 'response-owner',
        reasonCode: 'ability.vigor.tick-after-endure', percent: 10, phase: 'cleanup',
      }))
      const stamina = optional('Stamina', AA092_STAMINA_REASON)
      if (stamina) operations.push(stamina, stage({
        id: `ability.stamina.defense.${suffix}`, source: { kind: 'operation', id: stamina.id },
        recipients: 'response-owner', reasonCode: 'ability.stamina.defense', stat: 'def', value: 1,
      }))
      const weak = input.script.damageClass?.trim().toLowerCase() === 'physical'
        ? optional('Weak Armor', AA098_WEAK_ARMOR_REASON, 'damaged') : null
      if (weak) operations.push(
        weak,
        stage({
          id: `ability.weak-armor.defense.${suffix}`, source: { kind: 'operation', id: weak.id },
          recipients: 'response-owner', reasonCode: 'ability.weak-armor.defense', stat: 'def', value: -1,
        }),
        stage({
          id: `ability.weak-armor.speed.${suffix}`, source: { kind: 'operation', id: weak.id },
          recipients: 'response-owner', reasonCode: 'ability.weak-armor.speed', stat: 'spd', value: 1,
        }),
      )
      const sandSpitCandidate = input.context.queries.relationships.resolve(targetId, actorId).relationship === 'enemy'
        && ptuGridDistanceBetweenFootprints(input.context.actor.token, target) <= 2
        ? optional('Sand Spit', 'ability.sand-spit.optional-sand-attack', 'damaged') : null
      const sandSpit = sandSpitCandidate
        && moveFrequencyAvailable(input.context, targetId, 'Sand Attack')
        && reviewedNestedMoveInvocationAvailable({
          context: input.context,
          actorPlacementId: targetId,
          canonicalId: 'Sand Attack',
          requiredTargetPlacementId: actorId,
        })
        ? sandSpitCandidate : null
      if (sandSpit) operations.push(sandSpit, nested({
        id: `ability.sand-spit.sand-attack.${suffix}`, requestId: sandSpit.id,
        canonicalId: 'Sand Attack', reasonCode: 'ability.sand-spit.sand-attack',
        recipients: 'actor', targeting: 'operation-recipients',
      }))
      const steamEngineCandidate = ['fire', 'water'].includes(type)
        ? optional('Steam Engine', 'ability.steam-engine.optional-smokescreen') : null
      const steamEngine = steamEngineCandidate
        && reviewedNestedMoveInvocationAvailable({
          context: input.context,
          actorPlacementId: targetId,
          canonicalId: 'Smokescreen',
        })
        ? steamEngineCandidate : null
      if (steamEngine) operations.push(steamEngine, nested({
        id: `ability.steam-engine.smokescreen.${suffix}`, requestId: steamEngine.id,
        canonicalId: 'Smokescreen', reasonCode: 'ability.steam-engine.smokescreen',
        recipients: 'response-owner', targeting: 'operation-recipients',
      }))
      const retaliationTargets = input.context.queries.tokens.all().filter(candidate => (
        candidate.id !== targetId
        && candidate.currentHp > 0
        && ptuGridDistanceBetweenFootprints(target, candidate) <= 1
      )).sort((left, right) => left.id.localeCompare(right.id))
      const weeble = retaliationTargets.length > 0
        ? optional(
            'Weeble',
            AA098_WEEBLE_REASON,
            'hit',
            retaliationTargets.map(candidate => `ability.weeble.target.${candidate.id}`),
          )
        : null
      if (weeble) {
        operations.push(weeble)
        for (const candidate of retaliationTargets) {
          const rollId = `ability.weeble.accuracy-roll.${hash(input.identity, targetId, candidate.id)}`
          operations.push({
            id: `ability.weeble.accuracy.${hash(input.identity, targetId, candidate.id)}`,
            kind: 'roll', source: { kind: 'operation', id: weeble.id },
            // The bound retaliation target is projected through the standard
            // attacked-target accuracy envelope by the interpreter.
            recipients: { kind: 'attacked-targets' }, phase: 'after-damage',
            reasonCode: `ability.weeble.accuracy.${candidate.id}`,
            payload: {
              rollId,
              formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
            },
          } as MoveRollEffectOperation)
          operations.push(directHp({
            id: `ability.weeble.retaliation.${hash(input.identity, targetId, candidate.id)}`,
            source: { kind: 'operation', id: weeble.id },
            recipients: 'hit-targets',
            reasonCode: `ability.weeble.target.${candidate.id}`,
            accuracyRollId: rollId,
            // The interpreter replaces this reviewed placeholder with one
            // third of the exact HP/Temporary-HP loss already reduced for
            // the bound reacting owner.
            calculation: { kind: 'fixed', value: 0 },
          }))
        }
      }
      const trinityMayChangeDamageClass = input.script.moveName.trim().toLowerCase() === 'tri attack'
        && input.context.queries.abilities.has(actorId, 'Trinity')
      const compatibleWobbleOptions = trinityMayChangeDamageClass
        ? ['ability.wobble.counter', 'ability.wobble.mirror-coat']
        : input.script.damageClass?.trim().toLowerCase() === 'physical'
          ? ['ability.wobble.counter']
          : input.script.damageClass?.trim().toLowerCase() === 'special'
            ? ['ability.wobble.mirror-coat'] : []
      const wobbleOptions = instance(input.context, targetId, 'Wobble')
        ? compatibleWobbleOptions.filter(optionId => (
            reviewedNestedMoveInvocationAvailable({
              context: input.context,
              actorPlacementId: targetId,
              canonicalId: optionId === 'ability.wobble.counter' ? 'Counter' : 'Mirror Coat',
              requiredTargetPlacementId: actorId,
            })
          ))
        : []
      const wobble = wobbleOptions.length > 0
        ? optional('Wobble', AA099_WOBBLE_REASON, 'hit', wobbleOptions) : null
      if (wobble) {
        operations.push(wobble)
        for (const wobbleOption of wobbleOptions) operations.push(directHp({
          id: `ability.wobble.retaliation.${hash(input.identity, targetId, wobbleOption)}`,
          source: { kind: 'operation', id: wobble.id }, recipients: 'actor',
          reasonCode: wobbleOption,
          // Replaced during interpreter execution with twice the exact loss
          // suffered by the bound Wobble owner after its resistance step.
          calculation: { kind: 'fixed', value: 0 },
        }))
      }
    }
    const spinning = optional('Spinning Dance', AA091_SPINNING_DANCE_REASON, 'missed')
    if (spinning && !normalizeConditionNames(target.conditions).some(condition => (
      ['Fainted', 'Paralysis', 'Sleep', 'Bad Sleep'].includes(condition)
    ))) {
      const movement: MoveMovementRequestEffectOperation = {
        id: `ability.spinning-dance.shift.${suffix}`, kind: 'movement-request',
        source: { kind: 'operation', id: spinning.id }, recipients: { kind: 'response-owner' },
        phase: 'movement', reasonCode: 'ability.spinning-dance.shift',
        payload: {
          requestId: `ability.spinning-dance.destination.${suffix}`,
          mode: 'voluntary', distance: 1,
          destinationSetId: `ability.spinning-dance.destinations.${suffix}`,
          choice: { kind: 'destination', promptKey: 'ability.spinning-dance.choose-destination', allowPass: false },
        },
      }
      operations.push(
        spinning,
        temporary({
          id: `ability.spinning-dance.evasion.${suffix}`,
          source: { kind: 'operation', id: spinning.id }, recipients: 'response-owner',
          reasonCode: 'ability.spinning-dance.evasion', tag: 'aa091-spinning-dance-evasion',
          kind: 'numeric-modifier',
          payload: { attribute: 'evasion', operation: 'add', value: 1, rounding: 'none' },
          duration: { kind: 'scene', remaining: null },
        }),
        movement,
      )
    }
    if (melee) {
      const sway = input.script.damaging
        && input.context.queries.relationships.resolve(targetId, actorId).relationship === 'enemy'
        ? optional('Sway', AA093_SWAY_REASON) : null
      if (sway) operations.push(sway, {
        id: `ability.sway.push-attacker.${suffix}`,
        kind: 'movement-request',
        source: { kind: 'operation', id: sway.id },
        recipients: { kind: 'actor' },
        phase: 'movement',
        reasonCode: `ability.sway.push-attacker:${targetId}`,
        payload: {
          requestId: `ability.sway.push-attacker.${suffix}`,
          mode: 'forced',
          // The triggering foe already begins adjacent; reaching any other
          // empty square adjacent to the Sway user can require two metres.
          distance: 2,
          destinationSetId: `ability.sway.destinations.${suffix}`,
          choice: {
            kind: 'destination',
            promptKey: 'ability.sway.choose-adjacent-destination',
            allowPass: true,
          },
        },
      } as MoveMovementRequestEffectOperation)
      const staticRequest = input.context.queries.relationships.resolve(targetId, actorId).relationship === 'enemy'
        ? optional('Static', AA092_STATIC_REASON)
        : null
      if (staticRequest) operations.push(
        staticRequest,
        condition({
          id: `ability.static.paralysis.${suffix}`,
          source: { kind: 'operation', id: staticRequest.id }, recipients: 'actor',
          reasonCode: 'ability.static.paralysis', conditionId: 'Paralysis',
        }),
      )
      const hair = optional('Tangling Hair', AA094_TANGLING_HAIR_REASON)
      if (hair) operations.push(
        hair,
        stage({
          id: `ability.tangling-hair.speed.${suffix}`, source: { kind: 'operation', id: hair.id },
          recipients: 'actor', reasonCode: 'ability.tangling-hair.speed', stat: 'spd', value: -1,
        }),
        condition({
          id: `ability.tangling-hair.slowed.${suffix}`, source: { kind: 'operation', id: hair.id },
          recipients: 'actor', reasonCode: 'ability.tangling-hair.slowed', conditionId: 'Slowed',
          sourcePlacementId: targetId,
          duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
        }),
      )
      const opposingPokemon = input.context.actor.sheet.kind === 'pokemon'
        && input.context.queries.relationships.resolve(targetId, actorId).relationship === 'enemy'
      const exchangeable = opposingPokemon
        ? input.context.queries.abilities.activeForPlacement(actorId)
            .filter(candidate => candidate.canonicalId !== 'Wandering Spirit'
              && abilityIsTransferable(candidate.canonicalId))
            .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
        : []
      const wandering = exchangeable.length > 0
        ? optional('Wandering Spirit', AA098_WANDERING_SPIRIT_REASON)
        : null
      if (wandering) {
        const source = { kind: 'operation' as const, id: wandering.id }
        const wanderingAbility = input.context.queries.abilities.activeForPlacement(targetId)
          .find(candidate => candidate.canonicalId === 'Wandering Spirit')!
        const exchanges = exchangeable.map((exchanged) => {
          const exchangeSuffix = hash(input.identity, targetId, exchanged.instanceId)
          const ownerGainOperationId = `ability.wandering-spirit.owner-gain.${exchangeSuffix}`
          const ownerGainInstanceId = `granted:${ownerGainOperationId}:0`
          const attackerGainOperationId = `ability.wandering-spirit.attacker-gain.${exchangeSuffix}`
          const attackerGainInstanceId = `granted:${attackerGainOperationId}:0`
          const exchangeOperations: readonly MoveTemporaryEffectOperation[] = [
            temporary({
              id: `ability.wandering-spirit.owner-suppress.${exchangeSuffix}`,
              source, recipients: 'response-owner',
              reasonCode: 'ability.wandering-spirit.owner-suppress', tag: 'aa098-wandering-spirit-swap',
              kind: 'creature-rule-overlay',
              payload: {
                domain: 'ability', action: 'suppress', values: ['Wandering Spirit'],
                referencePlacementId: null, suppressionScope: 'listed',
              },
              duration: { kind: 'scene', remaining: null },
            }),
            temporary({
              id: ownerGainOperationId,
              source, recipients: 'response-owner',
              reasonCode: 'ability.wandering-spirit.owner-gain', tag: 'aa098-wandering-spirit-swap',
              kind: 'creature-rule-overlay',
              payload: {
                domain: 'ability', action: 'add', values: [exchanged.canonicalId],
                referencePlacementId: null, suppressionScope: null,
                abilitySnapshots: [{
                  instanceId: ownerGainInstanceId,
                  canonicalId: exchanged.canonicalId,
                  definitionHash: exchanged.runtime.definitionHash,
                  sourcePlacementId: actorId,
                  parameterStatus: exchanged.parameterData
                    ? 'ready'
                    : abilityRequiresInstanceParameters(exchanged.canonicalId)
                      ? 'missing-required-data'
                      : 'not-parameterized',
                  parameterData: exchanged.parameterData
                    ? { ...exchanged.parameterData, instanceId: ownerGainInstanceId }
                    : null,
                }],
              },
              duration: { kind: 'scene', remaining: null },
            }),
            temporary({
              id: `ability.wandering-spirit.attacker-suppress.${exchangeSuffix}`,
              source, recipients: 'actor',
              reasonCode: 'ability.wandering-spirit.attacker-suppress', tag: 'aa098-wandering-spirit-swap',
              kind: 'creature-rule-overlay',
              payload: {
                domain: 'ability', action: 'suppress', values: [exchanged.canonicalId],
                referencePlacementId: null, suppressionScope: 'listed',
              },
              duration: { kind: 'scene', remaining: null },
            }),
            temporary({
              id: attackerGainOperationId,
              source, recipients: 'actor',
              reasonCode: 'ability.wandering-spirit.attacker-gain', tag: 'aa098-wandering-spirit-swap',
              kind: 'creature-rule-overlay',
              payload: {
                domain: 'ability', action: 'add', values: ['Wandering Spirit'],
                referencePlacementId: null, suppressionScope: null,
                abilitySnapshots: [{
                  instanceId: attackerGainInstanceId,
                  canonicalId: 'Wandering Spirit',
                  definitionHash: wanderingAbility.runtime.definitionHash,
                  sourcePlacementId: targetId,
                  parameterStatus: wanderingAbility.parameterData
                    ? 'ready'
                    : abilityRequiresInstanceParameters('Wandering Spirit')
                      ? 'missing-required-data'
                      : 'not-parameterized',
                  parameterData: wanderingAbility.parameterData
                    ? { ...wanderingAbility.parameterData, instanceId: attackerGainInstanceId }
                    : null,
                }],
              },
              duration: { kind: 'scene', remaining: null },
            }),
          ]
          return { exchanged, operations: exchangeOperations }
        })
        operations.push(wandering)
        if (exchanges.length > 1) {
          const tableId = `ability.wandering-spirit.table.${hash(input.identity, targetId)}`
          operations.push(parseMoveEffectOperation({
            id: `ability.wandering-spirit.roll.${hash(input.identity, targetId)}`,
            kind: 'roll', source, recipients: { kind: 'none' }, phase: 'after-damage',
            reasonCode: 'ability.wandering-spirit.random-ability',
            payload: {
              rollId: `ability.wandering-spirit.random.${hash(input.identity, targetId)}`,
              formula: { kind: 'table', tableId },
              table: {
                tableId, distribution: 'weighted', maximumRerolls: 0,
                entries: exchanges.map(({ exchanged, operations }) => ({
                  id: `ability.wandering-spirit.ability.${exchanged.instanceId}`,
                  weight: 1,
                  operationIds: operations.map(operation => operation.id),
                  predicate: null,
                })),
              },
            },
          }, 'ability.wanderingSpirit.random') as MoveRollEffectOperation)
        }
        operations.push(...exchanges.flatMap(exchange => exchange.operations))
      }
    }
    const rks = input.script.damaging
      ? optional('RKS System', AA085_RKS_SYSTEM_REASON) : null
    if (rks) operations.push(rks)
    if (type === 'flying') {
      const windCandidate = optional('Wind Power', AA099_WIND_POWER_REASON)
      const wind = windCandidate
        && moveFrequencyAvailable(input.context, targetId, 'Charge')
        && reviewedNestedMoveInvocationAvailable({
          context: input.context,
          actorPlacementId: targetId,
          canonicalId: 'Charge',
        })
        ? windCandidate : null
      if (wind) operations.push(
        wind,
        nested({
          id: `ability.wind-power.charge.${suffix}`, requestId: wind.id,
          canonicalId: 'Charge', reasonCode: 'ability.wind-power.charge',
          recipients: 'response-owner', targeting: 'operation-recipients',
        }),
      )
    }
  }
  return operations
}

/** Deterministic overlays reconstructed for root, nested, pending, and resumed execution. */
export const aa085to100MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const identity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const staticOperations = staticEffectRangeOperations({
    ...input, identity, targetIds: input.authoritativeTargetIds,
  })
  return Object.freeze([
    ...faintReactionOperations({
      ...input,
      identity,
      targetIds: input.context.queries.placements.all().map(placement => placement.id),
    }),
    ...staticOperations,
    ...conditionReactionOperations({
      ...input,
      identity,
      targetIds: input.authoritativeTargetIds,
      reviewedOperations: [...input.reviewedOperations, ...staticOperations],
    }),
    ...defensiveAutomaticOperations({
      ...input, identity, targetIds: input.authoritativeTargetIds,
    }),
    ...optionalMoveOperations({
      ...input, identity, targetIds: input.authoritativeTargetIds,
    }),
    ...interruptCopyOperations({
      ...input, identity, targetIds: input.authoritativeTargetIds,
    }),
    ...fieldReactionOperations({ ...input, identity }),
    ...defensiveReactionOperations({
      ...input, identity, targetIds: input.authoritativeTargetIds,
    }),
  ])
}

const lowerNaturalMinimum = <Trigger extends { readonly kind: string }>(
  trigger: Trigger,
  amount: number,
): Trigger => trigger.kind === 'range' && 'minimum' in trigger
  ? { ...trigger, minimum: Math.max(1, Number(trigger.minimum) - amount) }
  : trigger

const selectedResponseOptionId = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
  readonly reasonCode: string
}): string | null => {
  for (const request of input.operations) {
    if (request.kind !== 'reaction-request' || request.reasonCode !== input.reasonCode) continue
    const selected = input.responses.resolve({
      requestId: request.payload.requestId,
      options: request.payload.options,
      allowPass: request.payload.allowPass,
    })?.optionId ?? null
    if (selected !== null) return selected
  }
  return null
}

const responseSelected = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
  readonly reasonCode: string
}): boolean => selectedRequest(input) !== null

/** Apply response-selected type/multi-hit bonuses and static effect-range rules. */
export const applyAa085to100ReviewedOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
  readonly moveOwnedOperationIds: ReadonlySet<string>
  readonly responses: MoveSpecResponseResolver
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const refrigerate = responseSelected({ ...input, reasonCode: AA085_REFRIGERATE_REASON })
  const skillLink = responseSelected({ ...input, reasonCode: AA089_SKILL_LINK_REASON })
  const shellCannon = responseSelected({ ...input, reasonCode: AA089_SHELL_CANNON_REASON })
  const sequence = responseSelected({ ...input, reasonCode: AA088_SEQUENCE_REASON })
  const solarPower = responseSelected({ ...input, reasonCode: AA090_SOLAR_POWER_REASON })
  const transistorOption = selectedResponseOptionId({ ...input, reasonCode: AA096_TRANSISTOR_REASON })
  const transistorTargetId = transistorOption?.startsWith('ability.transistor.target.')
    ? transistorOption.slice('ability.transistor.target.'.length) : null
  const transistor = transistorTargetId !== null
  const thunderBoost = responseSelected({ ...input, reasonCode: AA095_THUNDER_BOOST_REASON })
  const stickySmoke = responseSelected({ ...input, reasonCode: AA092_STICKY_SMOKE_REASON })
  const transporterOption = selectedResponseOptionId({ ...input, reasonCode: AA096_TRANSPORTER_REASON })
  const trinityOption = selectedResponseOptionId({ ...input, reasonCode: AA096_TRINITY_REASON })
  const wallmasterOption = selectedResponseOptionId({ ...input, reasonCode: AA098_WALLMASTER_REASON })
  const wishmasterOption = selectedResponseOptionId({ ...input, reasonCode: AA099_WISHMASTER_REASON })
  const rksTargetIds = selectedRequests({ ...input, reasonCode: AA085_RKS_SYSTEM_REASON })
    .flatMap(request => aa085to100TriggerRequirement({ operation: request })?.targetId ?? [])
  const wobbleTargetIds = selectedRequests({ ...input, reasonCode: AA099_WOBBLE_REASON })
    .flatMap(request => aa085to100TriggerRequirement({ operation: request })?.targetId ?? [])
  const sereneGrace = input.context.queries.abilities.has(actorId, 'Serene Grace')
  const flinchRangeBoost = Number(input.context.queries.abilities.has(actorId, 'Stench')) * 3
    + Number(input.context.queries.abilities.has(actorId, 'Ugly')) * 2
  const sheerForce = input.context.queries.abilities.has(actorId, 'Sheer Force')
  const moveConsultsAttack = input.operations.some(operation => (
    input.moveOwnedOperationIds.has(operation.id)
    && (operation.kind === 'damage' && operation.payload.damageClass === 'physical'
      || operation.kind === 'multi-hit' && operation.payload.damage.damageClass === 'physical')
  ))
  const hasEffectRange = input.operations.some(operation => (
    input.moveOwnedOperationIds.has(operation.id)
    && (operation.kind === 'condition' && operation.payload.accuracyRollTrigger
      || operation.kind === 'combat-stage' && operation.payload.trigger?.kind === 'accuracy-roll')
  ))
  const actorTick = computeTickValue(
    input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp,
  )
  return Object.freeze(input.operations.flatMap((operation): readonly MoveEffectOperation[] => {
    if (!input.moveOwnedOperationIds.has(operation.id)) return [operation]
    if (input.context.queries.abilities.has(actorId, 'Trinity')
      && input.script.moveName.trim().toLowerCase() === 'tri attack'
      && (operation.id.startsWith('tri-attack.random-')
        || operation.id === 'tri-attack.random-condition')) return []
    if (operation.kind === 'temporary-effect' && operation.id === 'wish.delayed-heal') {
      if (wishmasterOption === 'ability.wishmaster.instant') return []
      const wishmasterTag = wishmasterOption?.startsWith('ability.wishmaster.stage.')
        ? `aa099-wishmaster-stage-${wishmasterOption.slice('ability.wishmaster.stage.'.length)}`
        : wishmasterOption === 'ability.wishmaster.cure'
          ? 'aa099-wishmaster-cure' : null
      if (wishmasterTag && operation.payload.action === 'add') return [{
        ...operation,
        payload: {
          ...operation.payload,
          definition: {
            ...operation.payload.definition,
            tags: [...new Set([...operation.payload.definition.tags, wishmasterTag])],
          },
        },
      }]
    }
    if (sheerForce && hasEffectRange
      && (operation.kind === 'condition' && operation.payload.accuracyRollTrigger
        || operation.kind === 'combat-stage' && operation.payload.trigger?.kind === 'accuracy-roll')) return []
    if (operation.kind === 'condition' && operation.payload.accuracyRollTrigger) {
      const flinch = ['flinch', 'flinched'].includes(
        operation.payload.conditionId?.trim().toLowerCase() ?? '',
      )
      const reduction = (sereneGrace ? 2 : 0) + (flinch ? flinchRangeBoost : 0)
      if (reduction > 0) return [{
        ...operation,
        payload: {
          ...operation.payload,
          accuracyRollTrigger: {
            ...operation.payload.accuracyRollTrigger,
            trigger: lowerNaturalMinimum(operation.payload.accuracyRollTrigger.trigger, reduction),
          },
        },
      }]
    }
    if (operation.kind === 'combat-stage'
      && operation.payload.trigger?.kind === 'accuracy-roll' && sereneGrace) {
      return [{
        ...operation,
        payload: {
          ...operation.payload,
          trigger: {
            ...operation.payload.trigger,
            trigger: lowerNaturalMinimum(operation.payload.trigger.trigger, 2),
          },
        },
      }]
    }
    if (operation.kind === 'hazard'
      && operation.payload.action === 'add'
      && stickySmoke
      && operation.payload.effectId === 'smoke') {
      return [{
        ...operation,
        payload: { ...operation.payload, familyId: 'hazard.smoke.sticky' },
      } as MoveHazardEffectOperation]
    }
    if (operation.kind === 'hazard'
      && operation.payload.action === 'add'
      && wallmasterOption === 'ability.wallmaster.segments'
      && operation.payload.effectId === 'barrier') {
      const count = operation.payload.geometry.count
      const cellSelection = operation.payload.cellSelection
      const cellCount = cellSelection?.count
      if (!cellSelection || count.kind !== 'exact' || cellCount?.kind !== 'exact') return [operation]
      return [{
        ...operation,
        payload: {
          ...operation.payload,
          geometry: { ...operation.payload.geometry, count: { ...count, count: count.count + 2 } },
          cellSelection: {
            ...cellSelection,
            count: { ...cellCount, count: cellCount.count + 2 },
          },
        },
      } as MoveHazardEffectOperation]
    }
    if (operation.kind === 'movement-request'
      && shellCannon
      && ['aqua jet', 'dive', 'tackle', 'waterfall']
        .includes(input.script.moveName.trim().toLowerCase())
      && typeof operation.payload.distance === 'number') {
      return [{
        ...operation,
        payload: { ...operation.payload, distance: operation.payload.distance + 2 },
      }]
    }
    if (operation.kind === 'movement-request'
      && input.script.moveName.trim().toLowerCase() === 'teleport'
      && typeof operation.payload.distance === 'number') {
      const carryMatch = transporterOption?.match(/^ability\.transporter\.(carry|both)\.(.+)$/)
      if (carryMatch?.[1] && carryMatch[2]) return [{
        ...operation,
        reasonCode: `ability.transporter.actor.${carryMatch[1]}.${carryMatch[2]}`,
        payload: {
          ...operation.payload,
          distance: carryMatch[1] === 'both'
            ? operation.payload.distance * 3
            : operation.payload.distance,
        },
      }]
      if (transporterOption === 'ability.transporter.extended-range') return [{
        ...operation,
        payload: { ...operation.payload, distance: operation.payload.distance * 3 },
      }]
    }
    if (operation.kind === 'movement-request'
      && moveConsultsAttack
      && input.context.queries.abilities.has(actorId, 'Thrust')
      && operation.payload.mode === 'forced'
      && operation.payload.displacement?.vector.kind === 'away'
      && typeof operation.payload.distance === 'number') {
      return [{
        ...operation,
        payload: { ...operation.payload, distance: operation.payload.distance + 1 },
      }]
    }
    if (operation.kind === 'multi-hit') {
      const sequenceDamage = sequence
        ? input.context.queries.tokens.all().filter(token => (
            token.id !== actorId
            && token.defenderTypes.some(type => type.trim().toLowerCase() === 'electric')
            && ptuGridDistanceBetweenFootprints(token, input.context.actor.token) <= 1
          )).length * 3
        : 0
      const preTypeDamageModifiers = [
        ...(operation.payload.damage.preTypeDamageModifiers ?? []),
        ...(sequence ? [{
          id: `ability.sequence.damage.${hash(operation.id)}`, priority: 43,
          stackingGroup: 'aa088-sequence', reasonCode: 'ability.sequence.adjacent-electric-damage',
          value: sequenceDamage,
        }] : []),
        ...(shellCannon ? [{
          id: `ability.shell-cannon.damage.${hash(operation.id)}`, priority: 44,
          stackingGroup: 'aa089-shell-cannon', reasonCode: 'ability.shell-cannon.damage', value: 4,
        }] : []),
        ...(solarPower ? [{
          id: `ability.solar-power.damage.${hash(operation.id)}`, priority: 45,
          stackingGroup: 'aa090-solar-power', reasonCode: 'ability.solar-power.damage',
          value: 5 + actorTick,
        }] : []),
        ...(thunderBoost ? [{
          id: `ability.thunder-boost.damage.${hash(operation.id)}`, priority: 45,
          stackingGroup: 'aa095-thunder-boost', reasonCode: 'ability.thunder-boost.damage', value: 5,
        }] : []),
        ...(transistorTargetId ? [{
          id: `ability.transistor.damage.${hash(operation.id, transistorTargetId)}`, priority: 46,
          stackingGroup: 'aa096-transistor',
          reasonCode: `ability.transistor.vulnerability:${transistorTargetId}`,
          value: 0,
        }] : []),
        ...wobbleTargetIds.map(targetId => ({
          id: `ability.wobble.resistance.${hash(operation.id, targetId)}`,
          priority: 48,
          stackingGroup: `aa099-wobble-resistance:${targetId}`,
          reasonCode: `ability.wobble.resistance:${targetId}`,
          value: 0,
        })),
        ...rksTargetIds.map(targetId => ({
          id: `ability.rks-system.normal-defense.${hash(operation.id, targetId)}`,
          priority: 48,
          stackingGroup: `aa085-rks-system:${targetId}`,
          reasonCode: `ability.rks-system.normal-defense:${targetId}`,
          value: 0,
        })),
      ]
      const moveType = refrigerate
        && typeof operation.payload.damage.moveType === 'string'
        && operation.payload.damage.moveType.trim().toLowerCase() === 'normal'
        ? 'ice'
        : operation.payload.damage.moveType
      const typeEffectiveness = transistor ? {
        immunity: 'honor' as const,
        resistance: 'honor' as const,
        weakness: 'honor' as const,
        passiveImmunity: 'honor' as const,
        effectivenessOverride: null,
        defenderTypeOverrides: [],
      } : operation.payload.damage.typeEffectiveness
      return [{
        ...operation,
        payload: {
          ...operation.payload,
          ...(skillLink ? { count: { kind: 'fixed' as const, hits: 5 } } : {}),
          damage: {
            ...operation.payload.damage,
            moveType,
            ...(preTypeDamageModifiers.length > 0 ? { preTypeDamageModifiers } : {}),
            ...(typeEffectiveness ? { typeEffectiveness } : {}),
          },
        },
      } as MoveMultiHitEffectOperation]
    }
    if (operation.kind === 'roll' && shellCannon
      && operation.payload.formula.kind === 'dice'
      && operation.phase === 'accuracy') {
      return [{
        ...operation,
        payload: {
          ...operation.payload,
          formula: {
            ...operation.payload.formula,
            modifier: operation.payload.formula.modifier + 2,
          },
        },
      }]
    }
    if (operation.kind !== 'damage') return [operation]
    let damageClass = operation.payload.damageClass
    if (trinityOption === AA096_TRINITY_PHYSICAL_OPTION_ID
      && input.script.moveName.trim().toLowerCase() === 'tri attack') damageClass = 'physical'
    let moveType = operation.payload.moveType
    if (refrigerate && typeof moveType === 'string' && moveType.trim().toLowerCase() === 'normal') moveType = 'ice'
    const preTypeDamageModifiers = [
      ...(operation.payload.preTypeDamageModifiers ?? []),
      ...(sequence ? [{
        id: `ability.sequence.damage.${hash(operation.id)}`, priority: 43,
        stackingGroup: 'aa088-sequence', reasonCode: 'ability.sequence.adjacent-electric-damage',
        value: input.context.queries.tokens.all().filter(token => (
          token.id !== actorId
          && token.defenderTypes.some(type => type.trim().toLowerCase() === 'electric')
          && ptuGridDistanceBetweenFootprints(token, input.context.actor.token) <= 1
        )).length * 3,
      }] : []),
      ...(shellCannon ? [{
        id: `ability.shell-cannon.damage.${hash(operation.id)}`, priority: 44,
        stackingGroup: 'aa089-shell-cannon', reasonCode: 'ability.shell-cannon.damage', value: 4,
      }] : []),
      ...(solarPower ? [{
        id: `ability.solar-power.damage.${hash(operation.id)}`, priority: 45,
        stackingGroup: 'aa090-solar-power', reasonCode: 'ability.solar-power.damage',
        value: 5 + actorTick,
      }] : []),
      ...(thunderBoost ? [{
        id: `ability.thunder-boost.damage.${hash(operation.id)}`, priority: 45,
        stackingGroup: 'aa095-thunder-boost', reasonCode: 'ability.thunder-boost.damage', value: 5,
      }] : []),
      ...(transistorTargetId ? [{
        id: `ability.transistor.damage.${hash(operation.id, transistorTargetId)}`, priority: 46,
        stackingGroup: 'aa096-transistor',
        reasonCode: `ability.transistor.vulnerability:${transistorTargetId}`,
        value: 0,
      }] : []),
      ...(responseSelected({ ...input, reasonCode: AA095_TINGLY_TONGUE_REASON }) ? [{
        id: `ability.tingly-tongue.damage.${hash(operation.id)}`, priority: 47,
        stackingGroup: 'aa095-tingly-tongue', reasonCode: 'ability.tingly-tongue.damage', value: 10,
      }] : []),
      ...wobbleTargetIds.map(targetId => ({
        id: `ability.wobble.resistance.${hash(operation.id, targetId)}`, priority: 48,
        stackingGroup: `aa099-wobble-resistance:${targetId}`,
        reasonCode: `ability.wobble.resistance:${targetId}`, value: 0,
      })),
      ...rksTargetIds.map(targetId => ({
        id: `ability.rks-system.normal-defense.${hash(operation.id, targetId)}`, priority: 48,
        stackingGroup: `aa085-rks-system:${targetId}`,
        reasonCode: `ability.rks-system.normal-defense:${targetId}`, value: 0,
      })),
    ]
    let typeEffectiveness = operation.payload.typeEffectiveness
    if (transistor) typeEffectiveness = {
      immunity: 'honor', resistance: 'honor', weakness: 'honor',
      passiveImmunity: 'honor', effectivenessOverride: null, defenderTypeOverrides: [],
    }
    return [{
      ...operation,
      payload: {
        ...operation.payload,
        damageClass,
        moveType,
        ...(preTypeDamageModifiers.length > 0 ? { preTypeDamageModifiers } : {}),
        ...(typeEffectiveness ? { typeEffectiveness } : {}),
      },
    } as MoveDamageEffectOperation]
  }))
}

/** Exact defensive recipients are recovered from server-issued trigger identity. */
export const aa085to100BoundRecipientId = (input: {
  readonly operation: MoveEffectOperation
  readonly request?: MoveReactionRequestEffectOperation | null
}): string | null => {
  if (input.operation.reasonCode.startsWith('ability.receiver.grant.')) {
    const encoded = input.operation.reasonCode.slice('ability.receiver.grant.'.length)
    const boundary = encoded.indexOf('.ability.')
    return boundary > 0 ? encoded.slice(0, boundary) : null
  }
  for (const prefix of [
    'ability.transporter.carry.',
    'ability.transporter.both.',
    'ability.weeble.target.',
    'ability.weeble.accuracy.',
    'ability.wash-away.remove-coat.',
    'ability.refrigerate.winters-kiss-target-heal.',
  ]) {
    if (input.operation.reasonCode.startsWith(prefix)) {
      return input.operation.reasonCode.slice(prefix.length) || null
    }
  }
  const exactRecipientReasons = new Set([
    'ability.soothing-tone.temporary-hp',
    'ability.soothing-tone.used-marker',
    'ability.volt-absorb.heal',
    'ability.water-absorb.heal',
    'ability.windveiled.speed',
    'ability.winters-kiss.target-heal',
    'ability.tingly-tongue.fail-next-paralysis-save',
    'ability.schooling.exit-solo-form',
  ])
  if (!exactRecipientReasons.has(input.operation.reasonCode)
    && !input.operation.reasonCode.startsWith('ability.trinity.condition.')) return null
  return aa085to100TriggerRequirement(input)?.targetId ?? null
}

/** Branch-linked operations execute only for their selected reviewed option. */
export const aa085to100ExpectedOptionForOperation = (
  operation: MoveEffectOperation,
): string | null => operation.reasonCode.startsWith('ability.quick-draw.move.')
  || operation.reasonCode.startsWith('ability.receiver.copy.')
  || operation.reasonCode.startsWith('ability.receiver.grant.')
  ? operation.reasonCode
  : operation.reasonCode.startsWith('ability.transporter.carry.')
    || operation.reasonCode.startsWith('ability.transporter.both.')
    || operation.reasonCode.startsWith('ability.weeble.target.')
    ? operation.reasonCode
    : operation.reasonCode.startsWith('ability.weeble.accuracy.')
      ? `ability.weeble.target.${operation.reasonCode.slice('ability.weeble.accuracy.'.length)}`
  : operation.reasonCode === AA088_SAP_SIPPER_ATTACK_OPTION_ID
    || operation.reasonCode === AA088_SAP_SIPPER_SPECIAL_ATTACK_OPTION_ID
    ? operation.reasonCode
  : operation.reasonCode === 'ability.soulstealer.use-normal'
    || operation.reasonCode === 'ability.soulstealer.use-killed'
    || operation.reasonCode === 'ability.wobble.counter'
    || operation.reasonCode === 'ability.wobble.mirror-coat'
    ? operation.reasonCode
  : operation.reasonCode === 'ability.wallmaster.defense'
    ? 'ability.wallmaster.defense'
    : operation.reasonCode === 'ability.wishmaster.instant'
      ? 'ability.wishmaster.instant'
      : operation.reasonCode.startsWith('ability.wishmaster.stage.')
        ? operation.reasonCode
        : operation.reasonCode === 'ability.wishmaster.cure'
          ? 'ability.wishmaster.cure'
  : operation.reasonCode === 'ability.vicious.extra-standard'
  ? 'ability.vicious.extra-standard'
  : operation.reasonCode === 'ability.vicious.critical-range'
    ? 'ability.vicious.critical-range'
    : operation.reasonCode === 'ability.wobble.counter'
      ? 'ability.wobble.counter'
      : operation.reasonCode === 'ability.wobble.mirror-coat'
        ? 'ability.wobble.mirror-coat'
        : null
