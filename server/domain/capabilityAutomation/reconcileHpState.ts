import { hasEffectiveCapability } from '#shared/capabilityAutomation/effective'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  computeInjuryAdjustedMaxHp,
  computePokemonFormulaMaxHp,
  normalizeInjuryCount,
} from '~/utils/ptuHp'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { applyHpToSheet, type AnyLiveSheet } from '~/utils/sheetMutations'
import {
  mapWithTemporaryHpForPlacement,
  temporaryHpForPlacement,
} from '~/utils/mapTemporaryHitPoints'
import { resolveStats } from '~/utils/sheets/pokemonDerived'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import {
  expandSourceEffectiveAsOneFaintedPlacements,
  removeCrownedCapabilityModesForFaintedPlacements,
} from './hpInvariants'
import { clearPhysicalPowerLoadsForPlacements } from './physicalPower'
import { capabilityActorIsFainted } from './actionEligibility'

export interface CapabilityHpStateSheet {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly sheet: CharacterSheet | TrainerSheet
}

export type CapabilityHpStateReconciliationErrorCode =
  | 'missing-sheet'
  | 'soulless-temporary-hp'
  | 'ambiguous-soulless-authority'

export class CapabilityHpStateReconciliationError extends Error {
  constructor(
    readonly code: CapabilityHpStateReconciliationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CapabilityHpStateReconciliationError'
  }
}

export interface ReconcileCapabilityHpStateInput {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  /** Authoritative post-mutation snapshots for every placement consulted. */
  readonly sheets: ReadonlyMap<string, CapabilityHpStateSheet>
  /** Optional pre-mutation snapshots, required when a plan may heal a fainted owner. */
  readonly previousSheets?: ReadonlyMap<string, CapabilityHpStateSheet>
  /** Placement IDs whose HP authority or relevant map state was touched. */
  readonly touchedPlacementIds: ReadonlySet<string>
  /** Reject a newly granted positive value instead of silently discarding it. */
  readonly rejectEffectiveSoullessTemporaryHpIncrease?: boolean
}

export interface ReconciledCapabilityHpState {
  readonly nextMap: TabletopMap
  readonly sheets: ReadonlyMap<string, CapabilityHpStateSheet>
  readonly changedSheetKeys: ReadonlySet<string>
  readonly consultedSheetKeys: ReadonlySet<string>
  readonly relatedPlacementIds: ReadonlySet<string>
  readonly faintedPlacementIds: ReadonlySet<string>
}

export const capabilityHpSheetKey = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

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

const injuriesForSheet = (kind: SheetKind, sheet: AnyLiveSheet): number => normalizeInjuryCount(
  kind === 'pokemon'
    ? (sheet as CharacterSheet).combat?.injuries
    : (sheet as TrainerSheet).currentInjuries,
)

/**
 * Apply the cross-resource HP postconditions shared by every authoritative
 * mutation origin. This function advances no revisions and performs no I/O;
 * callers own CAS, persistence, realtime publication, and operation replay.
 */
export const reconcileCapabilityHpState = (
  input: ReconcileCapabilityHpStateInput,
): ReconciledCapabilityHpState => {
  const previousMap = deepCloneJson(input.previousMap)
  let nextMap = deepCloneJson(input.nextMap)
  const placementById = new Map<string, SheetPlacement>()
  for (const placement of [...previousMap.placements, ...nextMap.placements]) {
    placementById.set(placement.id, placement)
  }

  const projectedSheets = new Map<string, CapabilityHpStateSheet>()
  for (const [key, snapshot] of input.sheets) {
    projectedSheets.set(key, {
      kind: snapshot.kind,
      slug: snapshot.slug,
      revision: snapshot.revision,
      sheet: deepCloneJson(snapshot.sheet),
    })
  }
  const originalSheets = new Map([...(input.previousSheets ?? input.sheets)].map(([key, snapshot]) => [
    key,
    deepCloneJson(snapshot.sheet) as CharacterSheet | TrainerSheet,
  ]))
  const consultedSheetKeys = new Set<string>()
  const changedSheetKeys = new Set<string>()

  const sheetForPlacement = (placementId: string): CapabilityHpStateSheet => {
    const placement = placementById.get(placementId)
    if (!placement) {
      throw new CapabilityHpStateReconciliationError(
        'missing-sheet',
        `Capability HP placement ${placementId} is unavailable.`,
      )
    }
    const key = capabilityHpSheetKey(placement.sheetKind, placement.sheetSlug)
    const sheet = projectedSheets.get(key)
    if (!sheet) {
      throw new CapabilityHpStateReconciliationError(
        'missing-sheet',
        `Capability HP sheet ${key} required by placement ${placementId} is unavailable.`,
      )
    }
    consultedSheetKeys.add(key)
    return sheet
  }

  const effectiveByPlacement = new Map<string, ReturnType<typeof resolveEffectiveCapabilities>>()
  const capabilitiesFor = (placementId: string) => {
    const retained = effectiveByPlacement.get(placementId)
    if (retained) return retained
    const placement = placementById.get(placementId)
    if (!placement) return null
    const snapshot = sheetForPlacement(placementId)
    const effective = resolveEffectiveCapabilities({
      map: nextMap,
      placement,
      sheet: snapshot.sheet,
    })
    effectiveByPlacement.set(placementId, effective)
    return effective
  }
  const hasCapability = (placementId: string, canonicalId: string): boolean => {
    const effective = capabilitiesFor(placementId)
    return effective ? hasEffectiveCapability(effective, canonicalId) : false
  }

  const links = nextMap.encounterState?.capabilityRuntime?.links ?? []
  const exactAsOneByLinkId = new Map<string, boolean>()
  const exactAsOneSource = (link: (typeof links)[number]): boolean => {
    const retained = exactAsOneByLinkId.get(link.id)
    if (retained !== undefined) return retained
    if (!structuralAsOnePair(link)) {
      exactAsOneByLinkId.set(link.id, false)
      return false
    }
    const effective = capabilitiesFor(link.ownerPlacementId)?.instances.some(instance => (
      instance.effective
      && instance.canonicalId === 'As One'
      && link.canonicalId === 'As One'
      && instance.instanceId === link.capabilityInstanceId
    )) === true
    exactAsOneByLinkId.set(link.id, effective)
    return effective
  }

  const related = new Set([...input.touchedPlacementIds].filter(id => placementById.has(id)))
  let expanded = true
  while (expanded) {
    expanded = false
    for (const placementId of [...related]) {
      const placement = placementById.get(placementId)
      if (!placement) continue
      for (const alias of placementById.values()) {
        if (alias.sheetKind === placement.sheetKind && alias.sheetSlug === placement.sheetSlug
          && !related.has(alias.id)) {
          related.add(alias.id)
          expanded = true
        }
      }
    }
    for (const link of links) {
      const pair = structuralAsOnePair(link)
      if (!pair || (!related.has(pair[0]) && !related.has(pair[1]))) continue
      if (!exactAsOneSource(link)) continue
      for (const placementId of pair) {
        if (!related.has(placementId)) {
          related.add(placementId)
          expanded = true
        }
      }
    }
  }

  // One backing sheet cannot safely use two contradictory encounter HP rules.
  const soullessBySheet = new Map<string, boolean>()
  for (const placementId of related) {
    const placement = placementById.get(placementId)!
    const key = capabilityHpSheetKey(placement.sheetKind, placement.sheetSlug)
    const effectiveSoulless = hasCapability(placementId, 'Soulless')
    const retained = soullessBySheet.get(key)
    if (retained !== undefined && retained !== effectiveSoulless) {
      throw new CapabilityHpStateReconciliationError(
        'ambiguous-soulless-authority',
        `Sheet ${key} has contradictory Soulless authority across map placements.`,
      )
    }
    soullessBySheet.set(key, effectiveSoulless)
  }

  if (input.rejectEffectiveSoullessTemporaryHpIncrease !== false) {
    for (const placementId of related) {
      if (temporaryHpForPlacement(nextMap, placementId) > temporaryHpForPlacement(previousMap, placementId)
        && hasCapability(placementId, 'Soulless')) {
        throw new CapabilityHpStateReconciliationError(
          'soulless-temporary-hp',
          'Soulless creatures cannot gain Temporary HP.',
        )
      }
    }
  }

  const updateSheet = (
    placementId: string,
    update: (snapshot: CapabilityHpStateSheet, effectiveSoulless: boolean) => AnyLiveSheet,
  ): void => {
    const placement = placementById.get(placementId)!
    const key = capabilityHpSheetKey(placement.sheetKind, placement.sheetSlug)
    const snapshot = sheetForPlacement(placementId)
    const current = update(snapshot, hasCapability(placementId, 'Soulless'))
    if (sameJsonValue(snapshot.sheet, current)) return
    projectedSheets.set(key, { ...snapshot, sheet: current as CharacterSheet | TrainerSheet })
    changedSheetKeys.add(key)
    // HP writes cannot change Capability acquisition or suppression. Retaining
    // the effective cache makes shared-sheet closure deterministic.
  }

  for (const placementId of related) {
    if (!hasCapability(placementId, 'Soulless')) continue
    updateSheet(placementId, (snapshot) => applyHpToSheet(
      snapshot.kind,
      snapshot.sheet,
      hpForSheet(snapshot.kind, snapshot.sheet, true),
      0,
      { effectiveSoulless: true },
    ))
    if (temporaryHpForPlacement(nextMap, placementId) > 0) {
      nextMap = mapWithTemporaryHpForPlacement(nextMap, placementId, 0)
    }
  }

  const fainted = new Set<string>()
  for (const placementId of related) {
    const snapshot = sheetForPlacement(placementId)
    if (capabilityActorIsFainted(snapshot.sheet)) fainted.add(placementId)
  }
  let faintExpanded = true
  while (faintExpanded) {
    faintExpanded = false
    for (const placementId of expandSourceEffectiveAsOneFaintedPlacements({
      map: nextMap,
      faintedPlacementIds: fainted,
      sourceIsEffective: exactAsOneSource,
    })) {
      if (!fainted.has(placementId)) {
        fainted.add(placementId)
        faintExpanded = true
      }
    }
    for (const placementId of [...fainted]) {
      const placement = placementById.get(placementId)
      if (!placement) continue
      for (const alias of placementById.values()) {
        if (alias.sheetKind === placement.sheetKind && alias.sheetSlug === placement.sheetSlug
          && !fainted.has(alias.id)) {
          fainted.add(alias.id)
          faintExpanded = true
        }
      }
    }
  }

  for (const placementId of fainted) {
    updateSheet(placementId, (snapshot, effectiveSoulless) => applyHpToSheet(
      snapshot.kind,
      snapshot.sheet,
      0,
      injuriesForSheet(snapshot.kind, snapshot.sheet),
      { effectiveSoulless },
    ))
  }

  nextMap = clearPhysicalPowerLoadsForPlacements(nextMap, fainted)

  const crownedTerminationPlacements = new Set(fainted)
  for (const placementId of related) {
    if (!input.touchedPlacementIds.has(placementId)) continue
    const placement = placementById.get(placementId)!
    const key = capabilityHpSheetKey(placement.sheetKind, placement.sheetSlug)
    const original = originalSheets.get(key)
    if (!original) continue
    if (capabilityActorIsFainted(original)) crownedTerminationPlacements.add(placementId)
  }
  const encounter = parseEncounterState(nextMap.encounterState ?? createEmptyEncounterState())
  const reconciledEncounter = removeCrownedCapabilityModesForFaintedPlacements(
    encounter,
    crownedTerminationPlacements,
  )
  if (!sameJsonValue(encounter, reconciledEncounter)) {
    nextMap = { ...nextMap, encounterState: reconciledEncounter }
  }

  return Object.freeze({
    nextMap: deepCloneJson(nextMap),
    sheets: new Map([...projectedSheets].map(([key, snapshot]) => [key, Object.freeze({
      ...snapshot,
      sheet: deepCloneJson(snapshot.sheet),
    })])),
    changedSheetKeys: new Set(changedSheetKeys),
    consultedSheetKeys: new Set(consultedSheetKeys),
    relatedPlacementIds: new Set(related),
    faintedPlacementIds: new Set(fainted),
  })
}
