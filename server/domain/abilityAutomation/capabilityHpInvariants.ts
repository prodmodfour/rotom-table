import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import { hasEffectiveCapability } from '#shared/capabilityAutomation/effective'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  computeInjuryAdjustedMaxHp,
  computePokemonFormulaMaxHp,
  normalizeInjuryCount,
} from '~/utils/ptuHp'
import { pokemonHasResolvedCapability, resolveStats } from '~/utils/sheets/pokemonDerived'
import {
  applyHpToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import {
  mapWithTemporaryHpForPlacement,
  temporaryHpForPlacement,
} from '~/utils/mapTemporaryHitPoints'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { resolveEffectiveCapabilities } from '../capabilityAutomation/effectiveCapabilities'
import {
  expandSourceEffectiveAsOneFaintedPlacements,
  removeCrownedCapabilityModesForFaintedPlacements,
} from '../capabilityAutomation/hpInvariants'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveSheetDocument,
  type MoveSheetStateField,
  type MoveStateChange,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'
import { applyNativeCoreMapChanges } from '../moveAutomation/planNativeV2MoveState'
import { reconcileAa075IceFaceTemporaryHpOwnershipAfterMove } from './mechanics/aa075TemporaryHpIntegration'
import type {
  AuthoritativeAbilityContext,
  AuthoritativeAbilityResolvedSheet,
} from './context'

const sheetKey = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

const stripPlanIdentity = (change: MoveStateChange): MoveStateChangeInput => {
  const { id: _id, order: _order, ...input } = change
  return {
    ...deepCloneJson(input),
    previous: deepCloneJson(input.previous),
    current: deepCloneJson(input.current),
  } as MoveStateChangeInput
}

const structuralAsOnePair = (value: unknown): readonly [string, string] | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const link = value as {
    readonly kind?: unknown
    readonly canonicalId?: unknown
    readonly ownerPlacementId?: unknown
    readonly participantPlacementIds?: unknown
  }
  return link.kind === 'as-one-mount'
    && link.canonicalId === 'As One'
    && typeof link.ownerPlacementId === 'string'
    && Array.isArray(link.participantPlacementIds)
    && link.participantPlacementIds.length === 1
    && typeof link.participantPlacementIds[0] === 'string'
    ? [link.ownerPlacementId, link.participantPlacementIds[0]]
    : null
}

const hpForSheet = (
  kind: SheetKind,
  sheet: AnyLiveSheet,
  effectiveSoulless: boolean,
): number => {
  if (kind === 'trainer') {
    const current = (sheet as TrainerSheet).currentHp
    return typeof current === 'number' && Number.isFinite(current) ? current : 1
  }
  const pokemon = sheet as CharacterSheet
  const current = pokemon.combat?.currentHp
  if (typeof current === 'number' && Number.isFinite(current)) return current
  if (effectiveSoulless) return 1
  const hpTotal = resolveStats(pokemon).find(stat => stat.key === 'hp')?.total ?? 0
  return computeInjuryAdjustedMaxHp(
    computePokemonFormulaMaxHp(pokemon.level ?? 1, hpTotal),
    pokemon.combat?.injuries,
  )
}

const injuriesForSheet = (kind: SheetKind, sheet: AnyLiveSheet): number => (
  normalizeInjuryCount(kind === 'pokemon'
    ? (sheet as CharacterSheet).combat?.injuries
    : (sheet as TrainerSheet).currentInjuries)
)

const effectiveCapability = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: AnyLiveSheet
  readonly canonicalId: string
}): boolean => hasEffectiveCapability(resolveEffectiveCapabilities({
  map: input.map,
  placement: input.placement,
  sheet: input.sheet,
}), input.canonicalId)

/**
 * Capability-aware HP projection for Ability contexts. The generic token
 * projector can only see raw sheet capabilities, so suppressed/replaced
 * Soulless must be restored to ordinary PTU HP before Ability rules inspect it.
 */
export const projectAbilityCapabilityHpToken = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly token: SpawnedPokemon
}): SpawnedPokemon => {
  if (input.placement.sheetKind !== 'pokemon') return input.token
  const pokemon = input.sheet as CharacterSheet
  const effectiveSoulless = effectiveCapability({
    map: input.map,
    placement: input.placement,
    sheet: pokemon,
    canonicalId: 'Soulless',
  })
  if (effectiveSoulless) {
    return {
      ...input.token,
      currentHp: Math.min(input.token.currentHp, 1),
      maxHp: 1,
      fullMaxHp: 1,
      temporaryHp: 0,
      injuries: 0,
    }
  }
  if (!pokemonHasResolvedCapability(pokemon, 'Soulless')) return input.token

  const hpTotal = resolveStats(pokemon).find(stat => stat.key === 'hp')?.total ?? 0
  const fullMaxHp = computePokemonFormulaMaxHp(pokemon.level ?? 1, hpTotal)
  const injuries = normalizeInjuryCount(pokemon.combat?.injuries)
  const maxHp = computeInjuryAdjustedMaxHp(fullMaxHp, injuries)
  return {
    ...input.token,
    currentHp: Math.min(maxHp, Math.max(0, pokemon.combat?.currentHp ?? input.token.currentHp)),
    maxHp,
    fullMaxHp,
    temporaryHp: temporaryHpForPlacement(input.map, input.placement.id),
    injuries,
  }
}

/** Resolve exact effective Capability instances and record the backing-sheet read. */
export const abilityEffectiveCapabilitiesForPlacement = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly placementId: string
  readonly sheet?: AnyLiveSheet
}): ReturnType<typeof resolveEffectiveCapabilities> => {
  const placement = input.context.queries.placements.get(input.placementId)
  if (!placement) throw new Error(`Ability Capability placement ${input.placementId} is missing.`)
  const resolved = input.context.queries.sheets.forPlacement(placement)
  if (!resolved) throw new Error(`Ability Capability sheet for ${input.placementId} is missing.`)
  return resolveEffectiveCapabilities({
    map: input.context.map,
    placement,
    sheet: input.sheet ?? resolved.sheet,
  })
}

/** Resolve exact encounter-effective Soulless while recording the backing-sheet read. */
export const abilityPlacementHasEffectiveSoulless = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly placementId: string
  readonly sheet?: AnyLiveSheet
}): boolean => {
  return hasEffectiveCapability(abilityEffectiveCapabilitiesForPlacement(input), 'Soulless')
}

/** Apply an Ability HP write with exact encounter-effective Soulless authority. */
export const applyAbilityHpToSheet = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly placementId: string
  readonly sheet: AnyLiveSheet
  readonly currentHp: number
  readonly injuries?: number
}): AnyLiveSheet => {
  const placement = input.context.queries.placements.get(input.placementId)
  if (!placement) throw new Error(`Ability HP placement ${input.placementId} is missing.`)
  const resolved = input.context.queries.sheets.forPlacement(placement)
  if (!resolved) throw new Error(`Ability HP sheet for ${input.placementId} is missing.`)
  if (resolved.kind !== placement.sheetKind || resolved.slug !== placement.sheetSlug) {
    throw new Error(`Ability HP placement ${input.placementId} changed backing sheet.`)
  }
  return applyHpToSheet(
    placement.sheetKind,
    input.sheet,
    input.currentHp,
    input.injuries,
    {
      effectiveSoulless: abilityPlacementHasEffectiveSoulless({
        context: input.context,
        placementId: input.placementId,
        sheet: input.sheet,
      }),
    },
  )
}

export type AbilityCapabilityHpInvariantErrorCode = 'soulless-temporary-hp'

export class AbilityCapabilityHpInvariantError extends Error {
  readonly code: AbilityCapabilityHpInvariantErrorCode

  constructor(code: AbilityCapabilityHpInvariantErrorCode, message: string) {
    super(message)
    this.name = 'AbilityCapabilityHpInvariantError'
    this.code = code
  }
}

interface ProjectedSheet {
  readonly placement: SheetPlacement
  readonly resolved: AuthoritativeAbilityResolvedSheet
  readonly original: AnyLiveSheet
  current: AnyLiveSheet
  readonly existingChange: Extract<MoveStateChange, { readonly kind: 'sheet-state' }> | null
}

/**
 * Reconcile every Ability-owned HP/Temporary-HP plan at the one transactional
 * boundary. Additional linked sheets are resolved through audited context
 * queries, and all derived writes are returned as one duplicate-slot-free plan.
 */
export const applyCapabilityHpInvariantsToAbilityPlan = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly plan: MoveStateChangePlan
}): MoveStateChangePlan => {
  const previousMap = input.context.map
  const projectedMap = applyNativeCoreMapChanges(previousMap, input.plan)
  const existingSheetChanges = new Map(input.plan.changes.flatMap(change => (
    change.kind === 'sheet-state'
      ? [[sheetKey(change.scope.sheetKind, change.scope.sheetSlug), change] as const]
      : []
  )))
  const placementById = new Map<string, SheetPlacement>()
  for (const placement of [...previousMap.placements, ...projectedMap.placements]) {
    placementById.set(placement.id, placement)
  }

  const projectedSheets = new Map<string, ProjectedSheet>()
  const sheetForPlacement = (placementId: string): ProjectedSheet | null => {
    const placement = placementById.get(placementId)
    if (!placement) return null
    const resolved = input.context.queries.sheets.forPlacement(placement)
    if (!resolved) return null
    const key = sheetKey(resolved.kind, resolved.slug)
    const cached = projectedSheets.get(key)
    if (cached) return cached
    const existingChange = existingSheetChanges.get(key) ?? null
    const projected: ProjectedSheet = {
      placement,
      resolved,
      original: deepCloneJson(resolved.sheet) as AnyLiveSheet,
      current: deepCloneJson(existingChange?.current ?? resolved.sheet) as AnyLiveSheet,
      existingChange,
    }
    projectedSheets.set(key, projected)
    return projected
  }

  const initiallyTouched = new Set<string>()
  for (const change of input.plan.changes) {
    if (change.kind !== 'sheet-state' || !change.changedFields.includes('hp')) continue
    for (const placement of placementById.values()) {
      if (placement.sheetKind === change.scope.sheetKind
        && placement.sheetSlug === change.scope.sheetSlug) initiallyTouched.add(placement.id)
    }
  }

  const temporaryHpIncreased = new Set<string>()
  const temporaryHpPlacementIds = new Set<string>([
    ...placementById.keys(),
    ...Object.keys(previousMap.temporaryHitPoints?.byPlacementId ?? {}),
    ...Object.keys(projectedMap.temporaryHitPoints?.byPlacementId ?? {}),
  ])
  for (const placementId of temporaryHpPlacementIds) {
    const previous = temporaryHpForPlacement(previousMap, placementId)
    const current = temporaryHpForPlacement(projectedMap, placementId)
    if (previous === current) continue
    initiallyTouched.add(placementId)
    if (current > previous) temporaryHpIncreased.add(placementId)
  }
  const hpInvariantRequired = initiallyTouched.size > 0

  const effectiveCapabilitiesByPlacement = new Map<string, ReturnType<typeof resolveEffectiveCapabilities>>()
  const capabilitiesFor = (placementId: string) => {
    const cached = effectiveCapabilitiesByPlacement.get(placementId)
    if (cached) return cached
    const projected = sheetForPlacement(placementId)
    if (!projected) return null
    const capabilities = resolveEffectiveCapabilities({
      map: projectedMap,
      placement: placementById.get(placementId)!,
      sheet: projected.current,
    })
    effectiveCapabilitiesByPlacement.set(placementId, capabilities)
    return capabilities
  }
  const hasCapability = (placementId: string, canonicalId: string): boolean => {
    const capabilities = capabilitiesFor(placementId)
    return capabilities ? hasEffectiveCapability(capabilities, canonicalId) : false
  }

  const links = projectedMap.encounterState?.capabilityRuntime?.links ?? []
  const exactAsOneByLinkId = new Map<string, boolean>()
  const exactAsOneSource = (link: (typeof links)[number]): boolean => {
    const cached = exactAsOneByLinkId.get(link.id)
    if (cached !== undefined) return cached
    const pair = structuralAsOnePair(link)
    if (!pair) {
      exactAsOneByLinkId.set(link.id, false)
      return false
    }
    const capabilities = capabilitiesFor(link.ownerPlacementId)
    const effective = capabilities?.instances.some(instance => (
      instance.effective
      && instance.canonicalId === 'As One'
      && instance.canonicalId === link.canonicalId
      && instance.instanceId === link.capabilityInstanceId
    )) === true
    exactAsOneByLinkId.set(link.id, effective)
    return effective
  }

  // Discover only the exact-source-effective connected component. Placements
  // sharing one backing sheet are aliases of the same HP state, so closure must
  // traverse those aliases as well as links. Suppressed and stale links are
  // consulted for authority but never mutate counterparts.
  const related = new Set(initiallyTouched)
  let expanded = true
  while (expanded) {
    expanded = false
    for (const placementId of [...related]) {
      const placement = placementById.get(placementId)
      if (!placement) continue
      for (const alias of placementById.values()) {
        if (alias.sheetKind !== placement.sheetKind || alias.sheetSlug !== placement.sheetSlug
          || related.has(alias.id)) continue
        related.add(alias.id)
        expanded = true
      }
    }
    for (const link of links) {
      const pair = structuralAsOnePair(link)
      if (!pair || (!related.has(pair[0]) && !related.has(pair[1]))) continue
      if (!exactAsOneSource(link)) continue
      for (const placementId of pair) {
        if (related.has(placementId)) continue
        related.add(placementId)
        expanded = true
      }
    }
  }

  for (const placementId of temporaryHpIncreased) {
    if (hasCapability(placementId, 'Soulless')) {
      throw new AbilityCapabilityHpInvariantError(
        'soulless-temporary-hp',
        'Soulless creatures cannot gain Temporary HP.',
      )
    }
  }

  let finalMap = projectedMap
  const invariantChangedSheetKeys = new Set<string>()
  const updateProjectedSheet = (
    placementId: string,
    update: (projected: ProjectedSheet, effectiveSoulless: boolean) => AnyLiveSheet,
  ): void => {
    const projected = sheetForPlacement(placementId)
    if (!projected) return
    const effectiveSoulless = hasCapability(placementId, 'Soulless')
    const current = update(projected, effectiveSoulless)
    if (sameJsonValue(projected.current, current)) return
    projected.current = current
    invariantChangedSheetKeys.add(sheetKey(projected.resolved.kind, projected.resolved.slug))
  }

  for (const placementId of related) {
    if (!hasCapability(placementId, 'Soulless')) continue
    updateProjectedSheet(placementId, projected => applyHpToSheet(
      projected.resolved.kind,
      projected.current,
      hpForSheet(projected.resolved.kind, projected.current, true),
      0,
      { effectiveSoulless: true },
    ))
    if (temporaryHpForPlacement(finalMap, placementId) > 0) {
      finalMap = mapWithTemporaryHpForPlacement(finalMap, placementId, 0)
    }
  }

  const faintedSeeds = new Set<string>()
  for (const placementId of related) {
    const projected = sheetForPlacement(placementId)
    if (!projected) continue
    if (hpForSheet(
      projected.resolved.kind,
      projected.current,
      hasCapability(placementId, 'Soulless'),
    ) <= 0) faintedSeeds.add(placementId)
  }
  const fainted = new Set(faintedSeeds)
  let faintedExpanded = hpInvariantRequired
  while (faintedExpanded) {
    faintedExpanded = false
    const linkedFainted = expandSourceEffectiveAsOneFaintedPlacements({
      map: projectedMap,
      faintedPlacementIds: fainted,
      sourceIsEffective: exactAsOneSource,
    })
    for (const placementId of linkedFainted) {
      if (fainted.has(placementId)) continue
      fainted.add(placementId)
      faintedExpanded = true
    }
    for (const placementId of [...fainted]) {
      const placement = placementById.get(placementId)
      if (!placement) continue
      for (const alias of placementById.values()) {
        if (alias.sheetKind !== placement.sheetKind || alias.sheetSlug !== placement.sheetSlug
          || fainted.has(alias.id)) continue
        fainted.add(alias.id)
        faintedExpanded = true
      }
    }
  }
  for (const placementId of fainted) {
    updateProjectedSheet(placementId, (projected, effectiveSoulless) => applyHpToSheet(
      projected.resolved.kind,
      projected.current,
      0,
      injuriesForSheet(projected.resolved.kind, projected.current),
      { effectiveSoulless },
    ))
  }

  const crownedTerminationPlacements = new Set(fainted)
  for (const placementId of initiallyTouched) {
    const projected = sheetForPlacement(placementId)
    if (!projected) continue
    if (hpForSheet(
      projected.resolved.kind,
      projected.original,
      hasCapability(placementId, 'Soulless'),
    ) <= 0) crownedTerminationPlacements.add(placementId)
  }
  const projectedEncounter = parseEncounterState(
    finalMap.encounterState ?? createEmptyEncounterState(),
  )
  const invariantEncounter = removeCrownedCapabilityModesForFaintedPlacements(
    projectedEncounter,
    crownedTerminationPlacements,
  )
  if (!sameJsonValue(projectedEncounter, invariantEncounter)) {
    finalMap = { ...finalMap, encounterState: invariantEncounter }
  }

  finalMap = reconcileAa075IceFaceTemporaryHpOwnershipAfterMove({
    previousMap,
    nextMap: finalMap,
    operations: [],
    ...(input.context.runtime.canonicalId === 'Ice Face'
      ? { featureOwnedIncreasePlacementIds: new Set([input.context.actor.placement.id]) }
      : {}),
  })

  const encounterChangedByReconciliation = !sameJsonValue(
    projectedMap.encounterState,
    finalMap.encounterState,
  )
  const temporaryHpChangedByReconciliation = !sameJsonValue(
    projectedMap.temporaryHitPoints,
    finalMap.temporaryHitPoints,
  )
  const previousEncounter = parseEncounterState(
    previousMap.encounterState ?? createEmptyEncounterState(),
  )
  const finalEncounter = parseEncounterState(
    finalMap.encounterState ?? createEmptyEncounterState(),
  )
  const needsEncounterChange = !sameJsonValue(previousEncounter, finalEncounter)
  const needsTemporaryHpChange = !sameJsonValue(
    previousMap.temporaryHitPoints,
    finalMap.temporaryHitPoints,
  )

  let emittedEncounter = false
  let emittedTemporaryHp = false
  const output: MoveStateChangeInput[] = []
  for (const change of input.plan.changes) {
    if (change.kind === 'encounter-state') {
      if (!needsEncounterChange || emittedEncounter) continue
      emittedEncounter = true
      output.push({
        ...stripPlanIdentity(change),
        ...(encounterChangedByReconciliation
          ? { sourceOperationId: null, reasonCode: 'ability.capability-hp-invariants.encounter' }
          : {}),
        current: finalEncounter,
      } as MoveStateChangeInput)
      continue
    }
    if (change.kind === 'map-temporary-hit-points') {
      if (!needsTemporaryHpChange || emittedTemporaryHp) continue
      emittedTemporaryHp = true
      output.push({
        ...stripPlanIdentity(change),
        ...(temporaryHpChangedByReconciliation
          ? { sourceOperationId: null, reasonCode: 'ability.capability-hp-invariants.temporary-hp' }
          : {}),
        current: deepCloneJson(finalMap.temporaryHitPoints),
      } as MoveStateChangeInput)
      continue
    }
    if (change.kind === 'sheet-state') {
      const key = sheetKey(change.scope.sheetKind, change.scope.sheetSlug)
      const projected = projectedSheets.get(key)
      if (!projected || !invariantChangedSheetKeys.has(key)) {
        output.push(stripPlanIdentity(change))
        continue
      }
      const changedFields = new Set<MoveSheetStateField>([...change.changedFields, 'hp'])
      output.push({
        ...stripPlanIdentity(change),
        sourceOperationId: null,
        reasonCode: 'ability.capability-hp-invariants.sheet',
        current: {
          ...deepCloneJson(projected.current),
          slug: change.scope.sheetSlug,
          revision: normalizeRevision((change.current as { revision?: number }).revision),
        } as MoveSheetDocument,
        changedFields: [...changedFields],
      } as MoveStateChangeInput)
      continue
    }
    output.push(stripPlanIdentity(change))
  }

  if (needsEncounterChange && !emittedEncounter) {
    output.push({
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: previousMap.slug },
      expectedRevision: normalizeRevision(previousMap.revision),
      sourceOperationId: input.context.resolutionId,
      reasonCode: 'ability.capability-hp-invariants.encounter',
      previous: previousEncounter,
      current: finalEncounter,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  if (needsTemporaryHpChange && !emittedTemporaryHp) {
    output.push({
      kind: 'map-temporary-hit-points',
      scope: { kind: 'map', mapSlug: previousMap.slug },
      expectedRevision: normalizeRevision(previousMap.revision),
      sourceOperationId: input.context.resolutionId,
      reasonCode: 'ability.capability-hp-invariants.temporary-hp',
      previous: deepCloneJson(previousMap.temporaryHitPoints),
      current: deepCloneJson(finalMap.temporaryHitPoints),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  for (const [key, projected] of projectedSheets) {
    if (!invariantChangedSheetKeys.has(key) || projected.existingChange) continue
    const current = {
      ...deepCloneJson(projected.current),
      slug: projected.resolved.slug,
      revision: nextRevision(projected.resolved.revision),
    } as MoveSheetDocument
    if (sameJsonValue(projected.original, current)) continue
    output.push({
      kind: 'sheet-state',
      scope: {
        kind: 'sheet',
        sheetKind: projected.resolved.kind,
        sheetSlug: projected.resolved.slug,
      },
      expectedRevision: projected.resolved.revision,
      sourceOperationId: input.context.resolutionId,
      reasonCode: 'ability.capability-hp-invariants.sheet',
      previous: {
        ...deepCloneJson(projected.original),
        slug: projected.resolved.slug,
        revision: projected.resolved.revision,
      } as MoveSheetDocument,
      current,
      changedFields: ['hp'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }

  return createMoveStateChangePlan(output)
}
