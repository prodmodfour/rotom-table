import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDamageEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveHealEffectOperation,
  MoveMultiHitEffectOperation,
  MoveMovementRequestEffectOperation,
  MoveNestedMoveEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import type { PokemonTypeId } from '#shared/pokemonTypes'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { computeTickValue } from '~/utils/ptuHp'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { computeMultiplier, resistMultiplierOneStepFurther } from '~/utils/typeChart'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveSpecResponseResolver } from '../../moveAutomation/responses'
import { abilityIsCopyable } from '../effectiveAbilities'

export const AA085TO100_REASON_PREFIX = 'ability.remaining.' as const
export const AA085_REFRIGERATE_REASON = 'ability.refrigerate.optional-ice-type' as const
export const AA085_RKS_SYSTEM_REASON = 'ability.rks-system.optional-normal-defense' as const
export const AA085_QUICK_DRAW_REASON = 'ability.quick-draw.optional-interrupt' as const
export const AA085_QUEENLY_MAJESTY_REASON = 'ability.queenly-majesty.optional-stomp' as const
export const AA086_RATTLED_REASON = 'ability.rattled.optional-boost' as const
export const AA086_REVELATION_REASON = 'ability.revelation.optional-copy' as const
export const AA088_SAP_SIPPER_REASON = 'ability.sap-sipper.optional-stage' as const
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
export const AA097_VICIOUS_REASON = 'ability.vicious.optional-branch' as const
export const AA097_VIGOR_REASON = 'ability.vigor.optional-heal' as const
export const AA098_VOODOO_DOLL_REASON = 'ability.voodoo-doll.optional-curse' as const
export const AA098_WANDERING_SPIRIT_REASON = 'ability.wandering-spirit.optional-swap' as const
export const AA098_WASH_AWAY_REASON = 'ability.wash-away.optional-reset' as const
export const AA098_WATER_COMPACTION_REASON = 'ability.water-compaction.optional-defense' as const
export const AA098_WEAK_ARMOR_REASON = 'ability.weak-armor.optional-stages' as const
export const AA098_WEEBLE_REASON = 'ability.weeble.optional-retaliation' as const
export const AA099_WIND_POWER_REASON = 'ability.wind-power.optional-charge' as const
export const AA099_WISTFUL_MELODY_REASON = 'ability.wistful-melody.optional-stages' as const
export const AA099_WOBBLE_REASON = 'ability.wobble.optional-counter' as const

const hash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)
const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')

const instance = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  canonicalId: string,
): string | null => context.queries.abilities.activeForPlacement(placementId)
  .find(ability => ability.canonicalId === canonicalId)?.instanceId ?? null

const sceneAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit?: number
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  return (ledger?.entries.find(entry => (
    entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base'
  ))?.spent ?? 0) < (input.limit ?? 1)
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
}): MoveReactionRequestEffectOperation => {
  const suffix = hash(input.identity, input.canonicalId, input.ownerId, input.reasonCode,
    input.trigger?.targetId ?? 'none')
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
  readonly accuracyRollId?: string | null
  readonly minimum?: number
}): MoveConditionEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'condition', source: input.source,
  recipients: { kind: input.recipients }, phase: input.phase ?? 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    action: 'apply', conditionId: input.conditionId, conditionSource: null,
    filter: null, randomChoice: null,
    ...(input.accuracyRollId && input.minimum
      ? { accuracyRollTrigger: {
          rollId: input.accuracyRollId,
          trigger: { kind: 'range', minimum: input.minimum },
        } }
      : {}),
    duration: input.rounds
      ? {
          effectId: `${input.id}.duration`,
          duration: { kind: 'rounds', boundary: 'end', remaining: input.rounds },
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
  readonly mode?: 'gain' | 'lose'
  readonly pool?: 'hit-points' | 'temporary-hit-points'
  readonly phase?: MoveDirectHpEffectOperation['phase']
}): MoveDirectHpEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'direct-hp', source: input.source,
  recipients: { kind: input.recipients }, phase: input.phase ?? 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    mode: input.mode ?? 'lose', pool: input.pool ?? 'hit-points',
    calculation: input.calculation, copySource: null,
    bounds: { minimum: 0, maximum: null }, rounding: 'floor',
    applyTypeImmunity: false, cost: null,
    injury: { hitPointMarkers: 'apply', massiveDamage: 'never' },
  },
}, input.id) as MoveDirectHpEffectOperation

const heal = (input: {
  readonly id: string
  readonly source: MoveEffectOperation['source']
  readonly recipients: MoveHealEffectOperation['recipients']['kind']
  readonly reasonCode: string
  readonly percent?: number
  readonly value?: number
  readonly phase?: MoveHealEffectOperation['phase']
}): MoveHealEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'heal', source: input.source,
  recipients: { kind: input.recipients }, phase: input.phase ?? 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    mode: 'gain', pool: 'hit-points',
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
}): MoveTemporaryEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'temporary-effect', source: input.source,
  recipients: { kind: input.recipients }, phase: 'schedule',
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

const selectedRequest = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
  readonly reasonCode: string
}): MoveReactionRequestEffectOperation | null => input.operations.find((operation): operation is MoveReactionRequestEffectOperation => (
  operation.kind === 'reaction-request'
  && operation.reasonCode === input.reasonCode
  && input.responses.resolve({
    requestId: operation.payload.requestId,
    options: operation.payload.options,
    allowPass: operation.payload.allowPass,
  })?.optionId !== null
  && input.responses.resolve({
    requestId: operation.payload.requestId,
    options: operation.payload.options,
    allowPass: operation.payload.allowPass,
  })?.optionId !== undefined
)) ?? null

const accuracyRollId = (operations: readonly MoveEffectOperation[]): string | null => operations.flatMap(operation => (
  operation.kind === 'damage' && operation.payload.accuracyRollId
    ? [operation.payload.accuracyRollId]
    : operation.kind === 'multi-hit' && operation.payload.accuracy.kind !== 'automatic'
      ? [operation.payload.accuracy.rollId]
      : []
))[0] ?? null

const faintReactionOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly identity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const faintCandidate = input.targetIds[0]
  if (!faintCandidate) return []
  const operations: MoveEffectOperation[] = []
  const faintedToken = input.context.queries.tokens.get(faintCandidate)
  for (const provider of input.context.queries.tokens.all()) {
    if (provider.currentHp <= 0) continue
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
          canonicalId: 'Receiver', limit: 2,
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
        copyable.forEach((candidate, index) => operations.push(temporary({
          id: `ability.receiver.copy.${hash(input.identity, provider.id, candidate.instanceId)}`,
          source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
          reasonCode: optionIds[index]!, tag: 'aa086-receiver-copy',
          kind: 'creature-rule-overlay',
          payload: {
            domain: 'ability', action: 'add', values: [candidate.canonicalId],
            referencePlacementId: faintCandidate, suppressionScope: null,
          },
          duration: { kind: 'scene', remaining: null },
        })))
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
        id: `ability.soul-heart.satk.${hash(input.identity, provider.id)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.soul-heart.special-attack', stat: 'satk', value: 2,
      }),
      directHp({
        id: `ability.soul-heart.temporary-hp.${hash(input.identity, provider.id)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.soul-heart.temporary-hp', mode: 'gain',
        pool: 'temporary-hit-points', calculation: { kind: 'percent-max', percent: 10 },
      }),
    )
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
  const eligible = new Set(['burned', 'frozen', 'paralysis', 'poisoned', 'badly-poisoned', 'sleep'])
  for (const sourceOperation of input.reviewedOperations) {
    if (sourceOperation.kind !== 'condition' || sourceOperation.payload.action !== 'apply'
      || !sourceOperation.payload.conditionId) continue
    const conditionId = sourceOperation.payload.conditionId.trim().toLowerCase().replace(/\s+/g, '-')
    for (const targetId of input.targetIds) {
      if (conditionId === 'flinch') {
        const abilityId = instance(input.context, targetId, 'Steadfast')
        if (abilityId && input.context.queries.resources.actionAvailable(targetId, 'free')) {
          const req = {
            ...request({
              identity: input.identity, canonicalId: 'Steadfast', reasonCode: AA092_STEADFAST_REASON,
              ownerId: targetId, phase: 'after-damage', timing: 'cleanup', priority: 82,
            }),
            source: { kind: 'operation' as const, id: sourceOperation.id },
          }
          operations.push(req, stage({
            id: `ability.steadfast.speed.${hash(input.identity, targetId, sourceOperation.id)}`,
            source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
            reasonCode: 'ability.steadfast.speed', stat: 'spd', value: 1,
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
          ownerId: targetId, phase: 'after-damage', timing: 'cleanup', priority: 81,
        }),
        source: { kind: 'operation' as const, id: sourceOperation.id },
      }
      operations.push(req, condition({
        id: `ability.synchronize.condition.${hash(input.identity, targetId, sourceOperation.id)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'actor',
        reasonCode: 'ability.synchronize.copy-condition', conditionId,
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
  const rollId = accuracyRollId(input.reviewedOperations)
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
  if (rollId && input.context.queries.abilities.has(actorId, 'Stench')) {
    const existingFlinch = input.reviewedOperations.some(operation => (
      operation.kind === 'condition'
      && operation.payload.conditionId?.trim().toLowerCase() === 'flinch'
    ))
    operations.push(condition({
      id: `ability.stench.flinch.${hash(input.identity, 'stench')}`,
      source: { kind: 'move', id: input.identity }, recipients: 'hit-targets',
      reasonCode: 'ability.stench.flinch', conditionId: 'Flinch',
      accuracyRollId: rollId, minimum: existingFlinch ? 15 : 18,
    }))
  }
  if (rollId && input.context.queries.abilities.has(actorId, 'Ugly')) {
    const existingFlinch = input.reviewedOperations.some(operation => (
      operation.kind === 'condition'
      && operation.payload.conditionId?.trim().toLowerCase() === 'flinch'
    ))
    operations.push(condition({
      id: `ability.ugly.flinch.${hash(input.identity, 'ugly')}`,
      source: { kind: 'move', id: input.identity }, recipients: 'hit-targets',
      reasonCode: 'ability.ugly.flinch', conditionId: 'Flinch',
      accuracyRollId: rollId, minimum: existingFlinch ? 17 : 19,
    }))
  }
  if (input.script.moveName.trim().toLowerCase() === 'string shot'
    && input.context.queries.abilities.has(actorId, 'Silk Threads')) {
    const suffix = hash(input.identity, 'silk-threads')
    operations.push(
      condition({
        id: `ability.silk-threads.slowed.${suffix}`,
        source: { kind: 'move', id: input.identity }, recipients: 'hit-targets',
        reasonCode: 'ability.silk-threads.slowed', conditionId: 'Slowed', rounds: 1,
      }),
      condition({
        id: `ability.silk-threads.vulnerable.${suffix}`,
        source: { kind: 'move', id: input.identity }, recipients: 'hit-targets',
        reasonCode: 'ability.silk-threads.vulnerable', conditionId: 'Vulnerable', rounds: 1,
      }),
    )
  }
  if (input.context.queries.abilities.has(actorId, 'Stance Change')) {
    const shieldMove = ['king’s shield', "king's shield", 'protect'].includes(input.script.moveName.trim().toLowerCase())
      || input.script.damageClass?.trim().toLowerCase() === 'status'
        && /(?:raise|gain).*(?:defense|special defense)|blessing/i.test(input.script.effect)
    if (input.script.damaging || shieldMove) operations.push(temporary({
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
        directHp({
          id: `ability.soothing-tone.temporary-hp.${suffix}`, source,
          recipients: 'attacked-targets', reasonCode: 'ability.soothing-tone.temporary-hp',
          mode: 'gain', pool: 'temporary-hit-points',
          calculation: { kind: 'fixed', value: Math.max(0, input.context.actor.token.satk) },
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
  if (input.context.queries.abilities.has(actorId, 'Thrust')
    && input.script.damaging
    && input.script.damageClass?.trim().toLowerCase() === 'physical'
    && !input.reviewedOperations.some(operation => (
      operation.kind === 'movement-request'
      && operation.payload.mode === 'forced'
      && operation.payload.displacement?.vector.kind === 'away'
    ))) {
    const damage = input.reviewedOperations.find(operation => operation.kind === 'damage')
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
    if (!parameterType || parameterType === input.script.type.trim().toLowerCase()) operations.push(temporary({
      id: `ability.type-strategist.dr.${hash(input.identity, input.script.type)}`,
      source: { kind: 'move', id: input.identity }, recipients: 'actor',
      reasonCode: 'ability.type-strategist.damage-reduction', tag: 'aa096-type-strategist',
      kind: 'capability', payload: { capabilityId: 'aa096.type-strategist.dr', action: 'grant' },
    }))
  }
  if (input.script.type.trim().toLowerCase() === 'ice'
    && input.context.queries.abilities.has(actorId, 'Winter’s Kiss')) {
    operations.push(heal({
      id: `ability.winters-kiss.user-heal.${hash(input.identity, actorId)}`,
      source: { kind: 'move', id: input.identity }, recipients: 'actor',
      reasonCode: 'ability.winters-kiss.user-heal', percent: 10,
    }))
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
        phase: 'after-damage', timing: 'post-damage', trigger: { requirement: 'damaged', targetId },
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
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const type = input.script.type.trim().toLowerCase()
  const melee = /\bmelee\b/i.test(input.script.range)
  const oneTarget = input.targetIds.length === 1
  const addActorRequest = (
    canonicalId: string,
    reasonCode: string,
    options?: readonly string[],
    trigger?: Aa085To100TriggerRequirement,
  ): MoveReactionRequestEffectOperation | null => {
    const abilityId = instance(input.context, actorId, canonicalId)
    const dailyAbility = ['Vigor', 'Voodoo Doll', 'Wash Away'].includes(canonicalId)
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

  if (input.script.damaging && type === 'normal') {
    const req = addActorRequest('Refrigerate', AA085_REFRIGERATE_REASON)
    if (req) operations.push(req)
  }
  if (input.script.keywords.some(keyword => /five\s*strike/i.test(keyword))) {
    const req = addActorRequest(
      'Skill Link', AA089_SKILL_LINK_REASON, undefined,
      input.targetIds[0] ? { requirement: 'hit', targetId: input.targetIds[0] } : undefined,
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
        ownerId: actorId, phase: 'declare', timing: 'declare', priority: 92,
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
  if (input.script.damaging && input.targetIds[0]) {
    const req = addActorRequest('Soulstealer', AA091_SOULSTEALER_REASON, undefined, {
      requirement: 'fainted', targetId: input.targetIds[0],
    })
    if (req) operations.push(req, heal({
      id: `ability.soulstealer.heal.${hash(input.identity)}`,
      source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
      reasonCode: 'ability.soulstealer.heal-and-injury', percent: 25, phase: 'cleanup',
    }))
  }
  const shellMoves = new Set([
    'aqua jet', 'dive', 'flash cannon', 'hydro cannon', 'hydro pump',
    'tackle', 'waterfall', 'water gun', 'water spout',
  ])
  if (shellMoves.has(input.script.moveName.trim().toLowerCase())) {
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
      calculation: { kind: 'fixed', value: Math.max(0, input.context.actor.token.satk) },
    }))
  }
  if (input.script.moveName.trim().toLowerCase() === 'endure') {
    const req = addActorRequest('Vigor', AA097_VIGOR_REASON)
    if (req) operations.push(req, heal({
      id: `ability.vigor.heal.${hash(input.identity)}`,
      source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
      reasonCode: 'ability.vigor.tick-after-endure', percent: 10, phase: 'cleanup',
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
  if (input.script.damaging && oneTarget
    && !/\bmelee\b/i.test(input.script.range)) {
    const targetId = input.targetIds[0]!
    const target = input.context.queries.tokens.get(targetId)
    const airborne = Boolean(target && (
      Number(target.movementCapabilities?.sky ?? 0) > 0
      || Number(target.movementCapabilities?.levitate ?? 0) > 0
    ))
    const req = airborne
      ? addActorRequest('Spray Down', AA091_SPRAY_DOWN_REASON, undefined, {
          requirement: 'hit', targetId,
        })
      : null
    if (req) operations.push(req, temporary({
      id: `ability.spray-down.grounded.${hash(input.identity, targetId)}`,
      source: { kind: 'operation', id: req.id }, recipients: 'hit-targets',
      reasonCode: 'ability.spray-down.grounded', tag: 'aa091-spray-down-grounded',
      payload: { capabilityId: 'aa091.spray-down.grounded', action: 'grant' },
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 3 },
    }))
  }
  if (type === 'water' && input.script.damaging && input.targetIds.length > 0) {
    const req = addActorRequest('Wash Away', AA098_WASH_AWAY_REASON, undefined, {
      requirement: 'hit', targetId: input.targetIds[0]!,
    })
    if (req) operations.push(req, parseMoveEffectOperation({
      id: `ability.wash-away.reset.${hash(input.identity)}`,
      kind: 'combat-stage', source: { kind: 'operation', id: req.id },
      recipients: { kind: 'hit-targets' }, phase: 'hit',
      reasonCode: 'ability.wash-away.reset-stages',
      payload: {
        action: 'reset', stage: 'all-stats', selectedStage: null,
        value: null, stageSource: null, rounding: null,
      },
    }, 'ability.washAway.reset'))
  }
  if (type === 'electric' && input.script.damaging && oneTarget) {
    const req = addActorRequest('Transistor', AA096_TRANSISTOR_REASON, undefined, {
      requirement: 'hit', targetId: input.targetIds[0]!,
    })
    if (req) operations.push(req)
  }
  if (input.script.moveName.trim().toLowerCase() === 'hone claws') {
    const req = addActorRequest('Vicious', AA097_VICIOUS_REASON, [
      'ability.vicious.extra-standard', 'ability.vicious.critical-range',
    ])
    if (req) operations.push(
      req,
      temporary({
        id: `ability.vicious.extra-standard.${hash(input.identity)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.vicious.extra-standard', tag: 'aa097-vicious-extra-standard',
        payload: { capabilityId: 'aa097.vicious.extra-standard', action: 'grant' },
        duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      }),
      temporary({
        id: `ability.vicious.critical.${hash(input.identity)}`,
        source: { kind: 'operation', id: req.id }, recipients: 'response-owner',
        reasonCode: 'ability.vicious.critical-range', tag: 'aa097-vicious-critical',
        kind: 'numeric-modifier',
        payload: { attribute: 'critical-range', operation: 'add', value: 2, rounding: 'none' },
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
  if (input.script.damaging && oneTarget && melee) {
    const targetId = input.targetIds[0]!
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
        duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      }),
    )
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
      }),
    )
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
  const priorityMove = input.script.keywords.some(keyword => /\bpriority\b/i.test(keyword))
    || /\bpriority\b/i.test(input.script.range)
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
        && sceneAvailable({
          context: input.context, ownerId: provider.id, abilityInstanceId: abilityId,
          canonicalId: 'Queenly Majesty', limit: 2,
        })) {
        const req = request({
          identity: input.identity, canonicalId: 'Queenly Majesty',
          reasonCode: AA085_QUEENLY_MAJESTY_REASON, ownerId: provider.id,
          phase: 'declare', timing: 'declare', priority: 180,
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
      const sheet = input.context.queries.sheets.forPlacement(providerPlacement)
      const moves = sheet?.kind === 'pokemon'
        ? [...new Set((sheet.sheet as CharacterSheet).movelist?.map(move => move.name.trim()).filter(Boolean) ?? [])]
          .filter(moveName => input.context.queries.rules.runtimeFor(moveName) !== null)
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
    const protectedAllyId = input.targetIds.find(targetId => (
      targetId !== provider.id
      && input.context.queries.relationships.resolve(provider.id, targetId).relationship === 'ally'
    ))
    if (protectedAllyId && instance(input.context, provider.id, 'Spiteful Intervention')
      && input.context.queries.resources.actionAvailable(provider.id, 'standard')) {
      const req = request({
        identity: input.identity, canonicalId: 'Spiteful Intervention',
        reasonCode: 'ability.spiteful-intervention.optional-spite', ownerId: provider.id,
        phase: 'hit', timing: 'post-hit', priority: 165,
        trigger: { requirement: 'hit', targetId: protectedAllyId },
      })
      operations.push(req, nested({
        id: `ability.spiteful-intervention.spite.${hash(input.identity, provider.id, protectedAllyId)}`,
        requestId: req.id, canonicalId: 'Spite', reasonCode: 'ability.spiteful-intervention.spite',
        recipients: 'actor', targeting: 'operation-recipients', phase: 'hit',
      }))
    }
    const areaAttack = input.script.damaging && (input.script.areaTemplates?.length ?? 0) > 0
    if (areaAttack && input.targetIds.includes(provider.id) && relationship === 'ally'
      && instance(input.context, provider.id, 'Telepathy')
      && input.context.queries.resources.actionAvailable(provider.id, 'free')) {
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
          mode: 'voluntary', distance: 1,
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
    && !input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'melee')
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
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const type = input.script.type.trim().toLowerCase()
  const melee = /\bmelee\b/i.test(input.script.range)
  for (const targetId of input.targetIds) {
    const target = input.context.queries.tokens.get(targetId)
    if (!target) continue
    const suffix = hash(input.identity, targetId)
    const optional = (canonicalId: string, reasonCode: string, requirement: Aa085To100TriggerRequirement['requirement'] = 'hit', options?: readonly string[]) => {
      const abilityId = instance(input.context, targetId, canonicalId)
      const action = canonicalId === 'Weeble' ? 'standard'
        : canonicalId === 'Steam Engine' ? 'swift' : 'free'
      if (!abilityId || !input.context.queries.resources.actionAvailable(targetId, action)) return null
      if (!['Rattled', 'Rough Skin', 'Spinning Dance', 'Stamina', 'Water Compaction', 'Weak Armor'].includes(canonicalId)
        && !sceneAvailable({
          context: input.context, ownerId: targetId, abilityInstanceId: abilityId,
          canonicalId, limit: canonicalId === 'Steam Engine' ? 2 : 1,
        })) return null
      return request({
        identity: input.identity, canonicalId, reasonCode, ownerId: targetId,
        optionIds: options,
        phase: requirement === 'damaged' || requirement === 'massive' ? 'after-damage' : 'hit',
        timing: requirement === 'damaged' || requirement === 'massive' ? 'post-damage' : 'post-hit',
        trigger: { requirement, targetId }, priority: 80,
      })
    }
    if (['bug', 'dark', 'ghost'].includes(type)) {
      const req = optional('Rattled', AA086_RATTLED_REASON)
      if (req) operations.push(
        req,
        stage({
          id: `ability.rattled.speed.${suffix}`, source: { kind: 'operation', id: req.id },
          recipients: 'response-owner', reasonCode: 'ability.rattled.speed', stat: 'spd', value: 1,
        }),
        temporary({
          id: `ability.rattled.disengage.${suffix}`, source: { kind: 'operation', id: req.id },
          recipients: 'response-owner', reasonCode: 'ability.rattled.disengage', tag: 'aa086-rattled-disengage',
          payload: { capabilityId: 'aa086.rattled.free-disengage', action: 'grant' },
          duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
        }),
      )
    }
    if (input.script.damaging) {
      const stalwart = optional('Stalwart', AA092_STALWART_REASON, 'massive')
      if (stalwart) for (const statId of ['atk', 'satk', 'def', 'sdef'] as const) operations.push(
        ...(statId === 'atk' ? [stalwart] : []),
        stage({
          id: `ability.stalwart.${statId}.${suffix}`,
          source: { kind: 'operation', id: stalwart.id }, recipients: 'response-owner',
          reasonCode: `ability.stalwart.${statId}`, stat: statId, value: 1,
        }),
      )
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
      const sandSpit = ptuGridDistanceBetweenFootprints(input.context.actor.token, target) <= 2
        ? optional('Sand Spit', 'ability.sand-spit.optional-sand-attack', 'damaged') : null
      if (sandSpit) operations.push(sandSpit, nested({
        id: `ability.sand-spit.sand-attack.${suffix}`, requestId: sandSpit.id,
        canonicalId: 'Sand Attack', reasonCode: 'ability.sand-spit.sand-attack',
        recipients: 'actor', targeting: 'operation-recipients',
      }))
      const steamEngine = ['fire', 'water'].includes(type)
        ? optional('Steam Engine', 'ability.steam-engine.optional-smokescreen') : null
      if (steamEngine) operations.push(steamEngine, nested({
        id: `ability.steam-engine.smokescreen.${suffix}`, requestId: steamEngine.id,
        canonicalId: 'Smokescreen', reasonCode: 'ability.steam-engine.smokescreen',
        recipients: 'response-owner', targeting: 'operation-recipients',
      }))
      const wobble = optional('Wobble', AA099_WOBBLE_REASON, 'damaged', [
        'ability.wobble.counter', 'ability.wobble.mirror-coat',
      ])
      if (wobble) operations.push(
        wobble,
        nested({
          id: `ability.wobble.counter.${suffix}`, requestId: wobble.id,
          canonicalId: 'Counter', reasonCode: 'ability.wobble.counter',
        }),
        nested({
          id: `ability.wobble.mirror-coat.${suffix}`, requestId: wobble.id,
          canonicalId: 'Mirror Coat', reasonCode: 'ability.wobble.mirror-coat',
        }),
      )
    }
    const spinning = optional('Spinning Dance', AA091_SPINNING_DANCE_REASON, 'missed')
    if (spinning && !normalizeConditionNames(target.conditions).some(condition => (
      ['Fainted', 'Paralysis', 'Sleep'].includes(condition)
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
      const staticRequest = optional('Static', AA092_STATIC_REASON)
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
          recipients: 'actor', reasonCode: 'ability.tangling-hair.slowed', conditionId: 'Slowed', rounds: 1,
        }),
      )
      const wandering = optional('Wandering Spirit', AA098_WANDERING_SPIRIT_REASON)
      if (wandering) operations.push(wandering, temporary({
        id: `ability.wandering-spirit.pending-swap.${suffix}`,
        source: { kind: 'operation', id: wandering.id }, recipients: 'response-owner',
        reasonCode: 'ability.wandering-spirit.swap', tag: 'aa098-wandering-spirit-swap',
        payload: { capabilityId: 'aa098.wandering-spirit.swap-resolved', action: 'grant' },
        duration: { kind: 'scene', remaining: null },
      }))
    }
    const rks = optional('RKS System', AA085_RKS_SYSTEM_REASON)
    if (rks) operations.push(rks)
    if (type === 'flying') {
      const wind = optional('Wind Power', AA099_WIND_POWER_REASON)
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
  return Object.freeze([
    ...faintReactionOperations({
      ...input, identity, targetIds: input.authoritativeTargetIds,
    }),
    ...conditionReactionOperations({
      ...input, identity, targetIds: input.authoritativeTargetIds,
    }),
    ...staticEffectRangeOperations({
      ...input, identity, targetIds: input.authoritativeTargetIds,
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
  const solarPower = responseSelected({ ...input, reasonCode: AA090_SOLAR_POWER_REASON })
  const transistor = responseSelected({ ...input, reasonCode: AA096_TRANSISTOR_REASON })
  const thunderBoost = responseSelected({ ...input, reasonCode: AA095_THUNDER_BOOST_REASON })
  const rksSystem = selectedRequest({ ...input, reasonCode: AA085_RKS_SYSTEM_REASON })
  const sereneGrace = input.context.queries.abilities.has(actorId, 'Serene Grace')
  const sheerForce = input.context.queries.abilities.has(actorId, 'Sheer Force')
  const hasEffectRange = input.operations.some(operation => (
    input.moveOwnedOperationIds.has(operation.id)
    && (operation.kind === 'condition' && operation.payload.accuracyRollTrigger
      || operation.kind === 'combat-stage' && operation.payload.trigger?.kind === 'accuracy-roll')
  ))
  const actorTick = computeTickValue(
    input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp,
  )
  const rksTarget = rksSystem ? aa085to100TriggerRequirement({ operation: rksSystem })?.targetId : null
  const rksToken = rksTarget ? input.context.queries.tokens.get(rksTarget) : null
  return Object.freeze(input.operations.flatMap((operation): readonly MoveEffectOperation[] => {
    if (!input.moveOwnedOperationIds.has(operation.id)) return [operation]
    if (sheerForce && hasEffectRange
      && (operation.kind === 'condition' && operation.payload.accuracyRollTrigger
        || operation.kind === 'combat-stage' && operation.payload.trigger?.kind === 'accuracy-roll')) return []
    if (operation.kind === 'condition' && operation.payload.accuracyRollTrigger && sereneGrace) {
      return [{
        ...operation,
        payload: {
          ...operation.payload,
          accuracyRollTrigger: {
            ...operation.payload.accuracyRollTrigger,
            trigger: lowerNaturalMinimum(operation.payload.accuracyRollTrigger.trigger, 2),
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
    if (operation.kind === 'movement-request'
      && input.context.queries.abilities.has(actorId, 'Thrust')
      && operation.payload.mode === 'forced'
      && operation.payload.displacement?.vector.kind === 'away'
      && typeof operation.payload.distance === 'number') {
      return [{
        ...operation,
        payload: { ...operation.payload, distance: operation.payload.distance + 1 },
      }]
    }
    if (operation.kind === 'multi-hit' && skillLink) {
      return [{ ...operation, payload: { ...operation.payload, count: { kind: 'fixed', hits: 5 } } } as MoveMultiHitEffectOperation]
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
    let moveType = operation.payload.moveType
    if (refrigerate && typeof moveType === 'string' && moveType.trim().toLowerCase() === 'normal') moveType = 'ice'
    const preTypeDamageModifiers = [
      ...(operation.payload.preTypeDamageModifiers ?? []),
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
      ...(transistor ? [{
        id: `ability.transistor.damage.${hash(operation.id)}`, priority: 46,
        stackingGroup: 'aa096-transistor', reasonCode: 'ability.transistor.vulnerability', value: 0,
      }] : []),
      ...(responseSelected({ ...input, reasonCode: AA095_TINGLY_TONGUE_REASON }) ? [{
        id: `ability.tingly-tongue.damage.${hash(operation.id)}`, priority: 47,
        stackingGroup: 'aa095-tingly-tongue', reasonCode: 'ability.tingly-tongue.damage', value: 10,
      }] : []),
    ]
    let typeEffectiveness = operation.payload.typeEffectiveness
    if (transistor) typeEffectiveness = {
      immunity: 'ignore', resistance: 'honor', weakness: 'honor',
      passiveImmunity: 'ignore', effectivenessOverride: null, defenderTypeOverrides: [],
    }
    if (rksToken && typeof moveType === 'string') {
      const alreadyNormal = rksToken.defenderTypes
        .some(type => type.trim().toLowerCase() === 'normal')
      const normalMultiplier = computeMultiplier(moveType, ['Normal'])
      const ordinaryMultiplier = computeMultiplier(moveType, rksToken.defenderTypes)
      typeEffectiveness = {
        immunity: 'honor', resistance: 'honor', weakness: 'honor',
        passiveImmunity: 'honor',
        effectivenessOverride: alreadyNormal
          ? resistMultiplierOneStepFurther(ordinaryMultiplier)
          : normalMultiplier,
        defenderTypeOverrides: [],
      }
    }
    return [{
      ...operation,
      payload: {
        ...operation.payload,
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
  const exactRecipientReasons = new Set([
    'ability.soothing-tone.temporary-hp',
    'ability.soothing-tone.used-marker',
    'ability.volt-absorb.heal',
    'ability.water-absorb.heal',
    'ability.windveiled.speed',
    'ability.winters-kiss.target-heal',
  ])
  if (!exactRecipientReasons.has(input.operation.reasonCode)) return null
  return aa085to100TriggerRequirement(input)?.targetId ?? null
}

/** Branch-linked operations execute only for their selected reviewed option. */
export const aa085to100ExpectedOptionForOperation = (
  operation: MoveEffectOperation,
): string | null => operation.reasonCode.startsWith('ability.quick-draw.move.')
  || operation.reasonCode.startsWith('ability.receiver.copy.')
  ? operation.reasonCode
  : operation.reasonCode === 'ability.vicious.extra-standard'
  ? 'ability.vicious.extra-standard'
  : operation.reasonCode === 'ability.vicious.critical-range'
    ? 'ability.vicious.critical-range'
    : operation.reasonCode === 'ability.wobble.counter'
      ? 'ability.wobble.counter'
      : operation.reasonCode === 'ability.wobble.mirror-coat'
        ? 'ability.wobble.mirror-coat'
        : null
