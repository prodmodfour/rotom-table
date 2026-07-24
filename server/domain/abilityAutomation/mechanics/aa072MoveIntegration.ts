import { createHash } from 'node:crypto'
import type {
  MoveChoiceRequestEffectOperation,
  MoveCombatStageEffectOperation,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveMultiHitEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { AA072_GORILLA_LOCK_CAPABILITY } from '#shared/abilityAutomation/aa072'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveSpecResponseResolver } from '../../moveAutomation/responses'
import { resolveMoveAutomationItemRuleIdentity } from '../../moveAutomation/itemRuleData'

export const AA072_GALE_WINGS_REASON = 'ability.gale-wings.optional-flying-type' as const
export const AA072_GALVANIZE_REASON = 'ability.galvanize.optional-electric-type' as const
export const AA072_GIVER_REASON = 'ability.giver.optional-present-roll' as const
export const AA072_GLUTTONY_DIGEST_REASON = 'ability.gluttony.choose-food-buff' as const
export const AA072_GOOEY_REASON = 'ability.gooey.optional-speed-stage' as const
export const AA072_GORE_REASON = 'ability.gore.optional-double-strike' as const
export const AA072_GORILLA_TACTICS_REASON = 'ability.gorilla-tactics.optional-lock' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)
const codePointOrder = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit: number
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  const spent = ledger?.entries.find(entry => (
    entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base'
  ))?.spent ?? 0
  return spent < input.limit
}

const optionalRequest = (input: {
  readonly id: string
  readonly moveSourceId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly options: readonly { readonly id: string; readonly labelKey: string }[]
  readonly ownerId: string
  readonly phase: MoveReactionRequestEffectOperation['phase']
  readonly timing: MoveReactionRequestEffectOperation['payload']['timing']
  readonly priority: number
  readonly sourceEventId?: string
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: input.sourceEventId
    ? { kind: 'lifecycle-event', id: input.sourceEventId }
    : { kind: 'move', id: `ability.aa072.move.${shortHash(input.moveSourceId)}` },
  recipients: { kind: 'none' },
  phase: input.phase,
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: input.promptKey,
    options: [...input.options],
    allowPass: true,
    timing: input.timing,
    priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

const requiredChoice = (input: {
  readonly id: string
  readonly moveSourceId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly options: readonly { readonly id: string; readonly labelKey: string }[]
}): MoveChoiceRequestEffectOperation => ({
  id: input.id,
  kind: 'choice-request',
  source: { kind: 'move', id: `ability.aa072.move.${shortHash(input.moveSourceId)}` },
  recipients: { kind: 'actor' },
  phase: 'declare',
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: input.promptKey,
    options: [...input.options],
    allowPass: false,
  },
})

const gooeyStage = (requestId: string, suffix: string): MoveCombatStageEffectOperation => ({
  id: `ability.gooey.speed.${suffix}`,
  kind: 'combat-stage',
  source: { kind: 'operation', id: requestId },
  recipients: { kind: 'actor' },
  phase: 'after-damage',
  reasonCode: 'ability.gooey.lower-speed',
  payload: {
    action: 'modify', stage: 'spd', selectedStage: null, value: -1,
    stageSource: null, rounding: null,
  },
})

const temporaryCapability = (input: {
  readonly requestId: string
  readonly id: string
  readonly capabilityId: string
  readonly tags: readonly string[]
}): MoveTemporaryEffectOperation => ({
  id: input.id,
  kind: 'temporary-effect',
  source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'response-owner' },
  phase: 'schedule',
  reasonCode: 'ability.gorilla-tactics.restriction',
  payload: {
    action: 'add', effectId: input.id, recipientScope: 'placements',
    definition: {
      kind: 'capability', duration: { kind: 'scene', remaining: null },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: [...input.tags],
      payload: { capabilityId: input.capabilityId, action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['gorilla-tactics'] },
      transferPolicy: 'expire',
    },
  },
})

const temporaryMoveRestriction = (input: {
  readonly requestId: string
  readonly id: string
  readonly canonicalMoveIds: readonly string[]
}): MoveTemporaryEffectOperation => ({
  id: input.id,
  kind: 'temporary-effect',
  source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'response-owner' },
  phase: 'schedule',
  reasonCode: 'ability.gorilla-tactics.move-restriction',
  payload: {
    action: 'add', effectId: input.id, recipientScope: 'placements',
    definition: {
      kind: 'move-list-overlay', duration: { kind: 'scene', remaining: null },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa072', 'gorilla-tactics', 'move-restriction'],
      payload: { action: 'restrict', canonicalMoveIds: [...input.canonicalMoveIds] },
      dispel: { policy: 'matching-tags', tags: ['gorilla-tactics'] },
      transferPolicy: 'expire',
    },
  },
})

const temporaryDamageBonus = (input: {
  readonly requestId: string
  readonly id: string
}): MoveTemporaryEffectOperation => ({
  id: input.id,
  kind: 'temporary-effect',
  source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'response-owner' },
  phase: 'schedule',
  reasonCode: 'ability.gorilla-tactics.damage-bonus',
  payload: {
    action: 'add', effectId: input.id, recipientScope: 'placements',
    definition: {
      kind: 'numeric-modifier', duration: { kind: 'scene', remaining: null },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa072', 'gorilla-tactics', 'damage'],
      payload: { attribute: 'damage', operation: 'add', value: 10, rounding: 'none' },
      dispel: { policy: 'matching-tags', tags: ['gorilla-tactics'] },
      transferPolicy: 'expire',
    },
  },
})

const responseOption = (
  operation: MoveReactionRequestEffectOperation | MoveChoiceRequestEffectOperation,
  responses: MoveSpecResponseResolver,
): string | null | undefined => responses.resolve({
  requestId: operation.payload.requestId,
  options: operation.payload.options,
  allowPass: operation.payload.allowPass,
})?.optionId

const selected = (
  operation: MoveReactionRequestEffectOperation | MoveChoiceRequestEffectOperation,
  responses: MoveSpecResponseResolver,
  optionId: string,
): boolean => responseOption(operation, responses) === optionId

export const aa072SelectedMoveType = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
}): 'flying' | 'electric' | null => {
  const request = (reasonCode: string) => input.operations.find((operation): operation is MoveReactionRequestEffectOperation | MoveChoiceRequestEffectOperation => (
    (operation.kind === 'reaction-request' || operation.kind === 'choice-request')
    && operation.reasonCode === reasonCode
  ))
  const gale = request(AA072_GALE_WINGS_REASON)
  if (gale && selected(gale, input.responses, 'ability.gale-wings.flying')) return 'flying'
  const galvanize = request(AA072_GALVANIZE_REASON)
  return galvanize && selected(galvanize, input.responses, 'ability.galvanize.electric')
    ? 'electric'
    : null
}

/** Apply response-selected AA-072 type and Double Strike branches before operation execution. */
export const applyAa072SelectedMoveOperations = (input: {
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
  /** Operations emitted by the reviewed Move definition/handler, excluding independent ability overlays. */
  readonly moveOwnedOperationIds: ReadonlySet<string>
  readonly responses: MoveSpecResponseResolver
}): readonly MoveEffectOperation[] => {
  const request = (reasonCode: string) => input.operations.find((operation): operation is MoveReactionRequestEffectOperation | MoveChoiceRequestEffectOperation => (
    (operation.kind === 'reaction-request' || operation.kind === 'choice-request')
    && operation.reasonCode === reasonCode
  ))
  const moveType = aa072SelectedMoveType(input)
  let operations = input.operations.map((operation): MoveEffectOperation => {
    if (!moveType || !input.moveOwnedOperationIds.has(operation.id)) return operation
    if (operation.kind === 'damage') return {
      ...operation, payload: { ...operation.payload, moveType },
    }
    if (operation.kind === 'multi-hit') return {
      ...operation,
      payload: { ...operation.payload, damage: { ...operation.payload.damage, moveType } },
    }
    return operation
  })
  const gluttony = request(AA072_GLUTTONY_DIGEST_REASON)
  const selectedFoodBuff = gluttony
    ? responseOption(gluttony, input.responses)?.match(/^ability\.gluttony\.digest\.(\d+)\.(.+)$/) ?? null
    : null
  if (selectedFoodBuff) {
    const storageSlot = Number(selectedFoodBuff[1])
    const canonicalItemId = selectedFoodBuff[2]!
    if (Number.isSafeInteger(storageSlot) && storageSlot >= 1 && storageSlot <= 4) {
      operations = operations.map((operation): MoveEffectOperation => (
        operation.kind === 'item' && operation.payload.action === 'digest-buff'
          ? {
              ...operation,
              payload: { ...operation.payload, canonicalItemIds: [canonicalItemId], storageSlot },
            }
          : operation
      ))
    }
  }
  const gore = request(AA072_GORE_REASON)
  if (!gore || !selected(gore, input.responses, 'ability.gore.use')) return Object.freeze(operations)
  const damage = operations.find((operation): operation is MoveDamageEffectOperation => (
    operation.kind === 'damage' && input.moveOwnedOperationIds.has(operation.id)
  ))
  if (!damage || input.script.moveName !== 'Horn Attack' || input.script.damageBase === null) return Object.freeze(operations)
  const suffix = gore.id.slice('ability.gore.request.'.length)
  const multiId = `ability.gore.double-strike.${suffix}`
  const multi: MoveMultiHitEffectOperation = {
    id: multiId,
    kind: 'multi-hit',
    source: { kind: 'operation', id: gore.id },
    recipients: { kind: 'attacked-targets' },
    phase: 'damage',
    reasonCode: 'ability.gore.double-strike',
    payload: {
      count: { kind: 'fixed', hits: 2 },
      accuracy: {
        kind: 'per-hit', rollId: `ability.gore.accuracy.${suffix}`,
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 }, stopOnMiss: false,
      },
      critical: { kind: 'accuracy' },
      damage: {
        damageClass: 'physical', damageBase: input.script.damageBase,
        moveType: moveType ?? damage.payload.moveType,
        accuracyRollId: null, criticalRollId: null,
      },
      effects: [],
    },
  }
  const push: MoveEffectOperation = {
    id: `ability.gore.push.${suffix}`,
    kind: 'movement-request',
    source: { kind: 'operation', id: multiId },
    recipients: { kind: 'damaged-targets' },
    phase: 'movement',
    reasonCode: 'ability.gore.push-two-meters',
    payload: {
      requestId: `ability.gore.push.${suffix}`, mode: 'forced', distance: 2,
      destinationSetId: null,
      displacement: {
        vector: { kind: 'away', source: { kind: 'actor' } },
        distancePolicy: 'up-to-distance', opportunityAttacks: 'ignore',
      },
    },
  }
  operations = operations.filter(operation => (
    operation.id !== damage.id
    && !(operation.kind === 'roll' && operation.payload.formula.kind !== 'table'
      && operation.payload.rollId === damage.payload.accuracyRollId)
  ))
  return Object.freeze([...operations, multi, push])
}

export const aa072GiverForcedValue = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
}): 1 | 5 | null => {
  const request = input.operations.find((operation): operation is MoveReactionRequestEffectOperation => (
    operation.kind === 'reaction-request' && operation.reasonCode === AA072_GIVER_REASON
  ))
  if (!request) return null
  const optionId = responseOption(request, input.responses)
  return optionId === 'ability.giver.force-1' ? 1 : optionId === 'ability.giver.force-5' ? 5 : null
}

export const aa072GorillaTacticsSelected = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
}): boolean => {
  const request = input.operations.find((operation): operation is MoveReactionRequestEffectOperation => (
    operation.kind === 'reaction-request' && operation.reasonCode === AA072_GORILLA_TACTICS_REASON
  ))
  return Boolean(request && selected(request, input.responses, 'ability.gorilla-tactics.use'))
}

const storedDigestionBuffIds = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
): readonly string[] => {
  const placement = context.queries.placements.get(placementId)
  const resolved = placement ? context.queries.sheets.forPlacement(placement) : null
  if (!placement || !resolved) return []
  const legacy: unknown = placement.sheetKind === 'pokemon'
    ? (resolved.sheet as CharacterSheet).items?.digestionFood
    : (resolved.sheet as TrainerSheet).digestion
  const extras: unknown = placement.sheetKind === 'pokemon'
    ? (resolved.sheet as CharacterSheet).items?.digestionFoods
    : (resolved.sheet as TrainerSheet).digestionFoods
  const honeyPaws: unknown = placement.sheetKind === 'pokemon'
    ? (resolved.sheet as CharacterSheet).items?.honeyPawsFood
    : (resolved.sheet as TrainerSheet).honeyPawsFood
  if (extras !== undefined && (!Array.isArray(extras) || extras.length > 3)) {
    throw new Error('Gluttony digestion storage is malformed.')
  }
  const extraValues = (extras ?? []) as unknown[]
  if (extraValues.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('Gluttony digestion storage is malformed.')
  }
  const legacyNames: string[] = []
  if (typeof legacy === 'string' && legacy.trim()) legacyNames.push(legacy.trim())
  else if (legacy !== undefined && legacy !== null && legacy !== '') {
    throw new Error('Gluttony digestion storage is malformed.')
  }
  const honeyPawsNames: string[] = []
  if (typeof honeyPaws === 'string' && honeyPaws.trim()) honeyPawsNames.push(honeyPaws.trim())
  else if (honeyPaws !== undefined && honeyPaws !== null && honeyPaws !== '') {
    throw new Error('Gluttony Honey Paws digestion storage is malformed.')
  }
  const names = [
    ...legacyNames,
    ...extraValues.map(value => (value as string).trim()),
    ...honeyPawsNames,
  ]
  if (legacyNames.length + extraValues.length > 3 || names.length > 4) {
    throw new Error('Gluttony digestion storage exceeds its bounded capacity.')
  }
  const canonical = names.map((name) => {
    const id = resolveMoveAutomationItemRuleIdentity(name)?.canonicalItemId
    if (!id) throw new Error(`Gluttony digestion buff ${name} is not canonical.`)
    return id
  })
  return canonical
}

/** Durable AA-072 Move choices and reactions reconstructed for root, child, and resumed execution. */
export const aa072MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const identity = `${input.context.resolutionId}:${input.script.moveName}`
  const actorAbilities = input.context.queries.abilities.activeForPlacement(actorId)
  const damaging = input.script.damageClass !== 'Status' && (input.script.damageBase ?? 0) > 0
  const actorHasAction = (resource: 'free' | 'swift') => input.context.queries.resources.actionAvailable(actorId, resource)

  const gluttony = actorAbilities.find(ability => ability.canonicalId === 'Gluttony')
  if (['Bug Bite', 'Stuff Cheeks'].includes(input.script.moveName)) {
    const storedIds = storedDigestionBuffIds(input.context, actorId)
    if (storedIds.length > 1) {
      const suffix = shortHash(identity, actorId, gluttony?.instanceId ?? 'stored-digestion', ...storedIds)
      operations.push(requiredChoice({
        id: `ability.gluttony.request.${suffix}`, moveSourceId: input.moveSourceId,
        reasonCode: AA072_GLUTTONY_DIGEST_REASON, promptKey: 'ability.gluttony.choose-food-buff',
        options: storedIds.map((canonicalItemId, index) => ({
          id: `ability.gluttony.digest.${index + 1}.${canonicalItemId}`,
          labelKey: `item.${canonicalItemId}`,
        })),
      }))
    }
  }

  const gale = actorAbilities.find(ability => ability.canonicalId === 'Gale Wings')
  if (gale && input.script.moveName === 'Quick Attack') {
    const suffix = shortHash(identity, actorId, gale.instanceId)
    operations.push(optionalRequest({
      id: `ability.gale-wings.request.${suffix}`, moveSourceId: input.moveSourceId,
      reasonCode: AA072_GALE_WINGS_REASON, promptKey: 'ability.gale-wings.choose-type',
      options: [{ id: 'ability.gale-wings.flying', labelKey: 'ability.gale-wings.flying' }],
      ownerId: actorId, phase: 'declare', timing: 'declare', priority: 119,
    }))
  }

  const galvanize = actorAbilities.find(ability => ability.canonicalId === 'Galvanize')
  if (galvanize && damaging && input.script.type.trim().toLowerCase() === 'normal' && actorHasAction('free')) {
    const suffix = shortHash(identity, actorId, galvanize.instanceId)
    operations.push(optionalRequest({
      id: `ability.galvanize.request.${suffix}`, moveSourceId: input.moveSourceId,
      reasonCode: AA072_GALVANIZE_REASON, promptKey: 'ability.galvanize.use',
      options: [{ id: 'ability.galvanize.electric', labelKey: 'ability.galvanize.electric' }],
      ownerId: actorId, phase: 'declare', timing: 'declare', priority: 118,
    }))
  }

  const giver = actorAbilities.find(ability => ability.canonicalId === 'Giver')
  if (giver && input.script.moveName === 'Present' && actorHasAction('swift') && sceneUseAvailable({
    context: input.context, ownerId: actorId, abilityInstanceId: giver.instanceId,
    canonicalId: 'Giver', limit: 2,
  })) {
    const suffix = shortHash(identity, actorId, giver.instanceId)
    operations.push(optionalRequest({
      id: `ability.giver.request.${suffix}`, moveSourceId: input.moveSourceId,
      reasonCode: AA072_GIVER_REASON, promptKey: 'ability.giver.choose-roll',
      options: [
        { id: 'ability.giver.force-1', labelKey: 'ability.giver.force-1' },
        { id: 'ability.giver.force-5', labelKey: 'ability.giver.force-5' },
      ],
      ownerId: actorId, phase: 'damage', timing: 'pre-damage', priority: 117,
    }))
  }

  const gore = actorAbilities.find(ability => ability.canonicalId === 'Gore')
  if (gore && input.script.moveName === 'Horn Attack' && actorHasAction('swift') && sceneUseAvailable({
    context: input.context, ownerId: actorId, abilityInstanceId: gore.instanceId,
    canonicalId: 'Gore', limit: 2,
  })) {
    const suffix = shortHash(identity, actorId, gore.instanceId)
    operations.push(optionalRequest({
      id: `ability.gore.request.${suffix}`, moveSourceId: input.moveSourceId,
      reasonCode: AA072_GORE_REASON, promptKey: 'ability.gore.use',
      options: [{ id: 'ability.gore.use', labelKey: 'ability.gore.double-strike' }],
      ownerId: actorId, phase: 'declare', timing: 'declare', priority: 116,
    }))
  }

  const gorilla = actorAbilities.find(ability => ability.canonicalId === 'Gorilla Tactics')
  if (gorilla && actorHasAction('swift') && sceneUseAvailable({
    context: input.context, ownerId: actorId, abilityInstanceId: gorilla.instanceId,
    canonicalId: 'Gorilla Tactics', limit: 1,
  })) {
    const suffix = shortHash(identity, actorId, gorilla.instanceId)
    const requestId = `ability.gorilla-tactics.request.${suffix}`
    operations.push(optionalRequest({
      id: requestId, moveSourceId: input.moveSourceId,
      reasonCode: AA072_GORILLA_TACTICS_REASON, promptKey: 'ability.gorilla-tactics.use',
      options: [{ id: 'ability.gorilla-tactics.use', labelKey: 'ability.gorilla-tactics.use' }],
      ownerId: actorId, phase: 'declare', timing: 'declare', priority: 115,
    }))
    const priorUsedMoves = [...new Set(
      (input.context.map.encounterState?.history.moveUses ?? [])
        .filter(use => use.actorPlacementId === actorId && use.declaration !== null)
        .map(use => use.canonicalId)
        .filter(canonicalId => canonicalId !== input.script.moveName),
    )].sort(codePointOrder).slice(0, 63)
    const usedMoves = [...priorUsedMoves, input.script.moveName]
      .sort(codePointOrder)
    operations.push(
      temporaryCapability({
        requestId, id: `ability.gorilla-tactics.lock.${suffix}`,
        capabilityId: AA072_GORILLA_LOCK_CAPABILITY,
        tags: ['ability', 'aa072', 'gorilla-tactics', 'move-lock'],
      }),
      temporaryDamageBonus({ requestId, id: `ability.gorilla-tactics.damage.${suffix}` }),
      temporaryMoveRestriction({
        requestId,
        id: `ability.gorilla-tactics.moves.${suffix}`,
        canonicalMoveIds: usedMoves,
      }),
    )
  }

  const melee = input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'melee')
    || /\bmelee\b/i.test(input.script.range)
  if (melee) for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
    const gooey = input.context.queries.abilities.activeForPlacement(targetId)
      .find(ability => ability.canonicalId === 'Gooey')
    if (!gooey || !input.context.queries.resources.actionAvailable(targetId, 'free')) continue
    const suffix = shortHash(identity, actorId, targetId, gooey.instanceId)
    const requestId = `ability.gooey.request.${suffix}`
    operations.push(optionalRequest({
      id: requestId, moveSourceId: input.moveSourceId,
      sourceEventId: `ability.gooey.target:${targetId}`,
      reasonCode: AA072_GOOEY_REASON, promptKey: 'ability.gooey.use',
      options: [{ id: 'ability.gooey.use', labelKey: 'ability.gooey.lower-speed' }],
      ownerId: targetId, phase: 'after-damage', timing: 'post-damage', priority: 108,
    }), gooeyStage(requestId, suffix))
  }

  return Object.freeze(operations)
}
