import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseCapabilityRuntimeState, type CapabilityModeState } from '#shared/capabilityAutomation/state'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'

export interface ZygardeAssemblyRecord extends Record<string, unknown> {
  readonly actorPlacementId: string
  readonly actorSheetSlug?: string
  readonly trainerSlug: string
  readonly cellCount: number
  readonly form: string
  readonly powerConstruct: boolean
  readonly disassemblable: boolean
  readonly sourceOperationId?: string
}

const rawAssemblyRecords = (map: TabletopMap): readonly Record<string, unknown>[] => (
  Array.isArray(map.metadata?.capabilityZygardeAssemblies)
    ? map.metadata.capabilityZygardeAssemblies.flatMap(raw => (
        raw && typeof raw === 'object' && !Array.isArray(raw) ? [raw as Record<string, unknown>] : []
      ))
    : []
)

export const zygardeAssemblyMatchesPlacement = (
  state: Record<string, unknown>,
  placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>,
): boolean => placement.sheetKind === 'pokemon' && (
  typeof state.actorSheetSlug === 'string'
    ? state.actorSheetSlug === placement.sheetSlug
    : state.actorPlacementId === placement.id
)

export const zygardeAssemblyRecordsForPlacement = (
  map: TabletopMap,
  placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>,
): readonly Record<string, unknown>[] => rawAssemblyRecords(map)
  .filter(state => zygardeAssemblyMatchesPlacement(state, placement))

export const zygardeAssemblyRecordForPlacement = (
  map: TabletopMap,
  placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>,
): Record<string, unknown> | null => {
  const matches = zygardeAssemblyRecordsForPlacement(map, placement)
  return matches.length === 1 ? matches[0]! : null
}

/** Rebinds durable sheet-owned assembly authority to a newly sent-out placement. */
export const rebindZygardeAssemblyOnPresence = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly now: number
  readonly operationId: string
}): TabletopMap => {
  const matches = zygardeAssemblyRecordsForPlacement(input.map, input.placement)
  if (matches.length === 0) return input.map
  if (matches.length !== 1) throw new Error(`Zygarde sheet ${input.placement.sheetSlug} has ambiguous assembly authority.`)
  const state = matches[0]!
  const form = state.form
  if (form !== '10-percent' && form !== '50-percent') {
    throw new Error(`Zygarde sheet ${input.placement.sheetSlug} has malformed assembly Forme authority.`)
  }
  const source = resolveEffectiveCapabilities({
    map: input.map,
    placement: input.placement,
    sheet: input.sheet,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
  }).instances.find(instance => instance.effective && instance.canonicalId === 'Zygarde Cells')
  if (!source) throw new Error(`Zygarde sheet ${input.placement.sheetSlug} has no effective Zygarde Cells source.`)

  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const sourceOperationId = typeof state.sourceOperationId === 'string' && state.sourceOperationId
    ? state.sourceOperationId : input.operationId
  const mode: CapabilityModeState = {
    id: `capability.mode.${input.placement.id}.zygarde-form`,
    actorPlacementId: input.placement.id,
    capabilityInstanceId: source.instanceId,
    canonicalId: source.canonicalId,
    mode: 'zygarde-form',
    description: form,
    configurationId: state.powerConstruct === true ? 'power-construct' : 'aura-break',
    activatedAt: input.now,
    expiresAt: null,
    sourceOperationId,
  }
  const capabilityRuntime = parseCapabilityRuntimeState({
    ...encounter.capabilityRuntime,
    modes: [
      ...encounter.capabilityRuntime!.modes.filter(entry => !(
        entry.actorPlacementId === input.placement.id && entry.mode === 'zygarde-form'
      )),
      mode,
    ],
  })
  return {
    ...input.map,
    encounterState: parseEncounterState({ ...encounter, capabilityRuntime }),
    metadata: {
      ...(input.map.metadata ?? {}),
      capabilityZygardeAssemblies: rawAssemblyRecords(input.map).map(candidate => (
        candidate === state
          ? { ...candidate, actorPlacementId: input.placement.id, actorSheetSlug: input.placement.sheetSlug }
          : candidate
      )),
    },
  }
}
