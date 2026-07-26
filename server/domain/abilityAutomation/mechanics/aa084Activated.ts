import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { createEmptyAbilityTransformationState } from '#shared/abilityAutomation/transformations'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import { abilityIsCopyable } from '../effectiveAbilities'
import { reduceAbilityTransformationCommand } from '../transformations'
import type { CombatStageMap } from '~/types/combatStages'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { computeFullMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { deepCloneJson } from '~/utils/serialization'
import { referenceManeuverOptions } from '~/utils/mapTokenManeuvers'
import { appendManeuverLogEntry, buildManeuverUseLogLines } from '~/utils/maneuverLog'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
})
const DAILY_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Daily', actionText: '', kind: 'daily', uses: 1, exceptionId: null,
})

export interface Aa084ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
  readonly controllerPresentationValues?: readonly string[]
}
export class Aa084ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa084ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa084ActivatedExecutionError(detail) }
const fullHash = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value), 'utf8').digest('hex')
const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const selectedValue = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): AbilityDeclarationOptionValue | null => choices.find(choice => choice.declarationId === declarationId)
  ?.options[0]?.value ?? null

const actionEncounter = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'free' | 'swift'
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
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
}).currentEncounterState

const contextWithEncounter = (
  context: AuthoritativeAbilityContext,
  encounterState: ReturnType<typeof parseEncounterState>,
): AuthoritativeAbilityContext => ({
  ...context,
  map: { ...context.map, encounterState },
})

const paidSceneEncounter = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly resource: 'free' | 'swift'
}) => {
  const action = actionEncounter(input)
  const context = contextWithEncounter(input.context, action)
  const payment = planAbilityFrequencyPayment({
    context,
    frequency: SCENE_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: action.history.sceneId ?? undefined,
  })
  const change = payment.plan.changes.find(candidate => candidate.kind === 'encounter-state')
    ?? fail(`${input.canonicalId} did not produce its Scene payment.`)
  return parseEncounterState(change.current)
}

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
  readonly current: AnyLiveSheet
  readonly changedFields: readonly ('abilityUsage' | 'conditions' | 'combatStages')[]
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

const powerConstruct = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa084ActivatedExecution => {
  if (input.context.actor.sheet.kind !== 'pokemon') fail('Power Construct requires a Pokémon actor.')
  const sheet = input.context.actor.sheet.sheet as CharacterSheet
  if (!sheet.species.toLowerCase().includes('zygarde')) fail('Power Construct requires Zygarde.')
  const maximum = Math.max(1, input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp)
  if (Math.max(0, input.context.actor.token.currentHp) * 2 >= maximum) {
    fail('Power Construct requires the user to be below 50% Hit Points.')
  }
  const activeScene = input.context.map.activeScene
    ?? fail('Power Construct requires an active authoritative Scene.')
  const action = actionEncounter({ ...input, canonicalId: 'Power Construct', resource: 'swift' })
  const payment = planAbilityFrequencyPayment({
    context: input.context,
    frequency: DAILY_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    dayKey: sheet.abilityUsage?.dayKey ?? 'campaign-day:initial',
  }).plan.changes.find(change => change.kind === 'sheet-state')
    ?? fail('Power Construct did not produce its Daily payment.')
  const completeSheet: CharacterSheet = { ...deepCloneJson(sheet), species: 'Zygarde Complete Forme' }
  const completeHpTotal = resolveStats(completeSheet).find(stat => stat.key === 'hp')?.total
    ?? fail('Power Construct could not resolve Complete Forme HP.')
  const completeMaximum = computeFullMaxHp(completeSheet, completeHpTotal)
  const amount = Math.floor(completeMaximum / 2)
  const effect = parseEncounterEffect({
    id: `ability.power-construct.form.${shortHash(input.context.actor.placement.id, input.operationId)}`,
    kind: 'creature-rule-overlay',
    source: {
      operationId: input.operationId, moveId: 'ability.power-construct',
      placementId: input.context.actor.placement.id,
    },
    affected: { placementIds: [input.context.actor.placement.id], sideIds: [], cells: [] },
    createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
    createdTurn: Math.max(0, action.history.currentTurn?.turn ?? 0),
    duration: { kind: 'scene', remaining: null },
    stacks: 1, charges: null,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['ability', 'aa084', 'power-construct', 'complete-forme', 'blocks-temporary-hp'],
    payload: {
      domain: 'form', action: 'replace', value: 'zygarde-complete-forme',
      referencePlacementId: null,
    },
    dispel: { policy: 'matching-tags', tags: ['power-construct', 'complete-forme'] },
    transferPolicy: 'expire', suppression: { sources: [] },
  }, 'ability.powerConstruct.form')
  const encounter = parseEncounterState({
    ...action,
    effects: [
      ...action.effects.filter(candidate => !(
        candidate.tags.includes('power-construct')
        && candidate.affected.placementIds.includes(input.context.actor.placement.id)
      )),
      effect,
    ],
  })
  const previousTemporaryHp = input.context.map.temporaryHitPoints
  const sceneState = previousTemporaryHp
    && previousTemporaryHp.scene.name === activeScene.name
    && previousTemporaryHp.scene.startedAt === activeScene.startedAt
    ? previousTemporaryHp
    : { scene: { ...activeScene }, byPlacementId: {} }
  const currentSheet = deepCloneJson(payment.current) as AnyLiveSheet
  currentSheet.revision = nextRevision(input.context.actor.sheet.revision)
  return Object.freeze({
    plan: createMoveStateChangePlan([
      sheetChange({
        ...input, reasonCode: 'ability.aa084.power-construct.frequency',
        current: currentSheet, changedFields: ['abilityUsage'],
      }),
      encounterChange({
        ...input, reasonCode: 'ability.aa084.power-construct.complete-forme', current: encounter,
      }),
      {
        kind: 'map-temporary-hit-points',
        scope: { kind: 'map', mapSlug: input.context.map.slug },
        expectedRevision: normalizeRevision(input.context.map.revision),
        sourceOperationId: `${input.operationId}:temporary-hp`,
        reasonCode: 'ability.aa084.power-construct.temporary-hp',
        previous: deepCloneJson(previousTemporaryHp),
        current: {
          scene: { ...sceneState.scene },
          byPlacementId: {
            ...sceneState.byPlacementId,
            [input.context.actor.placement.id]: Math.max(
              sceneState.byPlacementId[input.context.actor.placement.id] ?? 0,
              amount,
            ),
          },
        },
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    ]),
    presentationKey: 'ability.aa084.power-construct.complete-forme',
    controllerPresentationValues: [String(amount)],
  })
}

const powerOfAlchemy = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa084ActivatedExecution => {
  const targetValue = selectedValue(input.choices, 'activate.target')
  const abilityValue = selectedValue(input.choices, 'activate.ability')
  const targetId = targetValue?.kind === 'token'
    ? targetValue.placementId
    : fail('Power of Alchemy requires one issued target.')
  const selectedAbilityId = abilityValue?.kind === 'ability'
    ? abilityValue.abilityInstanceId
    : fail('Power of Alchemy requires one issued Ability.')
  const target = input.context.queries.tokens.get(targetId)
    ?? fail('Power of Alchemy target disappeared.')
  if (ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 10) {
    fail('Power of Alchemy target is outside Range 10.')
  }
  const selectedAbility = input.context.queries.effectiveAbilities.allForPlacement(targetId)
    .find(ability => ability.effective && ability.instanceId === selectedAbilityId)
    ?? fail('Power of Alchemy selected Ability is no longer effective on its target.')
  if (!abilityIsCopyable(selectedAbility.canonicalId)) {
    fail(`${selectedAbility.canonicalId} cannot be copied.`)
  }
  const targetPlacement = input.context.queries.placements.get(targetId)
    ?? fail('Power of Alchemy target placement disappeared.')
  const targetSheet = input.context.queries.sheets.forPlacement(targetPlacement)
    ?? fail('Power of Alchemy target sheet disappeared.')
  const encounter = paidSceneEncounter({
    ...input, canonicalId: 'Power of Alchemy', resource: 'free',
  })
  const snapshotId = `ability.power-of-alchemy.copy.${shortHash(input.context.actor.placement.id, input.operationId)}`
  const copiedInstanceId = `copied:${snapshotId}:0`
  const copiedMechanics = {
    formId: null,
    abilityPolicy: 'add' as const,
    abilities: [{
      instanceId: copiedInstanceId,
      canonicalId: selectedAbility.canonicalId,
      definitionHash: selectedAbility.definitionHash,
      sourcePlacementId: targetId,
      parameterStatus: selectedAbility.parameterStatus,
      parameterData: selectedAbility.parameterStatus === 'ready' && selectedAbility.parameterData
        ? { ...selectedAbility.parameterData, instanceId: copiedInstanceId }
        : null,
    }],
    moves: [], typeIds: [], footprint: null, weightClass: null, capabilityTags: [],
  }
  const copyBase = {
    sourcePlacementId: targetId,
    sourceRevision: targetSheet.revision,
    sourceReadSha256: fullHash({
      placementId: targetId,
      revision: targetSheet.revision,
      ability: copiedMechanics.abilities[0],
    }),
  }
  const transformation = reduceAbilityTransformationCommand(
    encounter.abilityTransformations ?? createEmptyAbilityTransformationState(),
    {
      operationId: `${input.operationId}:copy`,
      kind: 'create', snapshotId, expectedVersion: null,
      snapshot: {
        snapshotId, kind: 'copy',
        placementId: input.context.actor.placement.id,
        ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: input.abilityInstanceId,
        canonicalId: 'Power of Alchemy',
        sourceOperationId: input.operationId,
        duration: { kind: 'scene' },
        mechanics: copiedMechanics,
        copyBase,
        presentation: {
          public: {
            presentationId: snapshotId,
            labelKey: 'ability.power-of-alchemy.copied',
            formId: null, assetId: null,
          },
          private: null,
        },
      },
    },
  )
  const current = parseEncounterState({
    ...encounter,
    abilityTransformations: transformation.state,
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input, reasonCode: 'ability.aa084.power-of-alchemy.copied', current,
    })]),
    presentationKey: 'ability.aa084.power-of-alchemy.copied',
    controllerPresentationValues: [selectedAbility.canonicalId],
  })
}

const pressure = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa084ActivatedExecution => {
  const encounter = paidSceneEncounter({ ...input, canonicalId: 'Pressure', resource: 'swift' })
  const actorId = input.context.actor.placement.id
  const targets = input.context.tokens
    .filter(token => token.id !== actorId
      && input.context.queries.relationships.relation(actorId, token.id) === 'enemy'
      && ptuGridDistanceBetweenFootprints(input.context.actor.token, token) <= 3)
    .sort((left, right) => left.id.localeCompare(right.id))
  const effects: EncounterEffect[] = targets.map(target => parseEncounterEffect({
    id: `ability.pressure.suppressed.${shortHash(input.operationId, target.id)}`,
    kind: 'condition',
    source: { operationId: input.operationId, moveId: 'ability.pressure', placementId: actorId },
    affected: {
      placementIds: [target.id], sideIds: [], cells: [{ ...target.position }],
    },
    createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
    createdTurn: Math.max(0, encounter.history.currentTurn?.turn ?? 0),
    duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
    stacks: 1, charges: null,
    stackPolicy: { kind: 'refresh', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['ability', 'aa084', 'pressure', 'condition', 'suppressed'],
    payload: { conditionId: 'suppressed', action: 'apply', saveTiming: null },
    dispel: { policy: 'matching-tags', tags: ['condition', 'suppressed'] },
    suppression: { sources: [] },
  }, `ability.pressure.effects[${target.id}]`))
  const current = parseEncounterState({ ...encounter, effects: [...encounter.effects, ...effects] })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input, reasonCode: 'ability.aa084.pressure.suppressed', current,
    })]),
    presentationKey: targets.length > 0
      ? 'ability.aa084.pressure.suppressed'
      : 'ability.aa084.pressure.no-targets',
    controllerPresentationValues: targets.map(target => target.id),
  })
}

const primeFury = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa084ActivatedExecution => {
  const paid = paidSceneEncounter({ ...input, canonicalId: 'Prime Fury', resource: 'swift' })
  const conditions = normalizeConditionNames([
    ...(input.context.actor.token.sheetConditions ?? []),
    'Rage',
  ])
  const stages: CombatStageMap = {
    ...input.context.actor.token.combatStages,
    atk: Math.min(6, input.context.actor.token.combatStages.atk + 1),
    satk: Math.min(6, input.context.actor.token.combatStages.satk + 1),
  }
  let current = applyConditionsToSheet(
    input.context.actor.sheet.kind,
    input.context.actor.sheet.sheet,
    conditions,
  )
  current = applyCombatStagesToSheet(input.context.actor.sheet.kind, current, stages)
  current.revision = nextRevision(input.context.actor.sheet.revision)
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({ ...input, reasonCode: 'ability.aa084.prime-fury.frequency', current: paid }),
      sheetChange({
        ...input, reasonCode: 'ability.aa084.prime-fury.applied', current,
        changedFields: ['conditions', 'combatStages'],
      }),
    ]),
    presentationKey: 'ability.aa084.prime-fury.applied',
  })
}

const propellerTail = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa084ActivatedExecution => {
  const paid = paidSceneEncounter({ ...input, canonicalId: 'Propeller Tail', resource: 'swift' })
  const encounter = actionEncounter({
    context: contextWithEncounter(input.context, paid),
    operationId: `${input.operationId}:sprint`,
    canonicalId: 'Propeller Tail',
    resource: 'free',
  })
  const sprint = referenceManeuverOptions().find(option => option.name === 'Sprint')
    ?? fail('Propeller Tail could not resolve the reviewed Sprint Maneuver.')
  const metadata = appendManeuverLogEntry(input.context.map.metadata, {
    userId: input.context.actor.placement.id,
    userName: input.context.actor.token.species,
    maneuverName: sprint.name,
    lines: buildManeuverUseLogLines(input.context.actor.token, {
      ...sprint,
      action: 'Free Action (Propeller Tail)',
    }),
  }, { now: () => input.context.time })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        ...input, reasonCode: 'ability.aa084.propeller-tail.frequency', current: encounter,
      }),
      {
        kind: 'map-metadata',
        scope: { kind: 'map', mapSlug: input.context.map.slug },
        expectedRevision: normalizeRevision(input.context.map.revision),
        sourceOperationId: `${input.operationId}:sprint`,
        reasonCode: 'ability.aa084.propeller-tail.free-sprint',
        previous: deepCloneJson(input.context.map.metadata),
        current: metadata,
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    ]),
    presentationKey: 'ability.aa084.propeller-tail.free-sprint',
  })
}

export const executeAa084ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa084ActivatedExecution | null => {
  if (input.context.actor.token.currentHp <= 0) fail('The ability cannot be used while Fainted.')
  if (input.operation.mechanicId === 'aa084.power-construct') return powerConstruct(input)
  if (input.operation.mechanicId === 'aa084.power-of-alchemy') return powerOfAlchemy(input)
  if (input.operation.mechanicId === 'aa084.pressure') return pressure(input)
  if (input.operation.mechanicId === 'aa084.prime-fury') return primeFury(input)
  if (input.operation.mechanicId === 'aa084.propeller-tail') return propellerTail(input)
  return null
}
