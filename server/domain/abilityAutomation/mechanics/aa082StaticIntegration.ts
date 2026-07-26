import { createHash } from 'node:crypto'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA082_ODIOUS_SPRAY_TARGETING_OVERRIDE = Object.freeze({
  kind: 'single-target' as const,
  minTargets: 1,
  maxTargets: 1,
  selector: { kind: 'selected-targets' as const },
})

const hash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

export const aa082OdiousSprayActive = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
}): boolean => input.script.moveName === 'Poison Gas'
  && input.context.intent.selection.kind === 'single-target'
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Odious Spray')

/** The optional Odious Spray branch is exact single-target Range 8 at AC 2. */
export const aa082OdiousSprayScript = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
}): MoveAutomationScript => aa082OdiousSprayActive(input) ? Object.freeze({
  ...input.script,
  ac: 2,
  range: '8, 1 Target',
  targetMode: 'one-target',
  targetCount: 1,
  areaTemplates: [],
}) : input.script

const lastChance = (type: string): 'Overcharge' | 'Overgrow' | null => {
  if (type === 'electric') return 'Overcharge'
  if (type === 'grass') return 'Overgrow'
  return null
}

/** Exact AA-082 Last Chance and Parental Bond damage boundaries. */
export const aa082MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = []
  const lastChanceId = lastChance(input.moveType.trim().toLowerCase())
  if (lastChanceId) {
    const maximum = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
    const ability = input.context.queries.abilities.activeForPlacement(input.actor.id)
      .find(candidate => candidate.canonicalId === lastChanceId)
    if (ability && Math.max(0, input.actor.currentHp) * 3 <= maximum) modifiers.push({
      id: `ability.aa082.last-chance.${hash(input.operation.id, input.recipient.id, ability.instanceId)}`,
      stage: 'pre-type-modifiers', priority: 39,
      source: { kind: 'ability', id: ability.instanceId },
      stackingGroup: `aa082-last-chance:${ability.instanceId}`,
      reasonCode: lastChanceId === 'Overcharge'
        ? 'ability.overcharge.last-chance' : 'ability.overgrow.last-chance',
      operation: 'add', value: 5,
    })
  }

  const parentalBond = input.context.queries.abilities.activeForPlacement(input.recipient.id)
    .find(candidate => candidate.canonicalId === 'Parental Bond')
  if (parentalBond) modifiers.push({
    id: `ability.aa082.parental-bond.dr.${hash(input.operation.id, input.recipient.id, parentalBond.instanceId)}`,
    stage: 'post-damage-modifiers', priority: 41,
    source: { kind: 'ability', id: parentalBond.instanceId },
    stackingGroup: `aa082-parental-bond:${parentalBond.instanceId}`,
    reasonCode: 'ability.parental-bond.baby-damage-reduction',
    operation: 'subtract', value: 10,
  })
  return Object.freeze(modifiers)
}
