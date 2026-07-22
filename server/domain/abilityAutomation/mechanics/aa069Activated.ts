import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import {
  createEmptyAbilityDailyUsageLedger,
  parseAbilityDailyUsageLedger,
} from '#shared/abilityAutomation/resources'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import {
  AA069_EMPOWER_MOVE_MARK_PREFIX,
  AA069_FADE_AWAY_SHIFT_MARK,
} from '#shared/abilityAutomation/aa069'
import { fabulousTrimGrantedAbility } from '#shared/abilityAutomation/fabulousTrim'
import { reviewedAbilityConnectionMoveNames } from '#shared/abilityAutomation/connections'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet, InventoryEntry } from '~/types/trainerSheet'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { deepCloneJson } from '~/utils/serialization'
import { findMove } from '~~/data/ptuReference'
import { MOVE_AUTOMATION_RUNTIME_REGISTRY } from '../../moveAutomation/registry'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const SCENE_X2_FREQUENCY = Object.freeze({
  raw: 'Scene x2', actionText: '', kind: 'scene', uses: 2, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const DAILY_FREQUENCY = Object.freeze({
  raw: 'Daily', actionText: '', kind: 'daily', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa069ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa069ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa069ActivatedExecutionError(detail) }
const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)

const selectedValues = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): readonly AbilityDeclarationOptionValue[] => choices.find(choice => choice.declarationId === declarationId)
  ?.options.map(option => option.value) ?? []

const encounterChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly current: unknown
}): MoveStateChangeInput => ({
  kind: 'encounter-state',
  scope: { kind: 'encounter', mapSlug: input.context.map.slug },
  expectedRevision: normalizeRevision(input.context.map.revision),
  sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState()),
  current: parseEncounterState(input.current),
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const sheetChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly previous: AnyLiveSheet
  readonly current: AnyLiveSheet
  readonly changedFields: readonly ('abilities' | 'abilityUsage' | 'items')[]
}): MoveStateChangeInput => {
  const current = deepCloneJson(input.current)
  current.revision = nextRevision(input.context.actor.sheet.revision)
  return {
    kind: 'sheet-state',
    scope: {
      kind: 'sheet', sheetKind: input.context.actor.sheet.kind,
      sheetSlug: input.context.actor.sheet.slug,
    },
    expectedRevision: input.context.actor.sheet.revision,
    sourceOperationId: input.operationId,
    reasonCode: input.reasonCode,
    previous: deepCloneJson(input.previous),
    current,
    changedFields: [...input.changedFields],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}

const payScene = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly resource: 'standard' | 'swift'
  readonly frequency?: AbilityFrequencyDeclaration
}) => {
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: `ability:${input.canonicalId}`,
    moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    range: `${input.resource} action`,
    resolutionId: input.context.resolutionId,
    sourceOperationId: `${input.operationId}:action`,
    movement: null,
    reviewedCosts: [{
      id: `ability.action.${input.resource}`, phase: 'pay',
      cost: { kind: 'action-resource', resource: input.resource, amount: 1 },
    }],
    allowLegacyFallback: false,
    minimumPhaseExclusive: null,
    maximumPhaseInclusive: 'pay',
  })
  const frequencyContext: AuthoritativeAbilityContext = {
    ...input.context,
    map: { ...input.context.map, encounterState: action.currentEncounterState },
  }
  const frequency = planAbilityFrequencyPayment({
    context: frequencyContext,
    frequency: input.frequency ?? SCENE_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: frequencyContext.map.encounterState?.history.sceneId ?? undefined,
  })
  const change = frequency.plan.changes.find(candidate => candidate.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state'
    ? change.current
    : action.currentEncounterState)
}

const createTurnMark = (input: {
  readonly encounter: ReturnType<typeof parseEncounterState>
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly markId: string
}) => {
  const stateId = `${input.abilityInstanceId}:${shortHash(`${input.operationId}:${input.markId}`)}`
  const reduced = reduceAbilityOwnedStateCommand(input.encounter.abilityOwnedState, {
    operationId: `${input.operationId}:mark`, kind: 'create', stateId, expectedVersion: null,
    entry: {
      stateId,
      ownerPlacementId: input.context.actor.placement.id,
      sourceAbilityInstanceId: input.abilityInstanceId,
      canonicalId: input.canonicalId,
      targetPlacementIds: [],
      lifecycle: { kind: 'turn', targetPolicy: null },
      payload: { kind: 'mark', markId: input.markId },
    },
  })
  return parseEncounterState({ ...input.encounter, abilityOwnedState: reduced.state })
}

const electrodashExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa069ActivatedExecution => {
  const paid = payScene({
    ...input, canonicalId: 'Electrodash', resource: 'swift', frequency: SCENE_X2_FREQUENCY,
  })
  const sprintEffect = parseEncounterEffect({
    id: `ability.electrodash.sprint.${shortHash(input.operationId)}`,
    kind: 'numeric-modifier',
    source: {
      operationId: input.operationId, moveId: 'ability.electrodash',
      placementId: input.context.actor.placement.id,
    },
    affected: {
      placementIds: [input.context.actor.placement.id], sideIds: [],
      cells: [{ ...input.context.actor.placement.position }],
    },
    createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
    createdTurn: input.context.map.encounterState?.history.currentTurn?.turn ?? 0,
    duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
    stacks: 1, charges: null,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['ability', 'aa069', 'electrodash', 'sprint'],
    payload: { attribute: 'movement', operation: 'multiply', value: 1.5, rounding: 'floor' },
    dispel: { policy: 'matching-tags', tags: ['electrodash', 'sprint'] },
    transferPolicy: 'expire', suppression: { sources: [] },
  }, 'ability.electrodash.sprint')
  const current = parseEncounterState({ ...paid, effects: [...paid.effects, sprintEffect] })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      context: input.context, operationId: input.operationId,
      reasonCode: 'ability.aa069.electrodash.sprint', current,
    })]),
    presentationKey: 'ability.aa069.electrodash.sprint',
  })
}

const empowerExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa069ActivatedExecution => {
  const choice = selectedValues(input.choices, 'activate.move')[0]
  const canonicalMoveId = choice?.kind === 'move'
    ? choice.canonicalMoveId
    : fail('Empower requires one issued Move choice.')
  const availableMoves = (input.context.actor.sheet.sheet.movelist ?? [])
    .flatMap(entry => typeof entry.name === 'string' && entry.name.trim() ? [entry.name.trim()] : [])
  availableMoves.push(...reviewedAbilityConnectionMoveNames(
    input.context.actor.effectiveAbilities.filter(ability => ability.effective)
      .map(ability => ability.canonicalId),
    availableMoves,
  ))
  const runtime = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalMoveId)
  const move = findMove(canonicalMoveId)
  if (!availableMoves.includes(canonicalMoveId)
    || !runtime || runtime.kind !== 'movespec-v2'
    || runtime.definition.spec.targeting.kind !== 'self'
    || move?.damage_class !== 'Status') {
    fail('Empower requires a reviewed self-targeting Status-Class Move.')
  }
  const paid = payScene({ ...input, canonicalId: 'Empower', resource: 'swift' })
  const markId = `${AA069_EMPOWER_MOVE_MARK_PREFIX}${shortHash(canonicalMoveId)}`
  const current = createTurnMark({
    ...input, encounter: paid, canonicalId: 'Empower', markId,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      context: input.context, operationId: input.operationId,
      reasonCode: 'ability.aa069.empower.move-ready', current,
    })]),
    presentationKey: 'ability.aa069.empower.move-ready',
  })
}

const invisibleEffect = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}) => parseEncounterEffect({
  id: `ability.fade-away.invisible.${shortHash(input.operationId)}`,
  kind: 'capability',
  source: {
    operationId: input.operationId, moveId: 'ability.fade-away',
    placementId: input.context.actor.placement.id,
  },
  affected: {
    placementIds: [input.context.actor.placement.id], sideIds: [],
    cells: [{ ...input.context.actor.placement.position }],
  },
  createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
  createdTurn: input.context.map.encounterState?.history.currentTurn?.turn ?? 0,
  duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 1 },
  stacks: 1, charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa069', 'fade-away', 'capability.invisibility'],
  payload: { capabilityId: 'aa069.fade-away.invisibility', action: 'grant' },
  dispel: { policy: 'matching-tags', tags: ['fade-away'] },
  transferPolicy: 'expire', suppression: { sources: [] },
}, 'ability.fadeAway.invisibility')

const fadeAwayExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa069ActivatedExecution => {
  const paid = payScene({ ...input, canonicalId: 'Fade Away', resource: 'standard' })
  const withEffect = parseEncounterState({ ...paid, effects: [...paid.effects, invisibleEffect(input)] })
  const current = createTurnMark({
    ...input, encounter: withEffect, canonicalId: 'Fade Away', markId: AA069_FADE_AWAY_SHIFT_MARK,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      context: input.context, operationId: input.operationId,
      reasonCode: 'ability.aa069.fade-away.activated', current,
    })]),
    presentationKey: 'ability.aa069.fade-away.activated',
  })
}

const fabulousTrimExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa069ActivatedExecution => {
  const branch = selectedValues(input.choices, 'style.trim')[0]
  const trimId = branch?.kind === 'branch' ? branch.branchId : fail('Fabulous Trim requires one issued trim.')
  if (!fabulousTrimGrantedAbility(trimId)) fail('Fabulous Trim received an unsupported trim.')
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const current = deepCloneJson(previous) as AnyLiveSheet
  const abilities = current.abilities ?? []
  const index = abilities.findIndex(candidate => candidate.name === 'Fabulous Trim'
    && (candidate.automation?.instanceId ?? input.abilityInstanceId) === input.abilityInstanceId)
  if (index < 0) fail('Fabulous Trim ability instance disappeared from the sheet.')
  abilities[index] = {
    ...abilities[index]!,
    automation: {
      schemaVersion: 1,
      instanceId: input.abilityInstanceId,
      canonicalId: 'Fabulous Trim',
      definitionVersion: 1,
      selections: [{ parameterId: 'trim', optionIds: [trimId] }],
    },
  }
  current.abilities = abilities
  return Object.freeze({
    plan: createMoveStateChangePlan([sheetChange({
      context: input.context, operationId: input.operationId,
      reasonCode: 'ability.aa069.fabulous-trim.changed', previous, current,
      changedFields: ['abilities'],
    })]),
    presentationKey: `ability.aa069.fabulous-trim.${trimId}`,
  })
}

const CRAFTED_ITEMS = Object.freeze({
  'lucky-leaf': { name: 'Lucky Leaf', description: 'Consumable Grass Type Booster for one encounter.' },
  'tasty-reeds': { name: 'Tasty Reeds', description: 'Consumable Bug Type Booster for one encounter.' },
  'dew-cup': { name: 'Dew Cup', description: 'Consumable Held Item with the effect of an Occa Berry.' },
  'thorn-mantle': { name: 'Thorn Mantle', description: 'Consumable Held Item with the effect of a Coba Berry.' },
  'chewy-cluster': { name: 'Chewy Cluster', description: 'Consumable Held Item with the effect of Leftovers.' },
  'decorative-twine': { name: 'Decorative Twine', description: 'Consumable Held Item granting +2d6 to one Contest Move.' },
} as const)

const addTrainerCraftedItem = (sheet: TrainerSheet, itemId: string): void => {
  const definition = CRAFTED_ITEMS[itemId as keyof typeof CRAFTED_ITEMS] ?? fail('Unknown Fashion Designer item.')
  const rows = [...(sheet.inventory?.foodStuff ?? [])]
  const id = `fashion-designer.${itemId}`
  const existing = rows.find(row => row.id === id)
  if (existing) existing.qty = Math.max(0, Math.floor(existing.qty ?? 0)) + 1
  else rows.push({ id, name: definition.name, qty: 1, description: definition.description } satisfies InventoryEntry)
  sheet.inventory = { ...(sheet.inventory ?? {}), foodStuff: rows }
}

const addPokemonCraftedItem = (sheet: CharacterSheet, itemId: string): void => {
  const definition = CRAFTED_ITEMS[itemId as keyof typeof CRAFTED_ITEMS] ?? fail('Unknown Fashion Designer item.')
  sheet.items = {
    ...(sheet.items ?? {}),
    extraItems: [...(sheet.items?.extraItems ?? []), definition.name],
  }
}

const fashionDesignerExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa069ActivatedExecution => {
  const branch = selectedValues(input.choices, 'activate.item')[0]
  const itemId = branch?.kind === 'branch' ? branch.branchId : fail('Fashion Designer requires one issued item.')
  if (!Object.prototype.hasOwnProperty.call(CRAFTED_ITEMS, itemId)) fail('Fashion Designer item is unsupported.')
  const dailyLedger = parseAbilityDailyUsageLedger(
    input.context.actor.sheet.sheet.abilityUsage ?? createEmptyAbilityDailyUsageLedger(),
  )
  const frequency = planAbilityFrequencyPayment({
    context: input.context,
    frequency: DAILY_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    dayKey: dailyLedger.dayKey ?? 'campaign-day:initial',
  })
  const payment = frequency.plan.changes.find(change => change.kind === 'sheet-state'
    && change.scope.sheetKind === input.context.actor.sheet.kind
    && change.scope.sheetSlug === input.context.actor.sheet.slug)
    ?? fail('Fashion Designer did not produce its Daily sheet payment.')
  if (payment.kind !== 'sheet-state') return fail('Fashion Designer payment shape is invalid.')
  const previous = deepCloneJson(payment.previous) as AnyLiveSheet
  const current = deepCloneJson(payment.current) as AnyLiveSheet
  if (input.context.actor.sheet.kind === 'trainer') addTrainerCraftedItem(current as TrainerSheet, itemId)
  else addPokemonCraftedItem(current as CharacterSheet, itemId)
  current.revision = nextRevision(input.context.actor.sheet.revision)
  const combined: MoveStateChangeInput = {
    ...payment,
    current,
    reasonCode: 'ability.aa069.fashion-designer.crafted',
    changedFields: [
      'abilityUsage',
      input.context.actor.sheet.kind === 'trainer' ? 'inventory' : 'items',
    ],
  }
  return Object.freeze({
    plan: createMoveStateChangePlan([combined]),
    presentationKey: `ability.aa069.fashion-designer.${itemId}`,
  })
}

export interface Aa069ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa069ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa069ActivatedExecution | null => {
  if (input.operation.mechanicId === 'aa069.electrodash') return electrodashExecution(input)
  if (input.operation.mechanicId === 'aa069.empower') return empowerExecution(input)
  if (input.operation.mechanicId === 'aa069.fabulous-trim') return fabulousTrimExecution(input)
  if (input.operation.mechanicId === 'aa069.fade-away'
    && input.operation.config.branch === 'activate') return fadeAwayExecution(input)
  if (input.operation.mechanicId === 'aa069.fashion-designer') return fashionDesignerExecution(input)
  return null
}
