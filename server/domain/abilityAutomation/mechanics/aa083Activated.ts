import { createHash } from 'node:crypto'
import itemsJson from '../../../../data/reference/items.json'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseMapGroundItem } from '#shared/moveAutomation/groundItems'
import type { CharacterSheet } from '~/types/characterSheet'
import { applyHpToSheet, type AnyLiveSheet } from '~/utils/sheetMutations'
import { deepCloneJson } from '~/utils/serialization'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveSheetStateField,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'

const DAILY_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Daily', actionText: '', kind: 'daily', uses: 1, exceptionId: null,
})

export interface Aa083ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}
export class Aa083ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa083ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa083ActivatedExecutionError(detail) }
const digest = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const paidDailySheet = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): AnyLiveSheet => {
  const payment = planAbilityFrequencyPayment({
    context: input.context,
    frequency: DAILY_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    dayKey: input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial',
  }).plan.changes.find(change => change.kind === 'sheet-state')
    ?? fail('Daily ability payment did not produce a sheet change.')
  return deepCloneJson(payment.current) as AnyLiveSheet
}

const actorSheetChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly current: AnyLiveSheet
  readonly changedFields: readonly MoveSheetStateField[]
}): MoveStateChangeInput => ({
  kind: 'sheet-state',
  scope: {
    kind: 'sheet', sheetKind: input.context.actor.sheet.kind,
    sheetSlug: input.context.actor.sheet.slug,
  },
  expectedRevision: input.context.actor.sheet.revision,
  sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: deepCloneJson(input.context.actor.sheet.sheet),
  current: input.current,
  changedFields: input.changedFields,
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const photosynthesis = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa083ActivatedExecution => {
  if (input.context.actor.sheet.kind !== 'pokemon') fail('Photosynthesis requires a Pokémon actor.')
  const token = input.context.actor.token
  const maximum = Math.max(1, token.fullMaxHp ?? token.maxHp)
  const healing = Math.floor(maximum * 0.25)
  const nextHp = Math.min(maximum, token.currentHp + healing)
  const nextInjuries = Math.max(0, (token.injuries ?? 0) - 1)
  const paid = paidDailySheet(input)
  const current = applyHpToSheet(
    input.context.actor.sheet.kind,
    paid,
    nextHp,
    nextInjuries,
  )
  current.revision = nextRevision(input.context.actor.sheet.revision)
  return Object.freeze({
    plan: createMoveStateChangePlan([actorSheetChange({
      ...input,
      reasonCode: 'ability.aa083.photosynthesis.heal',
      current,
      changedFields: ['abilityUsage', 'hp'],
    })]),
    presentationKey: 'ability.aa083.photosynthesis.applied',
  })
}

type PickupCategory = 'none' | 'x-item' | 'berry' | 'poke-ball' | 'healing'
  | 'evolution-stone' | 'vitamin' | 'held-item' | 'tm'

const pickupCategory = (roll: number): PickupCategory => roll <= 5 ? 'none'
  : roll <= 7 ? 'x-item'
    : roll <= 10 ? 'berry'
      : roll <= 13 ? 'poke-ball'
        : roll <= 16 ? 'healing'
          : roll === 17 ? 'evolution-stone'
            : roll === 18 ? 'vitamin'
              : roll === 19 ? 'held-item'
                : 'tm'

const BERRIES = Object.freeze([
  'Cheri Berry', 'Chesto Berry', 'Pecha Berry', 'Rawst Berry', 'Aspear Berry',
  'Oran Berry', 'Persim Berry', 'Lum Berry', 'Sitrus Berry', 'Figy Berry',
])

interface ItemRow { readonly name: string; readonly categories?: readonly string[] }
const itemRows = Object.values(itemsJson) as readonly ItemRow[]
const categoryItems = (category: Exclude<PickupCategory, 'none'>): readonly string[] => {
  const categoryName = category === 'x-item' ? 'X-Item'
    : category === 'poke-ball' ? 'Poké Ball'
      : category === 'healing' ? 'Medicine'
        : category === 'evolution-stone' ? 'Evolutionary Stone'
          : category === 'vitamin' ? 'Vitamin'
            : category === 'held-item' ? 'Held Item'
              : category === 'tm' ? 'TM'
                : null
  return Object.freeze((category === 'berry' ? [...BERRIES] : itemRows
    .filter(item => categoryName && item.categories?.includes(categoryName))
    .map(item => item.name)).sort((left, right) => left.localeCompare(right)))
}
const canonicalItemId = (name: string): string => name.normalize('NFKD').toLowerCase()
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const pickup = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa083ActivatedExecution => {
  const roll = input.context.random.roll({
    rollId: `ability.pickup.d20.${digest(input.operationId)}`,
    parentEffectId: input.operationId,
    reason: 'ability.pickup.category',
    formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  })
  const category = pickupCategory(roll.naturalResult)
  const paid = paidDailySheet(input)
  const changes: MoveStateChangeInput[] = [actorSheetChange({
    ...input,
    reasonCode: 'ability.aa083.pickup.frequency',
    current: { ...paid, revision: nextRevision(input.context.actor.sheet.revision) },
    changedFields: ['abilityUsage'],
  })]
  if (category !== 'none') {
    const candidates = categoryItems(category)
    if (candidates.length === 0) fail(`Pickup category ${category} has no canonical item candidates.`)
    const selected = input.context.random.roll({
      rollId: `ability.pickup.item.${digest(input.operationId, category)}`,
      parentEffectId: input.operationId,
      reason: `ability.pickup.item.${category}`,
      formula: { kind: 'dice', count: 1, sides: candidates.length, modifier: 0 },
    })
    const itemName = candidates[selected.naturalResult - 1]!
    const encounter = parseEncounterState(input.context.map.encounterState)
    const sourceOperationId = `op_pickup_${digest(input.operationId, itemName)}`
    const groundItem = parseMapGroundItem({
      id: `ground.pickup.${digest(input.context.map.slug, input.operationId, itemName)}`,
      canonicalItemId: canonicalItemId(itemName), canonicalItemName: itemName, quantity: 1,
      position: { ...input.context.actor.placement.position },
      sourceResource: {
        kind: 'map', slug: input.context.map.slug, revision: normalizeRevision(input.context.map.revision),
      },
      sourceOperationId,
      sideId: input.context.actor.placement.sideId ?? null,
      ownerPlacementId: input.context.actor.placement.id,
    }, 'ability.pickup.groundItem')
    changes.push({
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId,
      reasonCode: `ability.aa083.pickup.${category}`,
      previous: encounter,
      current: parseEncounterState({ ...encounter, groundItems: [...encounter.groundItems, groundItem] }),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: category === 'none'
      ? 'ability.aa083.pickup.nothing-found'
      : `ability.aa083.pickup.${category}`,
  })
}

export const executeAa083ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa083ActivatedExecution | null => {
  if (input.context.actor.token.currentHp <= 0) fail('The ability cannot be used while Fainted.')
  if (input.operation.mechanicId === 'aa083.photosynthesis') return photosynthesis(input)
  if (input.operation.mechanicId === 'aa083.pickup') return pickup(input)
  return null
}
