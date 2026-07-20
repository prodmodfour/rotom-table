import type { EncounterEffectDuration } from '#shared/moveAutomation/encounterEffects'
import { pokemonTypeId, type PokemonTypeId } from '#shared/pokemonTypes'
import type {
  MoveBranchEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveHazardEffectOperation,
  MoveRollEffectOperation,
  MoveTemporaryEffectOperation,
  MoveUsageEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'
import {
  reviewedCondition,
  reviewedDamage,
  reviewedHeal,
  reviewedStage,
  standardAccuracy,
  standardTerminalOperations,
} from '../specs/reviewedSpecBuilder'

export const FIELD_HAZARD_226_233_HANDLER_ID = 'ma226-233.field-hazard-context' as const

const accuracy = (slug: string, ignoreEvasion = false): MoveRollEffectOperation => {
  const base = standardAccuracy(slug) as MoveRollEffectOperation
  if (!ignoreEvasion || base.payload.formula.kind === 'table') return base
  return {
    ...base,
    payload: {
      ...base.payload,
      evasionRule: {
        kind: 'ignore-always', sourceId: `${slug}.isolated-target`,
        reasonCode: `${slug}.isolated-target-ignore-evasion`,
      },
    },
  }
}

const targetState = (context: RegisteredMoveHandlerContext) => {
  const placement = context.selectedPlacements[0]
  if (!placement) throw new Error(`${context.intent.moveName} requires an authoritative target.`)
  const state = context.queries.targetStates.resolve(placement.id)
  if (!state) throw new Error(`${context.intent.moveName} target state is unavailable.`)
  return { placement, state }
}

const attack = (input: {
  readonly context: RegisteredMoveHandlerContext
  readonly slug: string
  readonly damageBase: number
  readonly damageClass: 'physical' | 'special'
  readonly moveType: string
  readonly conditionId?: string
  readonly conditionMinimum?: number
  readonly conditionAlways?: boolean
  readonly ignoreEvasion?: boolean
  readonly areaSmite?: boolean
}): readonly MoveEffectOperation[] => [
  accuracy(input.slug, input.ignoreEvasion),
  reviewedDamage({
    slug: input.slug, damageBase: input.damageBase, damageClass: input.damageClass,
    moveType: input.moveType, ...(input.areaSmite ? { recipients: 'attacked-targets' as const } : {}),
  }),
  ...(input.conditionId ? [reviewedCondition({
    slug: input.slug, id: input.conditionId, recipients: 'hit-targets', conditionId: input.conditionId,
    sourceOperationId: `${input.slug}.damage`,
    ...(input.conditionAlways ? {} : {
      accuracyRollTrigger: {
        rollId: `${input.slug}.accuracy-roll`,
        trigger: { kind: 'range' as const, minimum: input.conditionMinimum ?? 15 },
      },
    }),
    applyTypeImmunity: true,
  })] : []),
  ...standardTerminalOperations(input.slug),
]

const weatherAttack = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const name = context.intent.moveName
  if (name === 'Blizzard') return attack({ context, slug: 'blizzard', damageBase: 11, damageClass: 'special', moveType: 'ice', conditionId: 'frozen', conditionMinimum: 15, areaSmite: true })
  if (name === 'Hurricane') return attack({ context, slug: 'hurricane', damageBase: 11, damageClass: 'special', moveType: 'flying', conditionId: 'confused', conditionMinimum: 15, areaSmite: true })
  if (name === 'Thunder') return attack({ context, slug: 'thunder', damageBase: 11, damageClass: 'special', moveType: 'electric', conditionId: 'paralyzed', conditionMinimum: 15 })
  if (name === 'Inferno') return attack({ context, slug: 'inferno', damageBase: 10, damageClass: 'special', moveType: 'fire', conditionId: 'burned', conditionAlways: true, ignoreEvasion: isolatedTarget(context) })
  return attack({ context, slug: 'zap-cannon', damageBase: 12, damageClass: 'special', moveType: 'electric', conditionId: 'paralyzed', conditionAlways: true, ignoreEvasion: isolatedTarget(context) })
}

const gridDistance = (
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): number => Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y), Math.abs(left.z - right.z))

const isolatedTarget = (context: RegisteredMoveHandlerContext): boolean => {
  const { placement } = targetState(context)
  const nearbyCombatant = context.candidatePlacements.some(candidate => (
    candidate.id !== placement.id && gridDistance(candidate.position, placement.position) <= 2
  ))
  const nearbyTerrain = context.map.voxels.some(voxel => (
    gridDistance(voxel, placement.position) <= 2
    && (voxel.blocksMovement || voxel.blocksSight || voxel.tags?.some(tag => (
      ['rough', 'slow', 'blocking'].includes(tag.toLowerCase())
    )))
  ))
  return !nearbyCombatant && !nearbyTerrain
}

const healing = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const name = context.intent.moveName
  let slug: string
  let percent: number
  let recipients: 'actor' | 'selected-targets'
  if (name === 'Floral Healing') {
    slug = 'floral-healing'
    const { placement } = targetState(context)
    const grassy = context.queries.terrain.membership({ placementId: placement.id }).terrains
      .some(terrain => terrain.kind === 'grassy')
    percent = grassy ? 200 / 3 : 50
    recipients = 'selected-targets'
  }
  else {
    slug = name === 'Morning Sun' ? 'morning-sun' : name === 'Shore Up' ? 'shore-up' : 'moonlight'
    const profile = name === 'Shore Up' ? 'shore-up' : 'solar-restoration'
    percent = context.queries.weather.healing({ profile }).percent ?? 50
    recipients = 'actor'
  }
  return [
    reviewedHeal({ slug, id: 'heal', recipients, calculation: { kind: 'percent-max', percent }, phase: 'hit' }),
    ...standardTerminalOperations(slug),
  ]
}

const conditionDuration = (
  effectId: string,
  duration: EncounterEffectDuration,
): NonNullable<MoveConditionEffectOperation['payload']['duration']> => ({ effectId, duration })

const condition = (
  slug: string,
  id: string,
  action: 'apply' | 'remove',
  duration: EncounterEffectDuration | null = null,
): MoveConditionEffectOperation => reviewedCondition({
  slug, id: `${action}-${id}`, recipients: 'actor', conditionId: id, action,
  phase: 'hit', ...(duration ? { duration: conditionDuration(`${slug}.${id}`, duration) } : {}),
})

const setup = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const name = context.intent.moveName
  const slug = name === 'Acid Armor' ? 'acid-armor' : name === 'Geomancy' ? 'geomancy' : name === 'Solar Blade' ? 'solar-blade' : 'solar-beam'
  const state = context.queries.resources.setupExecuteState(context.actor.placement.id)
  const executing = state?.canonicalMoveId === name && state.status === 'ready-to-execute'

  if (name === 'Acid Armor') {
    return executing
      ? [
          condition(slug, 'liquefied', 'remove'), condition(slug, 'slowed', 'remove'),
          reviewedStage({ slug, id: 'raise-defense', recipients: 'actor', stage: 'def', value: 1, phase: 'hit' }),
          standardTerminalOperations(slug)[1]!,
        ]
      : [
          condition(slug, 'liquefied', 'apply', { kind: 'scene', remaining: null }),
          condition(slug, 'slowed', 'apply', { kind: 'scene', remaining: null }),
          ...standardTerminalOperations(slug),
        ]
  }
  if (name === 'Geomancy') {
    if (executing) return [
      reviewedStage({ slug, id: 'raise-special-attack', recipients: 'actor', stage: 'satk', value: 2, phase: 'hit' }),
      reviewedStage({ slug, id: 'raise-special-defense', recipients: 'actor', stage: 'sdef', value: 2, phase: 'hit' }),
      reviewedStage({ slug, id: 'raise-speed', recipients: 'actor', stage: 'spd', value: 2, phase: 'hit' }),
      standardTerminalOperations(slug)[1]!,
    ]
    const roughTerrain: MoveHazardEffectOperation = {
      id: 'geomancy.rough-terrain', kind: 'hazard', source: { kind: 'move', id: 'move.geomancy' },
      recipients: { kind: 'none' }, phase: 'schedule', reasonCode: 'geomancy.rough-terrain',
      payload: {
        action: 'add', familyId: 'hazard.geomancy-rough', zoneKind: 'hazard', effectId: 'geomancy-rough', ownership: 'neutral',
        geometry: {
          kind: 'selection', cellSetId: 'geomancy.rough-cells',
          count: { kind: 'up-to', minimum: 0, maximum: 32 },
          adjacency: 'including-diagonal', connectedness: 'none',
        },
        layers: 1, maxLayers: 1, charges: null, maxCharges: null,
        cellSelection: {
          requestId: 'geomancy.rough-cells', promptKey: 'move.geomancy.choose-rough-cells',
          count: { kind: 'up-to', minimum: 0, maximum: 32 }, range: 3, adjacency: 'including-diagonal', connectedness: 'none',
          occupancy: 'allow-occupied', geometry: { kind: 'horizontal-plane' },
        },
      },
    }
    return [condition(slug, 'stuck', 'apply', { kind: 'rounds', boundary: 'end', remaining: 1 }), roughTerrain, ...standardTerminalOperations(slug)]
  }

  const charge = context.queries.weather.charge({ canonicalMoveId: name === 'Solar Blade' ? 'Solar Blade' : 'Solar Beam' })
  const immediate = charge.setup === 'skipped'
  if (!executing && !immediate) {
    return name === 'Solar Blade'
      ? [
          reviewedStage({ slug, id: 'setup-raise-attack', recipients: 'actor', stage: 'atk', value: 1, phase: 'hit' }),
          reviewedStage({ slug, id: 'setup-raise-special-defense', recipients: 'actor', stage: 'sdef', value: 1, phase: 'hit' }),
          ...standardTerminalOperations(slug),
        ]
      : [...standardTerminalOperations(slug)]
  }
  return [
    ...attack({
      context, slug, damageBase: charge.damageBaseOverride ?? (name === 'Solar Blade' ? 13 : 12),
      damageClass: name === 'Solar Blade' ? 'physical' : 'special', moveType: 'grass',
    }).filter(operation => executing ? operation.id !== `${slug}.usage` : true),
  ]
}

const canonicalTypeIds = (values: readonly string[]): readonly PokemonTypeId[] => values
  .map(value => pokemonTypeId(value))
  .filter((value): value is PokemonTypeId => value !== null)

const typeOverlay = (slug: string, id: string, typeIds: readonly string[]): MoveTemporaryEffectOperation => ({
  id: `${slug}.${id}`, kind: 'temporary-effect', source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'actor' }, phase: 'schedule', reasonCode: `${slug}.${id}`,
  payload: {
    action: 'add', effectId: `${slug}.type`, recipientScope: 'placements',
    definition: {
      kind: 'creature-rule-overlay', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
      tags: [slug, 'type'],
      payload: { domain: 'type', action: 'replace', values: canonicalTypeIds(typeIds), referencePlacementId: null, suppressionScope: null },
      dispel: { policy: 'matching-tags', tags: [slug, 'type'] }, transferPolicy: 'expire',
    },
  },
})

const typeChoice = (
  slug: string,
  typeIds: readonly string[],
): readonly MoveEffectOperation[] => {
  const unique = [...new Set(typeIds)]
  if (unique.length === 1) return [typeOverlay(slug, `become-${unique[0]}`, [unique[0]!]), ...standardTerminalOperations(slug)]
  const branch: MoveBranchEffectOperation = {
    id: `${slug}.choose-type`, kind: 'branch', source: { kind: 'move', id: `move.${slug}` },
    recipients: { kind: 'actor' }, phase: 'target', reasonCode: `${slug}.choose-type`,
    payload: {
      kind: 'choice', selectionId: `${slug}.type`, scope: 'resolution', owner: 'actor',
      requestId: `${slug}.type`, promptKey: `move.${slug}.choose-type`,
      options: unique.map(type => ({ id: type, labelKey: `type.${type}`, operationIds: [`${slug}.become-${type}`] })),
      pass: null,
    },
  }
  return [branch, ...unique.map(type => typeOverlay(slug, `become-${type}`, [type])), ...standardTerminalOperations(slug)]
}

const camouflage = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const actorId = context.actor.placement.id
  const terrainTypes = context.queries.terrain.membership({ placementId: actorId }).terrains.map(terrain => ({
    electric: 'electric', grassy: 'grass', misty: 'fairy', psychic: 'psychic',
  }[terrain.kind]))
  const weatherTypes = context.queries.weather.active().map(weather => ({
    sunny: 'fire', rainy: 'water', hail: 'ice', sandstorm: 'rock',
  }[weather.kind]))
  return typeChoice('camouflage', [...terrainTypes, ...weatherTypes, 'normal'])
}

const fieldDamageChoice = (input: {
  readonly context: RegisteredMoveHandlerContext
  readonly slug: 'terrain-pulse' | 'weather-ball'
  readonly options: readonly { readonly id: string; readonly type: string }[]
}): readonly MoveEffectOperation[] => {
  const unique = [...new Map(input.options.map(option => [option.id, option])).values()]
  const makeDamage = (option: { readonly id: string; readonly type: string }, id?: string) => reviewedDamage({
    slug: input.slug, ...(id ? { id } : {}), damageBase: unique.length ? 10 : 5,
    damageClass: 'special', moveType: option.type,
  })
  if (unique.length <= 1) {
    const option = unique[0] ?? { id: 'normal', type: 'normal' }
    return [standardAccuracy(input.slug), makeDamage(option), ...standardTerminalOperations(input.slug)]
  }
  const branch: MoveBranchEffectOperation = {
    id: `${input.slug}.choose-field`, kind: 'branch', source: { kind: 'move', id: `move.${input.slug}` },
    recipients: { kind: 'selected-targets' }, phase: 'target', reasonCode: `${input.slug}.choose-field`,
    payload: {
      kind: 'choice', selectionId: `${input.slug}.field`, scope: 'resolution', owner: 'actor',
      requestId: `${input.slug}.field`, promptKey: `move.${input.slug}.choose-field`,
      options: unique.map(option => ({ id: option.id, labelKey: `field.${option.id}`, operationIds: [`${input.slug}.damage-${option.id}`] })),
      pass: null,
    },
  }
  return [branch, standardAccuracy(input.slug), ...unique.map(option => makeDamage(option, `damage-${option.id}`)), ...standardTerminalOperations(input.slug)]
}

const terrainPulse = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const actorId = context.actor.placement.id
  const map = { electric: 'electric', grassy: 'grass', misty: 'fairy', psychic: 'psychic' } as const
  return fieldDamageChoice({
    context, slug: 'terrain-pulse',
    options: context.queries.terrain.membership({ placementId: actorId }).terrains.map(value => ({ id: value.kind, type: map[value.kind] })),
  })
}
const weatherBall = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const map = { sunny: 'fire', rainy: 'water', hail: 'ice', sandstorm: 'rock' } as const
  return fieldDamageChoice({
    context, slug: 'weather-ball', options: context.queries.weather.active().map(value => ({ id: value.kind, type: map[value.kind] })),
  })
}

const alternateUsage = (slug: string): MoveUsageEffectOperation => ({
  id: `${slug}.alternate-usage`, kind: 'usage', source: { kind: 'move', id: `move.${slug}` }, recipients: { kind: 'actor' },
  phase: 'usage', reasonCode: `${slug}.alternate-once-per-scene`,
  payload: { action: 'spend', resourceId: `${slug}.alternate-use`, amount: 1, resource: { moveName: `${slug} alternate`, moveKey: `${slug}-alternate`, frequency: 'Scene' } },
})

const bitterMalice = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const eligible = targetState(context).state.conditionIds.length > 0
  const damageIds = eligible ? ['damage-normal', 'damage-boosted'] : ['damage']
  const operations: MoveEffectOperation[] = []
  if (eligible) {
    operations.push({
      id: 'bitter-malice.choose-alternate', kind: 'branch', source: { kind: 'move', id: 'move.bitter-malice' },
      recipients: { kind: 'selected-targets' }, phase: 'target', reasonCode: 'bitter-malice.choose-alternate',
      payload: {
        kind: 'choice', selectionId: 'bitter-malice.alternate', scope: 'resolution', owner: 'actor',
        requestId: 'bitter-malice.alternate', promptKey: 'move.bitter-malice.choose-alternate',
        options: [
          { id: 'normal', labelKey: 'move.alternate.normal', operationIds: ['bitter-malice.damage-normal', 'bitter-malice.stuck-damage-normal', 'bitter-malice.trapped-damage-normal'] },
          { id: 'boosted', labelKey: 'move.alternate.boosted', operationIds: ['bitter-malice.damage-boosted', 'bitter-malice.stuck-damage-boosted', 'bitter-malice.trapped-damage-boosted', 'bitter-malice.alternate-usage'] },
        ], pass: null,
      },
    })
  }
  operations.push(standardAccuracy('bitter-malice'))
  const damageOperations = damageIds.map(id => reviewedDamage({
    slug: 'bitter-malice', id, damageBase: id === 'damage-boosted' ? 12 : 6,
    damageClass: 'special', moveType: 'ghost',
  }))
  const conditionOperations = damageIds.flatMap(id => ['stuck', 'trapped'].map(conditionId => (
    reviewedCondition({
      slug: 'bitter-malice', id: `${conditionId}-${id}`, recipients: 'hit-targets', conditionId,
      sourceOperationId: `bitter-malice.${id}`,
      accuracyRollTrigger: { rollId: 'bitter-malice.accuracy-roll', trigger: { kind: 'range', minimum: 19 } },
      duration: conditionDuration(`bitter-malice.${conditionId}-${id}`, { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 }), applyTypeImmunity: true,
    })
  )))
  operations.push(...damageOperations, ...conditionOperations)
  if (eligible) operations.push(alternateUsage('bitter-malice'))
  operations.push(...standardTerminalOperations('bitter-malice'))
  return operations
}

const burnUp = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const actorTypes = context.queries.targetStates.resolve(context.actor.placement.id)?.typeIds ?? []
  const remaining = actorTypes.filter(type => type !== 'fire')
  return [
    ...attack({ context, slug: 'burn-up', damageBase: 13, damageClass: 'special', moveType: 'fire', areaSmite: true })
      .filter(operation => !['burn-up.usage', 'burn-up.log-completed'].includes(operation.id)),
    typeOverlay('burn-up', 'remove-fire', remaining.length ? remaining : ['normal']),
    ...standardTerminalOperations('burn-up'),
  ]
}

const pledge = (context: RegisteredMoveHandlerContext): readonly MoveEffectOperation[] => {
  const name = context.intent.moveName
  const slug = name.toLowerCase().replace(' ', '-')
  const type = name.split(' ')[0]!.toLowerCase()
  const operations: MoveEffectOperation[] = [
    ...attack({ context, slug, damageBase: 8, damageClass: 'special', moveType: type })
      .filter(operation => ![`${slug}.usage`, `${slug}.log-completed`].includes(operation.id)),
  ]
  const previous = context.queries.history.lastCompletedMove()
  const selected = context.selectedPlacements[0]
  const combo = previous && selected
    && ['Fire Pledge', 'Grass Pledge', 'Water Pledge'].includes(previous.canonicalId)
    && previous.canonicalId !== name
    && previous.attackedTargetIds.includes(selected.id)
    && context.queries.relationships.resolve(context.actor.placement.id, previous.actorPlacementId).relationship === 'ally'
    ? new Set([name.split(' ')[0], previous.canonicalId.split(' ')[0]])
    : null
  if (combo?.has('Fire') && combo.has('Grass')) {
    operations.push({
      id: `${slug}.fire-grass-hazard`, kind: 'hazard', source: { kind: 'operation', id: `${slug}.damage` },
      recipients: { kind: 'none' }, phase: 'schedule', reasonCode: `${slug}.fire-grass-hazard`,
      payload: {
        action: 'add', familyId: 'pledge.fire-grass', zoneKind: 'pledge', effectId: 'fire-grass', ownership: 'source-side',
        geometry: { kind: 'blast', center: 'selected-target', size: 1, count: { kind: 'up-to', minimum: 0, maximum: 16 }, adjacency: 'including-diagonal', connectedness: 'none' },
        layers: 1, maxLayers: 1, charges: null, maxCharges: null,
      },
    })
  }
  if (combo?.has('Water') && combo.has('Grass')) {
    for (const recipients of ['hit-targets', 'cardinally-adjacent-to-hit-targets'] as const) {
      operations.push(reviewedCondition({ slug, id: `slow-${recipients}`, recipients, conditionId: 'slowed', sourceOperationId: `${slug}.damage`, applyTypeImmunity: true }))
      operations.push(reviewedStage({ slug, id: `lower-speed-${recipients}`, recipients, stage: 'spd', value: -2, sourceOperationId: `${slug}.damage`, applyTypeImmunity: true }))
    }
  }
  operations.push(...standardTerminalOperations(slug))
  return operations
}

const run = (context: RegisteredMoveHandlerContext) => {
  const name = context.intent.moveName
  let operations: readonly MoveEffectOperation[]
  if (['Blizzard', 'Hurricane', 'Inferno', 'Thunder', 'Zap Cannon'].includes(name)) operations = weatherAttack(context)
  else if (['Floral Healing', 'Moonlight', 'Morning Sun', 'Shore Up'].includes(name)) operations = healing(context)
  else if (['Acid Armor', 'Geomancy', 'Solar Beam', 'Solar Blade'].includes(name)) operations = setup(context)
  else if (name === 'Camouflage') operations = camouflage(context)
  else if (name === 'Terrain Pulse') operations = terrainPulse(context)
  else if (name === 'Weather Ball') operations = weatherBall(context)
  else if (name === 'Bitter Malice') operations = bitterMalice(context)
  else if (name === 'Burn Up') operations = burnUp(context)
  else if (['Fire Pledge', 'Grass Pledge', 'Water Pledge'].includes(name)) operations = pledge(context)
  else throw new Error(`Field/hazard contextual handler cannot execute ${name}.`)
  return {
    operations,
    traceEntries: [{
      kind: 'predicate' as const, phase: 'declare' as const,
      predicateId: `field-hazard.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      outcome: true, reasonCode: 'field-hazard.authoritative-context-resolved',
      input: { operationCount: operations.length },
    }],
  }
}

export const FIELD_HAZARD_226_233_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({ id: FIELD_HAZARD_226_233_HANDLER_ID, version: 1, run })
