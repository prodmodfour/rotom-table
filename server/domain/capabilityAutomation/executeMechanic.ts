import { createHash } from 'node:crypto'
import type {
  CapabilityActionPublicResult,
  CapabilityProducedResource,
  CapabilityServerRoll,
  ExecuteCapabilityActionCommand,
} from '#shared/capabilityAutomation/clientCommands'
import {
  CAPABILITY_FORTUNE_ROAM_DURATION_MS,
  createEmptyCapabilityRuntimeState,
  parseCapabilityRuntimeState,
  type CapabilityAlluringLureTaskState,
  type CapabilityFortuneRoamTaskState,
  type CapabilityLinkKind,
  type CapabilityLinkState,
  type CapabilityModeKind,
  type CapabilityModeState,
  type CapabilityRuntimeState,
} from '#shared/capabilityAutomation/state'
import type { CapabilityRuntimeActionSpec } from '#shared/capabilityAutomation/spec'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseMapGroundItem } from '#shared/moveAutomation/groundItems'
import { normalizeRevision } from '#shared/sessionRevisions'
import {
  createEncounterTurnResourceLedger,
  parseEncounterTurnResources,
} from '#shared/moveAutomation/encounterResources'
import type { EncounterEffect, EncounterNumericModifierEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet, CharacterSheetAppliedMove, CharacterSheetMove } from '~/types/characterSheet'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet, InventoryEntry } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { findItem, findMove, letterPressHiddenPowerMoveName } from '~~/data/ptuReference'
import pokedexData from '~~/data/reference/pokedex.json'
import type { PokedexRecord } from '~/types/pokemon'
import { placementToSpawned } from '~/utils/placement'
import { canPlacePokemon } from '~/utils/gridPlacement'
import { getClearanceValue } from '~/utils/gridGeometry'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import { buildVoxelOccupancy } from '~/utils/voxelOccupancy'
import { moveAutomationUserAccuracy, resolveMoveAutomationTargetEvasion } from '~/utils/moveAutomationAccuracy'
import {
  createEmptyCapabilityCampaignState,
  juicerHeldItemIsLegacyShellMirror,
  parseCapabilityCampaignState,
} from '#shared/capabilityAutomation/campaignState'
import { computePokemonTutorPointsEarnedForSheet } from '~/utils/sheets/pokemonTutorPoints'
import { resolveCapabilityPowerLoad } from '#shared/capabilityAutomation/power'
import { resolveCapabilities, resolveSkills } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import {
  resolveAuthoritativeDisplacement,
  resolveAuthoritativeRelocation,
  resolveMovement,
} from '../movement/resolveMovement'
import { applyAuthoritativeMovementMapTransition } from '../movement/applyMovementTransition'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import {
  CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATION_MESSAGE,
  capabilityActionDelegatesToCampaignAggregate,
} from './campaignAggregateDelegation'
import { capabilityLinkedMovementPlacementIds } from './linkedMovement'
import { resolveCapabilityJumpPlan } from './validateSelections'
import {
  recordTeleporterRoundUse,
  teleporterRoundIdentity,
} from './teleporterRoundUse'
import { removeCapabilityPresenceGroup } from './presenceLifecycle'
import { CAPABILITY_ALLURING_NEXT_TURN_STANDARD_FLAG_ID } from '../moveAutomation/reduceEncounterResources'
import { resolveItemFormChangeMegaRingSource } from '../itemAutomation/formChanges'
import { hasPokemonCapabilityEdge } from '#shared/capabilityAutomation/pokemonEdges'
import {
  juicerShellItemName,
  canonicalPtuBerryName,
} from '#shared/capabilityAutomation/items'
import {
  juicerShellJuice,
  juicerShellOutput,
  materializeJuicerSheetAtTime,
  withJuicerShellJuiceSnack,
} from './juicer'
import {
  mapWithCapabilityGlowLight,
  relocateCapabilityGlowLights,
} from './glow'
import { parseTrackerScentSelection } from '#shared/capabilityAutomation/tracker'
import {
  zygardeAssemblyMatchesPlacement,
  zygardeAssemblyRecordForPlacement,
} from './zygardeAssembly'
import {
  clearPhysicalPowerLoadAttachment,
  clearPhysicalPowerLoadsForPlacements,
  isPhysicalPowerLoadObject,
  physicalPowerLoadAttachment,
  physicalPowerMovementLimit,
  physicalPowerSourceValues,
  projectPhysicalPowerLoadToken,
  relocateCapabilityAttachedObjects,
} from './physicalPower'

const canonicalCapabilityItemName = (value: string): string | null => (
  findItem(value)?.name ?? canonicalPtuBerryName(value)
)

const canonicalCapabilityItemId = (value: string): string => value.normalize('NFKD')
  .toLocaleLowerCase('en-US').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160)
const capabilityGroundOperationId = (operationId: string): string => `op_capability_${createHash('sha256')
  .update(operationId).digest('hex').slice(0, 32)}`

export interface CapabilityMechanicSheetMutation {
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly previous: CharacterSheet | TrainerSheet | null
  readonly current: CharacterSheet | TrainerSheet
}

export interface CapabilityMechanicExecution {
  readonly map: TabletopMap
  readonly sheetMutations: readonly CapabilityMechanicSheetMutation[]
  readonly rolls: readonly CapabilityServerRoll[]
  readonly produced: readonly CapabilityProducedResource[]
  readonly outcome: CapabilityActionPublicResult['outcome']
  readonly reasonCode: string
  readonly adjudicationNote: string | null
}

export interface ExecuteCapabilityMechanicInput {
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  /** Authorization/economy owner when a source-owned action is canonically delegated. */
  readonly actingPlacement?: SheetPlacement
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly linkedTrainerSlugs: ReadonlySet<string>
  readonly command: ExecuteCapabilityActionCommand
  readonly action: CapabilityRuntimeActionSpec
  readonly now: number
  readonly rollDie: (rollId: string, sides: number, count?: number) => CapabilityServerRoll
}

const modeByAction: Readonly<Record<string, CapabilityModeKind>> = Object.freeze({
  'emit-light': 'glowing',
  'create-illusion': 'illusion',
  'inflate': 'inflated',
  'become-invisible': 'invisible',
  'become-intangible': 'intangible',
  'meld': 'shadow-melded',
  'change-shape': 'shapechanged',
  'shrink': 'shrunken',
  'assume-crowned-form': 'crowned',
  'enter-machine': 'inside-machine',
  'change-zygarde-form': 'zygarde-form',
  'mega-evolve': 'mega-evolved',
})
const removeModeByAction: Readonly<Record<string, CapabilityModeKind>> = Object.freeze({
  'stop-light': 'glowing',
  'dismiss-illusion': 'illusion',
  'deflate': 'inflated',
  'become-visible': 'invisible',
  'become-tangible': 'intangible',
  'reform': 'shadow-melded',
  'restore-shape': 'shapechanged',
  'restore-size': 'shrunken',
  'relinquish-crowned-form': 'crowned',
  'exit-machine': 'inside-machine',
})
const linkByAction: Readonly<Record<string, CapabilityLinkKind>> = Object.freeze({
  'mount': 'as-one-mount',
  'accept-rider': 'mount-rider',
  'engage-wielder': 'living-weapon',
  'bond': 'viral-fusion',
  'combine-unown': 'letter-press',
  'assemble-zygarde': 'zygarde-assembly',
  'ride-shadow': 'shadow-rider',
  'shelter-baby': 'marsupial-pouch',
})
const removeLinkByAction: Readonly<Record<string, CapabilityLinkKind>> = Object.freeze({
  'dismount': 'as-one-mount',
  'release-rider': 'mount-rider',
  'disengage-wielder': 'living-weapon',
  'release-bond': 'viral-fusion',
  'disassemble-zygarde': 'zygarde-assembly',
  'leave-shadow': 'shadow-rider',
})

const modeEffectId = (actorPlacementId: string, mode: CapabilityModeKind): string => (
  `capability.mode.${actorPlacementId}.${mode}`.replace(/[^A-Za-z0-9._:/-]/g, '-')
)

const modeStateId = (
  actorPlacementId: string,
  mode: CapabilityModeKind,
  capabilityInstanceId: string,
): string => mode === 'glowing'
  ? `${modeEffectId(actorPlacementId, mode)}.${createHash('sha256')
      .update(capabilityInstanceId)
      .digest('hex')
      .slice(0, 24)}`
  : modeEffectId(actorPlacementId, mode)

const numericModeModifier: Readonly<Partial<Record<CapabilityModeKind, number>>> = Object.freeze({
  blended: 2,
  inflated: -1,
  invisible: 4,
  'shadow-melded': 1,
  shrunken: 4,
})

const capabilityModeMarkerEffect = (input: {
  readonly actorPlacementId: string
  readonly canonicalId: string
  readonly operationId: string
  readonly mode: CapabilityModeKind
  readonly map: TabletopMap
}): EncounterEffect => ({
  id: modeEffectId(input.actorPlacementId, input.mode),
  kind: 'capability',
  source: {
    operationId: input.operationId,
    moveId: `capability.${input.canonicalId.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')}`,
    placementId: input.actorPlacementId,
  },
  affected: { placementIds: [input.actorPlacementId], sideIds: [], cells: [] },
  createdRound: Math.max(1, input.map.encounterState?.history.currentRound ?? input.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'permanent', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['capability-mode', `capability-mode.${input.mode}`],
  payload: {
    capabilityId: `runtime-mode.${input.canonicalId.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')}`,
    action: 'grant',
  },
  dispel: { policy: 'none', tags: [] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const numericModeEffect = (input: {
  readonly actorPlacementId: string
  readonly canonicalId: string
  readonly operationId: string
  readonly mode: CapabilityModeKind
  readonly value: number
  readonly map: TabletopMap
}): EncounterNumericModifierEffect => ({
  id: modeEffectId(input.actorPlacementId, input.mode),
  kind: 'numeric-modifier',
  source: {
    operationId: input.operationId,
    moveId: `capability.${input.canonicalId.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')}`,
    placementId: input.actorPlacementId,
  },
  affected: { placementIds: [input.actorPlacementId], sideIds: [], cells: [] },
  createdRound: Math.max(1, input.map.encounterState?.history.currentRound ?? input.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'permanent', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['capability-mode', `capability-mode.${input.mode}`],
  payload: { attribute: 'evasion', operation: 'add', value: input.value, rounding: 'none' },
  dispel: { policy: 'none', tags: [] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const runtimeFor = (map: TabletopMap): CapabilityRuntimeState => parseCapabilityRuntimeState(
  map.encounterState?.capabilityRuntime ?? createEmptyCapabilityRuntimeState(),
)

const readyLivingWeaponLightShield = (input: ExecuteCapabilityMechanicInput): TabletopMap => {
  const wielder = input.actingPlacement ?? input.actorPlacement
  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const effectKey = `${input.actorPlacement.id}:${wielder.id}`.replace(/[^A-Za-z0-9._:/-]/g, '-')
  const tag = 'capability.living-weapon.light-shield'
  const createdRound = Math.max(1, encounter.history.currentRound ?? input.map.initiative?.round ?? 1)
  const createdTurn = Math.max(0, encounter.history.currentTurn?.turn ?? 0)
  const duration = { kind: 'turns' as const, subject: 'target' as const, boundary: 'end' as const, remaining: 2 }
  const base = {
    source: {
      operationId: input.command.operationId,
      moveId: 'capability.living-weapon.light-shield',
      placementId: input.actorPlacement.id,
    },
    affected: { placementIds: [wielder.id], sideIds: [], cells: [] },
    createdRound,
    createdTurn,
    duration,
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'replace' as const, maxStacks: null },
    chargePolicy: { kind: 'none' as const, amount: null },
    tags: ['capability', tag],
    dispel: { policy: 'none' as const, tags: [] },
    transferPolicy: 'expire' as const,
    suppression: { sources: [] },
  }
  const effects: EncounterEffect[] = [
    {
      ...base,
      id: `capability.living-weapon.light-shield.evasion:${effectKey}`,
      kind: 'numeric-modifier',
      payload: { attribute: 'evasion', operation: 'add', value: 2, rounding: 'none' },
    },
    {
      ...base,
      id: `capability.living-weapon.light-shield.dr:${effectKey}`,
      kind: 'numeric-modifier',
      payload: { attribute: 'damage-reduction', operation: 'add', value: 10, rounding: 'none' },
    },
    {
      ...base,
      id: `capability.living-weapon.light-shield.slowed:${effectKey}`,
      kind: 'condition',
      payload: { conditionId: 'slowed', action: 'apply', saveTiming: null },
    },
  ]
  return mapWithRuntimeAndEffects(
    input.map,
    runtimeFor(input.map),
    [...encounter.effects.filter(effect => !effect.tags.includes(tag)
      || effect.source.placementId !== input.actorPlacement.id
      || !effect.affected.placementIds.includes(wielder.id)), ...effects],
  )
}

const mapWithCapabilityLinkedMovement = (
  input: ExecuteCapabilityMechanicInput,
  map: TabletopMap,
  movedPlacementId: string,
  destination: { readonly x: number; readonly y: number; readonly z: number },
): TabletopMap => {
  const movingPlacementIds = new Set([
    movedPlacementId,
    ...capabilityLinkedMovementPlacementIds(input, movedPlacementId),
  ])
  let relocated = relocateCapabilityAttachedObjects({
    ...map,
    placements: map.placements.map(placement => (
      movingPlacementIds.has(placement.id)
        ? { ...placement, position: { ...destination } }
        : placement
    )),
  }, new Map([...movingPlacementIds].map(placementId => [placementId, destination])))
  relocated = {
    ...relocated,
    lights: relocateCapabilityGlowLights({
      lights: relocated.lights,
      placementIds: movingPlacementIds,
      destination,
    }),
  }
  return relocated
}

const mapWithPrivateNotice = (input: {
  readonly map: TabletopMap
  readonly operationId: string
  readonly canonicalId: string
  readonly actionId: string
  readonly label: string
  readonly summary: string
  readonly sourcePlacementId: string
  readonly revealToPlacementIds: readonly string[]
  readonly createdAt: number
  readonly noticeIdSuffix?: string
}): TabletopMap => {
  const notices = Array.isArray(input.map.metadata?.capabilityPrivateNotices)
    ? input.map.metadata.capabilityPrivateNotices as unknown[] : []
  const viewers = [...new Set(input.revealToPlacementIds)]
    .filter(id => input.map.placements.some(placement => placement.id === id))
    .slice(0, 32)
  if (!viewers.length) throw new Error('Private Capability notice requires an authoritative recipient.')
  const summary = input.summary.trim()
  if (!summary || summary.length > 500) throw new Error('Private Capability notice summary must be 1–500 trimmed characters.')
  const noticeId = `capability-notice:${input.operationId}${input.noticeIdSuffix ? `:${input.noticeIdSuffix}` : ''}`
  return {
    ...input.map,
    metadata: {
      ...(input.map.metadata ?? {}),
      capabilityPrivateNotices: [...notices.filter(raw => (
        (raw as Record<string, unknown>)?.id !== noticeId
      )).slice(-255), {
        id: noticeId,
        canonicalId: input.canonicalId,
        actionId: input.actionId,
        label: input.label.slice(0, 120),
        summary,
        sourcePlacementId: input.sourcePlacementId,
        revealToPlacementIds: viewers,
        createdAt: input.createdAt,
        sourceOperationId: input.operationId,
      }],
    },
  }
}

const mapWithRuntimeAndEffects = (
  map: TabletopMap,
  runtime: CapabilityRuntimeState,
  effects: readonly EncounterEffect[],
): TabletopMap => {
  const encounter = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  return {
    ...map,
    encounterState: parseEncounterState({ ...encounter, capabilityRuntime: runtime, effects }),
  }
}

const descriptionForMode = (input: ExecuteCapabilityMechanicInput, mode: CapabilityModeKind): string | null => {
  if (mode === 'illusion' || mode === 'shapechanged') {
    const description = input.command.selections.description?.trim() ?? ''
    if (!description) throw new Error(`${mode} requires a bounded description.`)
    return description
  }
  if (mode === 'inside-machine') {
    const deviceId = input.command.selections.optionId?.trim() ?? ''
    if (!deviceId) throw new Error('Wired machine entry requires an authoritative device ID.')
    return input.command.selections.description?.trim() || null
  }
  if (mode === 'zygarde-form') {
    const form = input.command.selections.optionId
    if (form !== '10-percent' && form !== '50-percent') throw new Error('Zygarde form must be 10-percent or 50-percent.')
    return form
  }
  return null
}

const applyToggle = (input: ExecuteCapabilityMechanicInput): TabletopMap => {
  let runtime = runtimeFor(input.map)
  let effects = [...(input.map.encounterState?.effects ?? [])]
  if (input.command.actionId === 'blend') {
    const mode: CapabilityModeKind = 'blended'
    const id = modeEffectId(input.actorPlacement.id, mode)
    runtime = parseCapabilityRuntimeState({
      ...runtime,
      modes: [
        ...runtime.modes.filter(entry => !(entry.actorPlacementId === input.actorPlacement.id && entry.mode === mode)),
        {
          id,
          actorPlacementId: input.actorPlacement.id,
          capabilityInstanceId: input.command.capabilityInstanceId,
          canonicalId: input.command.canonicalId,
          mode,
          description: null,
          configurationId: null,
          activatedAt: input.now,
          expiresAt: null,
          sourceOperationId: input.command.operationId,
        },
      ],
    })
    effects = effects.filter(effect => effect.id !== id)
    effects.push({
      ...numericModeEffect({
        actorPlacementId: input.actorPlacement.id,
        canonicalId: input.command.canonicalId,
        operationId: input.command.operationId,
        mode,
        value: 2,
        map: input.map,
      }),
      // Activation occurs during the user's current turn; two matching end
      // boundaries retain Blender through the end of the following turn.
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
    })
    return mapWithRuntimeAndEffects(input.map, runtime, effects)
  }
  const addedMode = modeByAction[input.command.actionId]
  const removedMode = removeModeByAction[input.command.actionId]
  if (!addedMode && !removedMode) throw new Error(`Unsupported toggle action ${input.command.actionId}.`)
  if (addedMode) {
    const description = descriptionForMode(input, addedMode)
    const id = modeStateId(
      input.actorPlacement.id,
      addedMode,
      input.command.capabilityInstanceId,
    )
    const extendedInvisibility = addedMode === 'invisible'
      && input.actorPlacement.sheetKind === 'pokemon'
      && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'Extended Invisibility')
    const expiresAt = addedMode === 'invisible'
      ? input.now + (extendedInvisibility ? 8 : 4) * 60_000 : null
    const acquisitionSourceIds = addedMode === 'glowing'
      ? resolveEffectiveCapabilities({
          map: input.map,
          placement: input.actorPlacement,
          sheet: input.actorSheet,
          sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
        }).instances.find(instance => (
          instance.instanceId === input.command.capabilityInstanceId
          && instance.canonicalId === input.command.canonicalId
          && instance.effective
        ))?.sources.map(source => source.sourceId)
      : undefined
    if (addedMode === 'glowing' && (!acquisitionSourceIds || acquisitionSourceIds.length === 0)) {
      throw new Error('Glow has no exact effective acquisition source.')
    }
    const mode: CapabilityModeState = {
      id,
      actorPlacementId: input.actorPlacement.id,
      capabilityInstanceId: input.command.capabilityInstanceId,
      canonicalId: input.command.canonicalId,
      mode: addedMode,
      description,
      configurationId: addedMode === 'mega-evolved'
        ? `trainer:${input.command.selections.recipientTrainerSlug};ability:${input.command.selections.optionId ?? 'Run Away'}`
        : input.command.selections.optionId,
      ...(acquisitionSourceIds ? { acquisitionSourceIds } : {}),
      activatedAt: input.now,
      expiresAt,
      sourceOperationId: input.command.operationId,
    }
    runtime = parseCapabilityRuntimeState({
      ...runtime,
      modes: [
        ...runtime.modes.filter(entry => !(
          entry.actorPlacementId === input.actorPlacement.id
          && entry.mode === addedMode
          && (addedMode !== 'glowing'
            || entry.capabilityInstanceId === input.command.capabilityInstanceId)
        )),
        mode,
      ],
    })
    const numeric = numericModeModifier[addedMode]
    if (addedMode === 'intangible') {
      effects = effects.filter(effect => effect.id !== id)
      effects.push(capabilityModeMarkerEffect({
        actorPlacementId: input.actorPlacement.id,
        canonicalId: input.command.canonicalId,
        operationId: input.command.operationId,
        mode: addedMode,
        map: input.map,
      }))
    }
    else if (numeric !== undefined) {
      effects = effects.filter(effect => effect.id !== id)
      effects.push(numericModeEffect({
        actorPlacementId: input.actorPlacement.id,
        canonicalId: input.command.canonicalId,
        operationId: input.command.operationId,
        mode: addedMode,
        value: numeric,
        map: input.map,
      }))
    }
  }
  if (removedMode) {
    runtime = parseCapabilityRuntimeState({
      ...runtime,
      modes: runtime.modes.filter(entry => !(
        entry.actorPlacementId === input.actorPlacement.id
        && entry.mode === removedMode
        && (removedMode !== 'glowing'
          || entry.capabilityInstanceId === input.command.capabilityInstanceId)
      )),
    })
    effects = effects.filter(effect => effect.id !== modeEffectId(input.actorPlacement.id, removedMode))
  }
  let nextMap = mapWithRuntimeAndEffects(input.map, runtime, effects)
  if (addedMode === 'zygarde-form') {
    const state = zygardeAssemblyRecordForPlacement(input.map, input.actorPlacement)
    if (!state) throw new Error('This Zygarde has no unambiguous authoritative assembly state.')
    const states = Array.isArray(input.map.metadata?.capabilityZygardeAssemblies)
      ? input.map.metadata.capabilityZygardeAssemblies as unknown[] : []
    nextMap = {
      ...nextMap,
      metadata: {
        ...(nextMap.metadata ?? {}),
        capabilityZygardeAssemblies: states.map(raw => {
          const candidate = raw as Record<string, unknown>
          return candidate === state
            ? {
                ...candidate,
                actorPlacementId: input.actorPlacement.id,
                actorSheetSlug: input.actorPlacement.sheetSlug,
                form: input.command.selections.optionId,
              }
            : raw
        }),
      },
    }
  }
  if (addedMode === 'glowing') {
    nextMap = mapWithCapabilityGlowLight({
      map: nextMap,
      placementId: input.actorPlacement.id,
      active: true,
    })
  }
  if (removedMode === 'glowing') {
    nextMap = mapWithCapabilityGlowLight({
      map: nextMap,
      placementId: input.actorPlacement.id,
      active: runtime.modes.some(entry => (
        entry.actorPlacementId === input.actorPlacement.id && entry.mode === 'glowing'
      )),
    })
  }
  if (addedMode === 'illusion') {
    const cell = input.command.selections.cells[0]
    if (!cell) throw new Error('Illusionist requires one authoritative illusion cell.')
    const previousIllusions = Array.isArray(input.map.metadata?.capabilityIllusions)
      ? input.map.metadata.capabilityIllusions as unknown[] : []
    nextMap = {
      ...nextMap,
      metadata: {
        ...(nextMap.metadata ?? {}),
        capabilityIllusions: [
          ...previousIllusions.filter(raw => (raw as Record<string, unknown>)?.ownerPlacementId !== input.actorPlacement.id),
          {
            id: `capability-illusion:${input.actorPlacement.id}`,
            ownerPlacementId: input.actorPlacement.id,
            position: { ...cell },
            parameters: input.command.selections.optionId,
            description: input.command.selections.description,
            sourceOperationId: input.command.operationId,
          },
        ],
      },
    }
  }
  if (removedMode === 'illusion') {
    nextMap = {
      ...nextMap,
      metadata: {
        ...(nextMap.metadata ?? {}),
        capabilityIllusions: (Array.isArray(nextMap.metadata?.capabilityIllusions)
          ? nextMap.metadata.capabilityIllusions as unknown[] : [])
          .filter(raw => (raw as Record<string, unknown>)?.ownerPlacementId !== input.actorPlacement.id),
      },
    }
  }
  if (addedMode === 'mega-evolved') {
    const trainerSlug = input.command.selections.recipientTrainerSlug
    if (!trainerSlug || !input.map.activeScene || !Number.isSafeInteger(input.map.activeScene.startedAt)) {
      throw new Error('Delta Evolution requires retained Mega Ring and Scene identities.')
    }
    const trainer = input.trainerSheets.get(trainerSlug)
    if (!trainer) throw new Error('Delta Evolution linked Trainer authority is unavailable.')
    const ringSource = resolveItemFormChangeMegaRingSource({
      map: input.map,
      trainerSheet: trainer,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    })
    const uses = Array.isArray(input.map.metadata?.capabilityMegaEvolutionUses)
      ? input.map.metadata.capabilityMegaEvolutionUses as unknown[] : []
    nextMap = {
      ...nextMap,
      metadata: {
        ...(nextMap.metadata ?? {}),
        capabilityMegaEvolutionUses: [...uses.slice(-127), {
          trainerSlug,
          actorPlacementId: input.actorPlacement.id,
          sceneStartedAt: input.map.activeScene.startedAt,
          sourceOperationId: input.command.operationId,
          ringInstanceId: ringSource.instanceId,
          ringInstanceRevision: ringSource.instanceRevision,
        }],
      },
    }
  }
  if (addedMode === 'inside-machine') {
    const deviceCell = input.command.selections.cells[0]
    if (!deviceCell) throw new Error('Wired machine entry requires one authoritative device cell.')
    nextMap = mapWithCapabilityLinkedMovement(input, nextMap, input.actorPlacement.id, deviceCell)
  }
  if (removedMode === 'inside-machine') {
    const destination = input.command.selections.cells[0]
    if (!destination) throw new Error('Wired machine exit requires one connected destination cell.')
    const relocation = resolveAuthoritativeRelocation({
      map: nextMap,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
      placementId: input.actorPlacement.id,
      now: input.now,
      mode: 'teleport',
      destination,
      ignoredPlacementIds: capabilityLinkedMovementPlacementIds(input, input.actorPlacement.id),
    })
    if (!relocation.ok) throw new Error(relocation.message)
    return applyAuthoritativeMovementMapTransition({
      map: nextMap,
      placementId: input.actorPlacement.id,
      destination: relocation.destination,
      distance: relocation.distance,
      encounterState: parseEncounterState(nextMap.encounterState ?? createEmptyEncounterState()),
      timestamp: input.now,
      userName: input.command.canonicalId,
      linkedCompanionPlacementIds: capabilityLinkedMovementPlacementIds(input, input.actorPlacement.id),
      movementEvidence: {
        operationId: input.command.operationId,
        path: relocation.path,
        mode: 'teleport',
      },
    }).nextMap
  }
  return nextMap
}

const executeLetterPress = (input: ExecuteCapabilityMechanicInput): CapabilityMechanicExecution => {
  if (input.actorPlacement.sheetKind !== 'pokemon') throw new Error('Letter Press requires a Pokémon actor.')
  const previous = input.actorSheet as CharacterSheet
  const targetIds = input.command.selections.targetPlacementIds
  const targets = targetIds.map((id) => {
    const placement = input.map.placements.find(candidate => candidate.id === id)
    const sheet = placement?.sheetKind === 'pokemon' ? input.pokemonSheets.get(placement.sheetSlug) : null
    if (!placement || !sheet || sheet.species.trim().toLocaleLowerCase('en-US') !== 'unown') throw new Error('A Letter Press Unown target disappeared.')
    return { placement, sheet }
  })
  const match = /^stats:(none|(?:hp|atk|def|satk|sdef|spd)(?:,(?:hp|atk|def|satk|sdef|spd)){0,3});hidden-power:(none|(?:(?:attack|special)(?:,(?:attack|special)){0,5}))$/.exec(input.command.selections.optionId ?? '')
  if (!match) throw new Error('Letter Press retained choices are malformed.')
  const statChoices = match[1] === 'none' ? [] : match[1]!.split(',') as Array<'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd'>
  const hiddenChoices = match[2] === 'none' ? [] : match[2]!.split(',') as Array<'attack' | 'special'>
  const campaign = parseCapabilityCampaignState(previous.capabilityCampaignState ?? createEmptyCapabilityCampaignState())
  const prior = campaign.letterPress
  const statBonuses = { ...(prior?.statBonuses ?? {}) }
  for (const key of statChoices) statBonuses[key] = (statBonuses[key] ?? 0) + 5

  const existingMoves = [...(previous.movelist ?? [])]
  const existingAppliedMoves = [...(previous.appliedMoves ?? [])]
  const candidates: Array<{ readonly slug: string; readonly move: CharacterSheetMove; readonly actor: boolean }> = []
  if (!prior) {
    const actorMove = [...existingMoves, ...existingAppliedMoves].find(move => move.name === 'Hidden Power')
    if (actorMove) candidates.push({ slug: previous.slug, move: actorMove, actor: true })
  }
  for (const target of targets) {
    const move = [...(target.sheet.movelist ?? []), ...(target.sheet.appliedMoves ?? [])].find(candidate => candidate.name === 'Hidden Power')
    if (move) candidates.push({ slug: target.sheet.slug, move, actor: false })
  }
  const retainedHiddenPowers = [...(prior?.hiddenPowers ?? [])]
  let choiceIndex = 0
  for (const candidate of candidates) {
    const choice = hiddenChoices[choiceIndex]
    if (!choice) break
    choiceIndex += 1
    const category = choice === 'attack' ? 'Physical' as const : 'Special' as const
    if (!candidate.actor && existingMoves.length + existingAppliedMoves.length >= 6) break
    retainedHiddenPowers.push({
      sourceSheetSlug: candidate.slug,
      attackStat: choice === 'attack' ? 'attack' : 'special-attack',
    })
    if (candidate.actor) {
      const movelistIndex = existingMoves.findIndex(move => move.name === 'Hidden Power')
      if (movelistIndex >= 0) existingMoves[movelistIndex] = {
        ...existingMoves[movelistIndex]!,
        name: letterPressHiddenPowerMoveName(candidate.slug),
        category,
      }
      else {
        const appliedIndex = existingAppliedMoves.findIndex(move => move.name === 'Hidden Power')
        if (appliedIndex >= 0) existingAppliedMoves[appliedIndex] = {
          ...existingAppliedMoves[appliedIndex]!,
          name: letterPressHiddenPowerMoveName(candidate.slug),
          category,
        }
      }
      continue
    }
    const { permanentMoveSource: _ignoredPermanentSource, ...copied } = candidate.move
    existingMoves.push({
      ...copied,
      name: letterPressHiddenPowerMoveName(candidate.slug),
      category,
      permanentMoveSource: {
        schemaVersion: 1,
        mutation: 'add',
        sourceMoveId: 'capability.letter-press',
        sourcePlacementId: input.actorPlacement.id,
        sourceResolutionId: input.command.operationId,
        sourceOperationId: input.command.operationId,
        acquiredFrom: { kind: 'reviewed-rule' },
        recordedAt: input.now,
      },
    })
  }
  const current: CharacterSheet = {
    ...deepCloneJson(previous),
    nickname: prior ? previous.nickname : `Prime ${previous.nickname}`,
    movelist: existingMoves,
    appliedMoves: existingAppliedMoves,
    capabilityCampaignState: parseCapabilityCampaignState({
      ...campaign,
      letterPress: {
        combinedUnownCount: (prior?.combinedUnownCount ?? 1) + targets.length,
        statBonuses,
        hiddenPowers: retainedHiddenPowers,
        sourceOperationIds: [...(prior?.sourceOperationIds ?? []).slice(-15), input.command.operationId],
      },
    }),
  }
  const runtime = runtimeFor(input.map)
  const existingLink = runtime.links.find(link => link.ownerPlacementId === input.actorPlacement.id && link.kind === 'letter-press')
  const link: CapabilityLinkState = {
    id: `capability.link.${input.actorPlacement.id}.letter-press`,
    kind: 'letter-press',
    ownerPlacementId: input.actorPlacement.id,
    participantPlacementIds: [...(existingLink?.participantPlacementIds ?? []), ...targetIds],
    capabilityInstanceId: input.command.capabilityInstanceId,
    canonicalId: input.command.canonicalId,
    establishedAt: existingLink?.establishedAt ?? input.now,
    configurationId: 'irreversible-prime-unown',
    sourceOperationId: input.command.operationId,
  }
  const nextRuntime = parseCapabilityRuntimeState({
    ...runtime,
    links: [...runtime.links.filter(entry => !(entry.ownerPlacementId === input.actorPlacement.id && entry.kind === 'letter-press')), link],
  })
  const suppressionId = `capability.effect.${input.actorPlacement.id}.letter-press-underdog`
  const effects = [...(input.map.encounterState?.effects ?? [])].filter(effect => effect.id !== suppressionId)
  effects.push({
    id: suppressionId,
    kind: 'capability',
    source: { operationId: input.command.operationId, moveId: 'capability.letter-press', placementId: input.actorPlacement.id },
    affected: { placementIds: [input.actorPlacement.id], sideIds: [], cells: [] },
    createdRound: Math.max(1, input.map.encounterState?.history.currentRound ?? input.map.initiative?.round ?? 1),
    createdTurn: Math.max(0, input.map.encounterState?.history.currentTurn?.turn ?? 0),
    duration: { kind: 'permanent', remaining: null }, stacks: 1, charges: null,
    stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
    tags: ['capability-letter-press', 'capability-suppression'],
    payload: { capabilityId: 'underdog', action: 'suppress' },
    dispel: { policy: 'none', tags: [] }, transferPolicy: 'retain', suppression: { sources: [] },
  })
  const withoutCombinedLoads = clearPhysicalPowerLoadsForPlacements(input.map, new Set(targetIds))
  const map = mapWithRuntimeAndEffects({
    ...withoutCombinedLoads,
    placements: withoutCombinedLoads.placements.filter(placement => !targetIds.includes(placement.id)),
  }, nextRuntime, effects)
  const participantMutations: CapabilityMechanicSheetMutation[] = targets.map(target => ({
    kind: 'pokemon',
    slug: target.sheet.slug,
    previous: target.sheet,
    current: {
      ...deepCloneJson(target.sheet),
      letterPressCombinedInto: { ownerSheetSlug: previous.slug, sourceOperationId: input.command.operationId },
    },
  }))
  const combinedSlugs = new Set(targets.map(target => target.sheet.slug))
  const rosterMutations: CapabilityMechanicSheetMutation[] = [...input.trainerSheets.values()].flatMap((trainer) => {
    const currentTeam = trainer.currentTeam ?? []
    const boxedPokemon = trainer.boxedPokemon ?? []
    if (![...currentTeam, ...boxedPokemon].some(slug => combinedSlugs.has(slug))) return []
    return [{
      kind: 'trainer' as const,
      slug: trainer.slug,
      previous: trainer,
      current: {
        ...deepCloneJson(trainer),
        currentTeam: currentTeam.filter(slug => !combinedSlugs.has(slug)),
        boxedPokemon: boxedPokemon.filter(slug => !combinedSlugs.has(slug)),
      },
    }]
  })
  return {
    map,
    sheetMutations: [{ kind: 'pokemon', slug: previous.slug, previous, current }, ...participantMutations, ...rosterMutations],
    rolls: [], produced: [], outcome: 'applied', reasonCode: 'capability.letter-press.combined',
    adjudicationNote: `${targets.length} Unown permanently joined Prime Unown.`,
  }
}

const executeZygardeAssemblyAction = (input: ExecuteCapabilityMechanicInput): CapabilityMechanicExecution => {
  const runtime = runtimeFor(input.map)
  const rawStates = Array.isArray(input.map.metadata?.capabilityZygardeAssemblies)
    ? input.map.metadata.capabilityZygardeAssemblies as unknown[] : []
  const previousState = zygardeAssemblyRecordForPlacement(input.map, input.actorPlacement)
  if (input.command.actionId === 'disassemble-zygarde') {
    if (!previousState || previousState.disassemblable !== true) throw new Error('This Zygarde assembly cannot be disassembled.')
    const trainerSlug = typeof previousState.trainerSlug === 'string' ? previousState.trainerSlug : ''
    const returnedCells = Number(previousState.cellCount)
    if (!/^[a-z0-9-]{1,120}$/.test(trainerSlug) || (returnedCells !== 10 && returnedCells !== 50)) {
      throw new Error('The retained disassemblable Zygarde assembly state is malformed.')
    }
    const resources = Array.isArray(input.map.metadata?.capabilityZygardeCells)
      ? input.map.metadata.capabilityZygardeCells as unknown[] : []
    let matched = false
    const nextResources = resources.map((raw) => {
      const resource = raw as Record<string, unknown>
      if (resource?.trainerSlug !== trainerSlug) return raw
      matched = true
      return { ...resource, count: Math.max(0, Number(resource.count)) + returnedCells }
    })
    if (!matched) nextResources.push({ trainerSlug, count: returnedCells })
    if (input.actorPlacement.sheetKind !== 'pokemon') throw new Error('Zygarde disassembly requires a Pokémon sheet.')
    const previous = input.actorSheet as CharacterSheet
    const snapshot = previousState.previousSheet as Record<string, unknown> | undefined
    if (!snapshot || !Number.isSafeInteger(snapshot.level) || !Array.isArray(snapshot.abilities)) {
      throw new Error('The retained Zygarde pre-assembly sheet snapshot is malformed.')
    }
    const current: CharacterSheet = {
      ...deepCloneJson(previous),
      level: snapshot.level as number,
      ...(typeof snapshot.nature === 'string' ? { nature: snapshot.nature } : { nature: undefined }),
      abilities: deepCloneJson(snapshot.abilities) as CharacterSheet['abilities'],
      zygardeDisassembledIntoCells: {
        trainerSlug,
        cellCount: returnedCells as 10 | 50,
        sourceOperationId: input.command.operationId,
      },
    }
    const rosterMutations: CapabilityMechanicSheetMutation[] = [...input.trainerSheets.values()].flatMap((trainer) => {
      if (![...(trainer.currentTeam ?? []), ...(trainer.boxedPokemon ?? [])].includes(previous.slug)) return []
      return [{
        kind: 'trainer' as const,
        slug: trainer.slug,
        previous: trainer,
        current: {
          ...deepCloneJson(trainer),
          currentTeam: (trainer.currentTeam ?? []).filter(slug => slug !== previous.slug),
          boxedPokemon: (trainer.boxedPokemon ?? []).filter(slug => slug !== previous.slug),
        },
      }]
    })
    const withoutPresence = removeCapabilityPresenceGroup({
      map: input.map,
      ownerPlacementId: input.actorPlacement.id,
    }).map
    return {
      map: {
        ...withoutPresence,
        metadata: {
          ...(withoutPresence.metadata ?? {}),
          capabilityZygardeCells: nextResources,
          capabilityZygardeAssemblies: rawStates.filter(raw => !zygardeAssemblyMatchesPlacement(
            raw as Record<string, unknown>, input.actorPlacement,
          )),
        },
      },
      sheetMutations: [{ kind: 'pokemon', slug: previous.slug, previous, current }, ...rosterMutations], rolls: [], produced: [{
        kind: 'campaign-resource', canonicalId: 'Zygarde Cell', quantity: returnedCells, recipientSheetSlug: trainerSlug,
      }],
      outcome: 'applied', reasonCode: 'capability.zygarde.disassembled', adjudicationNote: `${returnedCells} Zygarde Cells were returned to ${trainerSlug}.`,
    }
  }

  const match = /^cells:(10|50|100);form:(10-percent|50-percent);nature:([^;]{1,40});level:(\d{1,3})$/.exec(input.command.selections.optionId ?? '')
  if (!match) throw new Error('Zygarde assembly parameters are malformed.')
  if (previousState) throw new Error('This Zygarde already has an authoritative assembly state.')
  const cellCount = Number(match[1])
  const form = match[2]!
  const nature = match[3]!
  const level = Number(match[4])
  const trainerSlug = input.command.selections.recipientTrainerSlug ?? [...input.linkedTrainerSlugs]
    .find(slug => {
      const trainer = input.trainerSheets.get(slug)
      return trainer ? trainerOwnsInventoryItem(trainer, 'Zygarde Cube') : false
    })
  if (!trainerSlug) throw new Error('Zygarde assembly requires a linked Cube owner.')
  const resources = Array.isArray(input.map.metadata?.capabilityZygardeCells)
    ? input.map.metadata.capabilityZygardeCells as unknown[] : []
  let consumed = false
  const nextResources = resources.map((raw) => {
    const resource = raw as Record<string, unknown>
    if (resource?.trainerSlug !== trainerSlug || !Number.isSafeInteger(resource.count) || (resource.count as number) < cellCount) return raw
    consumed = true
    return { ...resource, count: (resource.count as number) - cellCount }
  })
  if (!consumed) throw new Error('Authoritative Zygarde Cell resources are insufficient.')
  const powerConstruct = cellCount === 100
  if (input.actorPlacement.sheetKind !== 'pokemon') throw new Error('Zygarde assembly requires a Pokémon sheet.')
  const previous = input.actorSheet as CharacterSheet
  const assemblyState = {
    id: `capability-zygarde-assembly:${input.command.operationId}`,
    actorPlacementId: input.actorPlacement.id,
    actorSheetSlug: input.actorPlacement.sheetSlug,
    trainerSlug,
    cellCount,
    form,
    powerConstruct,
    disassemblable: !powerConstruct,
    nature,
    level,
    previousSheet: {
      level: previous.level,
      ...(previous.nature ? { nature: previous.nature } : {}),
      abilities: deepCloneJson(previous.abilities ?? []),
    },
    sourceOperationId: input.command.operationId,
  }
  const mode: CapabilityModeState = {
    id: modeEffectId(input.actorPlacement.id, 'zygarde-form'),
    actorPlacementId: input.actorPlacement.id,
    capabilityInstanceId: input.command.capabilityInstanceId,
    canonicalId: input.command.canonicalId,
    mode: 'zygarde-form',
    description: form,
    configurationId: powerConstruct ? 'power-construct' : 'aura-break',
    activatedAt: input.now,
    expiresAt: null,
    sourceOperationId: input.command.operationId,
  }
  const nextRuntime = parseCapabilityRuntimeState({
    ...runtime,
    modes: [...runtime.modes.filter(entry => !(entry.actorPlacementId === input.actorPlacement.id && entry.mode === 'zygarde-form')), mode],
  })
  const abilityName = powerConstruct ? 'Power Construct' : 'Aura Break'
  const current: CharacterSheet = {
    ...deepCloneJson(previous),
    level,
    nature,
    abilities: [
      ...(previous.abilities ?? []).filter(ability => ability.name !== 'Aura Break' && ability.name !== 'Power Construct'),
      { name: abilityName },
    ],
  }
  return {
    map: mapWithRuntimeAndEffects({
      ...input.map,
      metadata: {
        ...(input.map.metadata ?? {}),
        capabilityZygardeCells: nextResources,
        capabilityZygardeAssemblies: [...rawStates, assemblyState],
      },
    }, nextRuntime, input.map.encounterState?.effects ?? []),
    sheetMutations: [{ kind: 'pokemon', slug: previous.slug, previous, current }],
    rolls: [], produced: [], outcome: 'applied', reasonCode: 'capability.zygarde.assembled',
    adjudicationNote: `${cellCount} Cells formed ${form} Zygarde with ${abilityName}, Nature ${nature}, Level ${level}.`,
  }
}

const applyLink = (input: ExecuteCapabilityMechanicInput): TabletopMap => {
  let runtime = runtimeFor(input.map)
  const addKind = linkByAction[input.command.actionId]
  const removeKind = removeLinkByAction[input.command.actionId]
  if (addKind) {
    const requestedParticipants = input.command.selections.targetPlacementIds
    const existing = runtime.links.find(entry => entry.ownerPlacementId === input.actorPlacement.id && entry.kind === addKind)
    const participants = addKind === 'mount-rider'
      ? [...new Set([...(existing?.participantPlacementIds ?? []), ...requestedParticipants])]
      : requestedParticipants
    if (participants.length < 1) throw new Error(`${input.command.actionId} requires at least one target.`)
    participants.forEach(id => {
      if (!input.map.placements.some(placement => placement.id === id) || id === input.actorPlacement.id) {
        throw new Error(`Capability link target ${id} is invalid.`)
      }
    })
    const maximum = addKind === 'letter-press' || addKind === 'zygarde-assembly' || addKind === 'mount-rider' ? 16 : 1
    if (participants.length > maximum) throw new Error(`${input.command.actionId} has too many participants.`)
    const id = `capability.link.${input.actorPlacement.id}.${addKind}`.replace(/[^A-Za-z0-9._:/-]/g, '-')
    const livingWeaponProfile = addKind === 'living-weapon' && input.actorPlacement.sheetKind === 'pokemon'
      ? (() => {
          const species = (input.actorSheet as CharacterSheet).species.trim().toLocaleLowerCase('en-US')
          return species === 'honedge' ? 'small-melee-weapon'
            : species === 'doublade' ? 'paired-small-melee-weapons'
              : species === 'aegislash' ? 'small-melee-weapon-and-light-shield' : null
        })()
      : null
    const link: CapabilityLinkState = {
      id,
      kind: addKind,
      ownerPlacementId: input.actorPlacement.id,
      participantPlacementIds: participants,
      capabilityInstanceId: input.command.capabilityInstanceId,
      canonicalId: input.command.canonicalId,
      establishedAt: existing?.establishedAt ?? input.now,
      configurationId: input.command.selections.optionId ?? livingWeaponProfile ?? input.command.selections.description,
      sourceOperationId: input.command.operationId,
    }
    runtime = parseCapabilityRuntimeState({
      ...runtime,
      links: [...runtime.links.filter(entry => !(entry.ownerPlacementId === input.actorPlacement.id && entry.kind === addKind)), link],
    })
  }
  else if (removeKind) {
    const existing = runtime.links.find(entry => (
      entry.ownerPlacementId === input.actorPlacement.id
      && entry.kind === removeKind
      && entry.capabilityInstanceId === input.command.capabilityInstanceId
    ))
    if (!existing) throw new Error('The exact source-owned Capability link is no longer active.')
    if (input.command.actionId === 'disassemble-zygarde') {
      runtime = parseCapabilityRuntimeState({
        ...runtime,
        links: runtime.links.filter(entry => entry.id !== existing.id),
      })
      return mapWithRuntimeAndEffects(input.map, runtime, input.map.encounterState?.effects ?? [])
    }
    if (input.command.actionId === 'release-rider') {
      const releasedId = input.command.selections.targetPlacementIds[0]
      if (!releasedId || !existing.participantPlacementIds.includes(releasedId)) {
        throw new Error('Mountable release requires one exact linked rider.')
      }
      const remaining = existing.participantPlacementIds.filter(id => id !== releasedId)
      runtime = parseCapabilityRuntimeState({
        ...runtime,
        links: runtime.links.flatMap(entry => entry.id !== existing.id ? [entry]
          : remaining.length ? [{ ...entry, participantPlacementIds: remaining, sourceOperationId: input.command.operationId }] : []),
      })
    }
    else {
      runtime = parseCapabilityRuntimeState({
        ...runtime,
        links: runtime.links.filter(entry => entry.id !== existing.id),
      })
    }
    const participantId = input.command.actionId === 'release-rider'
      ? input.command.selections.targetPlacementIds[0]! : existing.participantPlacementIds[0]!
    const actorMoves = removeKind === 'living-weapon' || removeKind === 'shadow-rider'
    const moverId = actorMoves ? input.actorPlacement.id : participantId
    const stationaryId = actorMoves ? participantId : input.actorPlacement.id
    const destination = input.command.selections.cells[0]
    if (!destination) throw new Error('Capability link release requires one adjacent destination cell.')
    const retainedEffects = removeKind === 'living-weapon'
      ? (input.map.encounterState?.effects ?? []).filter(effect => (
          !effect.tags.includes('capability.living-weapon.light-shield')
          || effect.source.placementId !== input.actorPlacement.id
          || !existing.participantPlacementIds.some(id => effect.affected.placementIds.includes(id))
        ))
      : input.map.encounterState?.effects ?? []
    const map = mapWithRuntimeAndEffects(input.map, runtime, retainedEffects)
    const relocation = resolveAuthoritativeRelocation({
      map,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
      placementId: moverId,
      mode: 'separate',
      destination,
      now: input.now,
      ignoredOriginPlacementIds: [stationaryId],
    })
    if (!relocation.ok) throw new Error(relocation.message)
    return applyAuthoritativeMovementMapTransition({
      map,
      placementId: moverId,
      destination: relocation.destination,
      distance: relocation.distance,
      encounterState: parseEncounterState(map.encounterState ?? createEmptyEncounterState()),
      timestamp: input.now,
      userName: input.command.canonicalId,
      movementEvidence: {
        operationId: input.command.operationId,
        path: relocation.path,
        mode: 'forced',
      },
    }).nextMap
  }
  else throw new Error(`Unsupported link action ${input.command.actionId}.`)
  const linkedMap = mapWithRuntimeAndEffects(input.map, runtime, input.map.encounterState?.effects ?? [])
  if (addKind === 'marsupial-pouch') {
    const babyPlacementId = input.command.selections.targetPlacementIds[0]!
    const share = input.command.selections.optionId === 'experience-share:20' ? 20 : 0
    // A sheltered baby no longer moves independently, so its exact physical
    // load is released at the pre-shelter cell rather than being teleported
    // into the mother's carried presence.
    const unburdenedMap = clearPhysicalPowerLoadsForPlacements(
      linkedMap,
      new Set([babyPlacementId]),
    )
    const previousPouches = Array.isArray(unburdenedMap.metadata?.capabilityMarsupialPouches)
      ? unburdenedMap.metadata.capabilityMarsupialPouches as unknown[] : []
    const shelteredMap: TabletopMap = {
      ...unburdenedMap,
      placements: unburdenedMap.placements.map(placement => placement.id === babyPlacementId
        ? { ...placement, position: { ...input.actorPlacement.position } }
        : placement),
      metadata: {
        ...(unburdenedMap.metadata ?? {}),
        capabilityMarsupialPouches: [
          ...previousPouches.filter(raw => {
            const pouch = raw as Record<string, unknown>
            return pouch?.motherPlacementId !== input.actorPlacement.id
              && pouch?.babyPlacementId !== babyPlacementId
          }),
          {
            motherPlacementId: input.actorPlacement.id,
            babyPlacementId,
            motherSheetSlug: input.actorPlacement.sheetSlug,
            babySheetSlug: unburdenedMap.placements.find(placement => placement.id === babyPlacementId)!.sheetSlug,
            experienceSharePercent: share,
            capabilityInstanceId: input.command.capabilityInstanceId,
            sourceOperationId: input.command.operationId,
          },
        ],
      },
      ...(unburdenedMap.initiative ? {
        initiative: {
          ...unburdenedMap.initiative,
          ...(unburdenedMap.initiative.activeId === babyPlacementId ? { activeId: null } : {}),
          ...(unburdenedMap.initiative.manualOrderIds ? {
            manualOrderIds: unburdenedMap.initiative.manualOrderIds.filter(id => id !== babyPlacementId),
          } : {}),
        },
      } : {}),
    }
    return {
      ...shelteredMap,
      lights: relocateCapabilityGlowLights({
        lights: shelteredMap.lights,
        placementIds: new Set([babyPlacementId]),
        destination: input.actorPlacement.position,
      }),
    }
  }
  if (addKind !== 'living-weapon') return linkedMap
  const wielderId = input.command.selections.targetPlacementIds[0]!
  const encounter = parseEncounterState(linkedMap.encounterState ?? createEmptyEncounterState())
  const round = encounter.history.currentRound ?? linkedMap.initiative?.round ?? null
  const turn = encounter.history.currentTurn?.turn ?? null
  const ownerLedger = encounter.turnResources[input.actorPlacement.id]
    ?? createEncounterTurnResourceLedger({ placementId: input.actorPlacement.id, round, turn })
  const wielderLedger = encounter.turnResources[wielderId]
    ?? createEncounterTurnResourceLedger({ placementId: wielderId, round, turn })
  const sharedSpent = ownerLedger.movement.spent + wielderLedger.movement.spent
  const turnResources = parseEncounterTurnResources({
    ...encounter.turnResources,
    [input.actorPlacement.id]: {
      ...ownerLedger,
      movement: { ...ownerLedger.movement, spent: sharedSpent },
    },
    [wielderId]: {
      ...wielderLedger,
      movement: { ...wielderLedger.movement, spent: sharedSpent },
    },
  })
  return {
    ...linkedMap,
    encounterState: parseEncounterState({ ...encounter, turnResources }),
  }
}

const shapeGround = (input: ExecuteCapabilityMechanicInput): TabletopMap => {
  const rawOption = input.command.selections.optionId ?? ''
  if (!input.command.selections.cells.length) throw new Error('Groundshaper requires cardinally adjacent cells.')
  const validModes = new Set(['rough', 'slow', 'rough-and-slow', 'basic', 'unchanged'])
  const operationByCell = new Map<string, string>()
  if (rawOption.startsWith('per-cell:')) {
    for (const operation of rawOption.slice('per-cell:'.length).split(';')) {
      const match = /^(-?\d+),(-?\d+),(-?\d+)=(rough|slow|rough-and-slow|basic|unchanged)$/.exec(operation)
      if (!match) throw new Error('Groundshaper per-cell terrain operation is malformed.')
      const key = `${Number(match[1])}:${Number(match[2])}:${Number(match[3])}`
      if (operationByCell.has(key)) throw new Error('Groundshaper per-cell terrain operations must be unique.')
      operationByCell.set(key, match[4]!)
    }
  }
  else {
    if (!validModes.has(rawOption)) throw new Error('Groundshaper requires rough, slow, rough-and-slow, basic, or unchanged.')
    for (const cell of input.command.selections.cells) operationByCell.set(`${cell.x}:${cell.y}:${cell.z}`, rawOption)
  }
  const selected = new Set(input.command.selections.cells.map(cell => `${cell.x}:${cell.y}:${cell.z}`))
  if (operationByCell.size !== selected.size || [...operationByCell.keys()].some(key => !selected.has(key))) {
    throw new Error('Groundshaper requires exactly one retained operation for each selected cell.')
  }
  for (const cell of input.command.selections.cells) {
    const cardinal = Math.abs(cell.x - input.actorPlacement.position.x) + Math.abs(cell.z - input.actorPlacement.position.z) === 1
    if (!cardinal || Math.abs(cell.y - input.actorPlacement.position.y) > 1) throw new Error('Groundshaper cells must be cardinally adjacent.')
  }
  let matched = 0
  const voxels = input.map.voxels.map((voxel) => {
    const key = `${voxel.x}:${voxel.y}:${voxel.z}`
    if (!selected.has(key)) return voxel
    matched += 1
    const option = operationByCell.get(key)!
    if (option === 'unchanged') return voxel
    const originalTags = new Set((voxel.tags ?? []).map(tag => tag.toLocaleLowerCase('en-US')))
    if (option === 'basic' && !originalTags.has('rough') && !originalTags.has('rough-terrain')) {
      throw new Error('Groundshaper may create Basic Terrain only by flattening authoritative Rough Terrain.')
    }
    const tags = new Set((voxel.tags ?? []).filter(tag => (
      !['rough', 'rough-terrain', 'slow', 'slow-terrain', 'basic-terrain'].includes(tag.toLocaleLowerCase('en-US'))
    )))
    if (option === 'basic') tags.add('basic-terrain')
    if (option === 'rough' || option === 'rough-and-slow') tags.add('rough-terrain')
    if (option === 'slow' || option === 'rough-and-slow') tags.add('slow-terrain')
    return { ...voxel, tags: [...tags] }
  })
  if (matched !== selected.size) throw new Error('Every Groundshaper cell must identify authoritative terrain.')
  return { ...input.map, voxels }
}

const repositionIllusion = (input: ExecuteCapabilityMechanicInput): TabletopMap => {
  const destination = input.command.selections.cells[0]
  if (!destination) throw new Error('Moving Illusion requires one authoritative destination cell.')
  const mode = runtimeFor(input.map).modes.find(entry => (
    entry.actorPlacementId === input.actorPlacement.id
    && entry.capabilityInstanceId === input.command.capabilityInstanceId
    && entry.canonicalId === input.command.canonicalId
    && entry.mode === 'illusion'
    && (entry.expiresAt === null || entry.expiresAt > input.now)
    && /(?:^|;)motion:(?:minor|major)$/.test(entry.configurationId ?? '')
  ))
  if (!mode) throw new Error('The exact source-owned moving Illusion is unavailable.')
  const illusions = Array.isArray(input.map.metadata?.capabilityIllusions)
    ? input.map.metadata.capabilityIllusions as unknown[] : []
  let matched = false
  const nextIllusions = illusions.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || (raw as Record<string, unknown>).ownerPlacementId !== input.actorPlacement.id
      || (raw as Record<string, unknown>).sourceOperationId !== mode.sourceOperationId
      || (raw as Record<string, unknown>).parameters !== mode.configurationId) return raw
    matched = true
    return {
      ...(raw as Record<string, unknown>),
      position: { ...destination },
      lastCapabilityOperationId: input.command.operationId,
    }
  })
  if (!matched) throw new Error('The source-owned moving Illusion is unavailable.')
  return {
    ...input.map,
    metadata: { ...(input.map.metadata ?? {}), capabilityIllusions: nextIllusions },
  }
}

const relocate = (input: ExecuteCapabilityMechanicInput): TabletopMap => {
  const destination = input.command.selections.cells[0]
  if (!destination || input.command.selections.cells.length !== 1) throw new Error('Capability movement requires one destination cell.')
  const distance = ptuGridVectorDistance({
    x: destination.x - input.actorPlacement.position.x,
    y: destination.y - input.actorPlacement.position.y,
    z: destination.z - input.actorPlacement.position.z,
  })
  const teleportInstance = input.command.actionId === 'teleport'
    ? resolveEffectiveCapabilities({
        map: input.map,
        placement: input.actorPlacement,
        sheet: input.actorSheet,
        sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
      }).instances.find(instance => instance.instanceId === input.command.capabilityInstanceId)
    : null
  const maximum = input.command.actionId === 'keystone-warp' ? 10
    : input.command.actionId === 'teleport'
      ? teleportInstance?.value ?? (teleportInstance?.parameters.kind === 'value' ? teleportInstance.parameters.value : 0)
      : 4
  if (distance < 1 || distance > maximum) throw new Error(`Capability movement destination exceeds ${maximum} meters.`)
  const linkedCompanionPlacementIds = capabilityLinkedMovementPlacementIds(input, input.actorPlacement.id)
  const resolution = resolveAuthoritativeRelocation({
    map: input.map,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    placementId: input.actorPlacement.id,
    now: input.now,
    mode: 'teleport',
    destination,
    ignoredPlacementIds: linkedCompanionPlacementIds,
    linkedCompanionPlacementIds,
  })
  if (!resolution.ok) throw new Error(resolution.message)
  const relocated = applyAuthoritativeMovementMapTransition({
    map: input.map,
    placementId: input.actorPlacement.id,
    destination: resolution.destination,
    distance: resolution.distance,
    encounterState: parseEncounterState(input.map.encounterState ?? createEmptyEncounterState()),
    timestamp: input.now,
    userName: input.command.canonicalId,
    linkedCompanionPlacementIds,
    movementEvidence: {
      operationId: input.command.operationId,
      path: resolution.path,
      mode: 'teleport',
    },
  }).nextMap
  if (input.command.actionId !== 'teleport') return relocated
  return recordTeleporterRoundUse({
    map: relocated,
    placementId: input.actorPlacement.id,
    identity: teleporterRoundIdentity(input.map),
    sourceOperationId: input.command.operationId,
  })
}

const executeJump = (input: ExecuteCapabilityMechanicInput): CapabilityMechanicExecution => {
  const plan = resolveCapabilityJumpPlan({
    map: input.map,
    actor: input.actorPlacement,
    actorSheet: input.actorSheet,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    command: input.command,
    now: input.now,
  })
  const rolls: CapabilityServerRoll[] = []
  if (plan.extension) {
    const check = rollSkill(input, input.actorSheet, input.actorPlacement.sheetKind, 'acrobatics', 'jump-acrobatics')
    rolls.push(check)
    if (check.total < 16) return {
      map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
      reasonCode: 'capability.jump.extension-check-failed',
      adjudicationNote: `Acrobatics ${check.total} did not meet DC 16.`,
    }
  }
  if (plan.trickyDc !== null) {
    const check = rollSkill(input, input.actorSheet, input.actorPlacement.sheetKind, 'acrobatics', 'jump-tricky')
    rolls.push(check)
    if (check.total < plan.trickyDc) return {
      map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
      reasonCode: 'capability.jump.tricky-check-failed',
      adjudicationNote: `Acrobatics ${check.total} did not meet tricky Jump DC ${plan.trickyDc}.`,
    }
  }
  let movementMap = input.map
  if (plan.running) {
    const runUp = resolveMovement({
      map: input.map,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
      placementId: input.actorPlacement.id,
      now: input.now,
      mode: 'shift',
      destination: plan.jumpOrigin,
      policy: { kind: 'standard', maximumCost: 1 },
    })
    if (!runUp.ok) throw new Error(runUp.message)
    movementMap = applyAuthoritativeMovementMapTransition({
      map: input.map,
      placementId: input.actorPlacement.id,
      destination: runUp.destination,
      distance: runUp.cost,
      encounterState: parseEncounterState(input.map.encounterState ?? createEmptyEncounterState()),
      timestamp: input.now,
      userName: input.command.canonicalId,
      linkedCompanionPlacementIds: plan.linkedCompanionPlacementIds,
      movementEvidence: {
        operationId: `${input.command.operationId}:running-start`,
        path: runUp.path,
        mode: 'voluntary',
      },
    }).nextMap
  }
  const resolution = resolveAuthoritativeRelocation({
    map: movementMap,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    placementId: input.actorPlacement.id,
    now: input.now,
    mode: 'jump',
    destination: plan.destination,
    ignoredPlacementIds: plan.linkedCompanionPlacementIds,
    linkedCompanionPlacementIds: plan.linkedCompanionPlacementIds,
  })
  if (!resolution.ok) throw new Error(resolution.message)
  const transitioned = applyAuthoritativeMovementMapTransition({
    map: movementMap,
    placementId: input.actorPlacement.id,
    destination: resolution.destination,
    distance: plan.travelDistance,
    encounterState: parseEncounterState(movementMap.encounterState ?? createEmptyEncounterState()),
    timestamp: input.now,
    userName: input.command.canonicalId,
    linkedCompanionPlacementIds: plan.linkedCompanionPlacementIds,
    movementEvidence: {
      operationId: input.command.operationId,
      path: plan.trajectory,
      mode: 'jump',
    },
  }).nextMap
  return {
    map: transitioned,
    sheetMutations: [], rolls, produced: [], outcome: 'applied',
    reasonCode: 'capability.jump.resolved', adjudicationNote: null,
  }
}

const pokemonWeightClass = (sheet: CharacterSheet): number => {
  const raw = resolveCapabilities(sheet).rows.find(row => row.label === 'Weight')?.value
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isSafeInteger(value) && value >= 1 ? value : 1
}

const poundsWeightClass = (pounds: number): number => pounds <= 25 ? 1
  : pounds <= 55 ? 2 : pounds <= 110 ? 3 : pounds <= 220 ? 4 : pounds <= 440 ? 5 : 6

const trainerWeightClass = (sheet: TrainerSheet): number => {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(lb|lbs|pounds?|kg|kilograms?)?\s*$/i.exec(sheet.weight ?? '')
  if (!match) return 4
  const value = Number(match[1])
  const pounds = /^(?:kg|kilograms?)$/i.test(match[2] ?? '') ? value * 2.2046226218 : value
  return Number.isFinite(pounds) && pounds > 0 ? poundsWeightClass(pounds) : 4
}

const participantWeightClass = (
  placement: SheetPlacement,
  sheet: CharacterSheet | TrainerSheet,
): number => placement.sheetKind === 'pokemon'
  ? pokemonWeightClass(sheet as CharacterSheet)
  : trainerWeightClass(sheet as TrainerSheet)

const physicalLoadProjectedToken = (
  input: ExecuteCapabilityMechanicInput,
  placement: SheetPlacement,
  sheet: CharacterSheet | TrainerSheet,
) => {
  const sheets = { pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets) }
  const token = placementToSpawned(placement, sheets, input.map)
  if (!token) throw new Error(`Capability participant ${placement.id} is unavailable.`)
  const effective = resolveEffectiveCapabilities({
    map: input.map, placement, sheet, sheets,
  }).instances.filter(instance => instance.effective)
  return projectPhysicalPowerLoadToken({
    token,
    map: input.map,
    placementId: placement.id,
    powerByCapabilityInstanceId: physicalPowerSourceValues(effective),
  })
}

const accuracyRollHits = (roll: CapabilityServerRoll, accuracyCheck: number): boolean => {
  const natural = roll.dice[0]
  return natural === 20 || (natural !== 1 && roll.total >= accuracyCheck)
}

const THREADED_STATUS_SCRIPT: MoveAutomationScript = Object.freeze({
  kind: 'explicit', moveName: 'Threaded', version: 1, targetMode: 'one-target', targetCount: 1,
  damaging: false, requiresAccuracy: true, damageBase: null, damageClass: 'Status', type: 'Bug',
  ac: 6, range: '4, 1 Target', effect: 'Reviewed Threaded AC 6 Status Attack.', keywords: [],
  criticalRange: null, conditionSuggestions: [], stageSuggestions: [], hpSuggestions: [],
  fieldSuggestions: [], hazardSuggestions: [], automationNotes: [],
})

const executeThreadedShift = (input: ExecuteCapabilityMechanicInput): CapabilityMechanicExecution => {
  const preciseThreadings = input.actorPlacement.sheetKind === 'pokemon'
    && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'Precise Threadings')
  const threadedRange = preciseThreadings ? 6 : 4
  const threadedAc = preciseThreadings ? 3 : 6
  const targetId = input.command.selections.targetPlacementIds[0]
  const target = targetId ? input.map.placements.find(placement => placement.id === targetId) : null
  const anchor = input.command.selections.cells[0]
  const option = input.command.selections.optionId
  const objectId = option === 'object' ? input.command.selections.canonicalItemId : null
  const rawObjects = Array.isArray(input.map.metadata?.capabilityObjects)
    ? input.map.metadata.capabilityObjects as unknown[] : []
  const object = objectId ? rawObjects.find(raw => raw && typeof raw === 'object' && !Array.isArray(raw)
    && (raw as Record<string, unknown>).id === objectId) as Record<string, unknown> | undefined : null
  if (option === 'object') {
    if (target || !anchor || !object) throw new Error('Threaded object branch requires one exact authoritative object and cell.')
  }
  else if ((target ? 1 : 0) + (anchor ? 1 : 0) !== 1) {
    throw new Error('Threaded Shift requires exactly one target or anchor cell.')
  }
  if (target && option !== 'willing-target' && option !== 'unwilling-target') {
    throw new Error('Threaded target disposition must be willing-target or unwilling-target.')
  }
  if (anchor && !object && option !== 'anchor') throw new Error('Threaded anchor selection must use the anchor branch.')

  const rolls: CapabilityServerRoll[] = []
  if (option === 'unwilling-target') {
    if (!target) throw new Error('Unwilling Threaded requires one target.')
    const targetSheet = target.sheetKind === 'pokemon'
      ? input.pokemonSheets.get(target.sheetSlug)
      : input.trainerSheets.get(target.sheetSlug)
    if (!targetSheet) throw new Error('Threaded target sheet is unavailable.')
    const actorToken = physicalLoadProjectedToken(input, input.actorPlacement, input.actorSheet)
    const targetToken = physicalLoadProjectedToken(input, target, targetSheet)
    const accuracyModifier = moveAutomationUserAccuracy(actorToken, { fieldEffects: input.map.fieldEffects })
      - resolveMoveAutomationTargetEvasion({ ...THREADED_STATUS_SCRIPT, ac: threadedAc }, targetToken, {
        attacker: actorToken, fieldEffects: input.map.fieldEffects,
      }).value
    const rawAccuracy = input.rollDie('threaded-accuracy', 20)
    const accuracy: CapabilityServerRoll = Object.freeze({
      ...rawAccuracy,
      expression: `1d20${accuracyModifier === 0 ? '' : accuracyModifier > 0 ? `+${accuracyModifier}` : accuracyModifier}`,
      modifier: accuracyModifier,
      total: rawAccuracy.total + accuracyModifier,
    })
    rolls.push(accuracy)
    if (!accuracyRollHits(accuracy, threadedAc)) return {
      map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
      reasonCode: 'capability.threaded.accuracy-missed', adjudicationNote: `Threaded did not meet AC ${threadedAc} after authoritative Accuracy and Evasion.`,
    }
  }

  const actorWeight = participantWeightClass(input.actorPlacement, input.actorSheet)
  if (object) {
    const position = object.position as Record<string, unknown>
    const objectPosition = {
      x: Number(position?.x), y: Number(position?.y), z: Number(position?.z),
    }
    const objectWeight = poundsWeightClass(Number(object.pounds))
    if (objectWeight === actorWeight) return {
      map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
      reasonCode: 'capability.threaded.equal-weight', adjudicationNote: 'Neither the user nor object is lighter, so Threaded moves neither.',
    }
    if (objectWeight < actorWeight) {
      const vector = {
        x: Math.sign(input.actorPlacement.position.x - objectPosition.x),
        y: Math.sign(input.actorPlacement.position.y - objectPosition.y),
        z: Math.sign(input.actorPlacement.position.z - objectPosition.z),
      }
      const separation = Math.max(
        Math.abs(input.actorPlacement.position.x - objectPosition.x),
        Math.abs(input.actorPlacement.position.y - objectPosition.y),
        Math.abs(input.actorPlacement.position.z - objectPosition.z),
      )
      const requestedDistance = Math.min(threadedRange, separation - 1)
      if (requestedDistance < 1) return {
        map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
        reasonCode: 'capability.threaded.already-adjacent', adjudicationNote: 'The Threaded object is already adjacent.',
      }
      const sheets = { pokemon: new Map(input.pokemonSheets), trainer: new Map(input.trainerSheets) }
      const footprints = input.map.placements.flatMap((placement) => {
        const token = placementToSpawned(placement, sheets, input.map)
        return token ? [{ position: placement.position, base: token.base, clearance: getClearanceValue(token) }] : []
      })
      const blocked = new Set(input.map.voxels.filter(voxel => (
        voxel.blocksMovement ?? getVoxelMaterialDefinition(voxel).blocksMovementDefault ?? false
      )).map(voxel => `${voxel.x}:${voxel.y}:${voxel.z}`))
      const otherObjectCells = new Set(rawObjects.flatMap((raw): readonly string[] => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw === object) return []
        const otherPosition = (raw as Record<string, unknown>).position as Record<string, unknown> | undefined
        return Number.isSafeInteger(otherPosition?.x) && Number.isSafeInteger(otherPosition?.y) && Number.isSafeInteger(otherPosition?.z)
          ? [`${otherPosition!.x}:${otherPosition!.y}:${otherPosition!.z}`] : []
      }))
      let destination = objectPosition
      for (let step = 1; step <= requestedDistance; step += 1) {
        const candidate = {
          x: objectPosition.x + vector.x * step,
          y: objectPosition.y + vector.y * step,
          z: objectPosition.z + vector.z * step,
        }
        const key = `${candidate.x}:${candidate.y}:${candidate.z}`
        const occupied = footprints.some(footprint => (
          candidate.x >= footprint.position.x && candidate.x < footprint.position.x + footprint.base
          && candidate.y >= footprint.position.y && candidate.y < footprint.position.y + footprint.clearance
          && candidate.z >= footprint.position.z && candidate.z < footprint.position.z + footprint.base
        ))
        if (candidate.x < 0 || candidate.y < 0 || candidate.z < 0
          || candidate.x >= input.map.dimensions.x || candidate.y >= input.map.dimensions.y || candidate.z >= input.map.dimensions.z
          || blocked.has(key) || otherObjectCells.has(key) || occupied) break
        destination = candidate
      }
      if (destination === objectPosition) return {
        map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
        reasonCode: 'capability.threaded.route-blocked', adjudicationNote: 'The Threaded object route is blocked.',
      }
      return {
        map: {
          ...input.map,
          metadata: {
            ...(input.map.metadata ?? {}),
            capabilityObjects: rawObjects.map(raw => raw === object ? {
              ...object, position: destination, lastCapabilityOperationId: input.command.operationId,
            } : raw),
          },
        },
        sheetMutations: [], rolls, produced: [], outcome: 'applied',
        reasonCode: 'capability.threaded.object-shift-applied', adjudicationNote: null,
      }
    }
  }
  let movedPlacementId = input.actorPlacement.id
  let start = input.actorPlacement.position
  let destinationReference = anchor!
  if (target) {
    const targetSheet = target.sheetKind === 'pokemon'
      ? input.pokemonSheets.get(target.sheetSlug)
      : input.trainerSheets.get(target.sheetSlug)
    if (!targetSheet) throw new Error('Threaded target sheet is unavailable.')
    const targetWeight = participantWeightClass(target, targetSheet)
    if (actorWeight === targetWeight) return {
      map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
      reasonCode: 'capability.threaded.equal-weight', adjudicationNote: 'Neither participant is lighter, so Threaded does not move either.',
    }
    if (targetWeight < actorWeight) {
      movedPlacementId = target.id
      start = target.position
      destinationReference = input.actorPlacement.position
    }
    else destinationReference = target.position
  }
  const vector = {
    x: Math.sign(destinationReference.x - start.x),
    y: Math.sign(destinationReference.y - start.y),
    z: Math.sign(destinationReference.z - start.z),
  }
  const separation = Math.max(
    Math.abs(destinationReference.x - start.x),
    Math.abs(destinationReference.y - start.y),
    Math.abs(destinationReference.z - start.z),
  )
  let requestedDistance = Math.min(threadedRange, separation - (target ? 1 : 0))
  if (movedPlacementId === input.actorPlacement.id) {
    const loadedActor = physicalLoadProjectedToken(input, input.actorPlacement, input.actorSheet)
    const load = loadedActor.physicalPowerLoad
    const loadLimit = physicalPowerMovementLimit(load ?? null, input.map.initiative?.round)
    if (loadLimit !== null) requestedDistance = Math.min(requestedDistance, loadLimit)
  }
  if (requestedDistance < 1) return {
    map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
    reasonCode: 'capability.threaded.already-adjacent',
    adjudicationNote: 'Threaded has no remaining distance under adjacency and physical load limits.',
  }
  const displacement = resolveAuthoritativeDisplacement({
    map: input.map,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    placementId: movedPlacementId,
    now: input.now,
    movementMode: 'forced',
    vector,
    requestedDistance,
    distancePolicy: 'up-to-distance',
    ignoredPlacementIds: capabilityLinkedMovementPlacementIds(input, movedPlacementId),
  })
  if (!displacement.ok) return {
    map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
    reasonCode: 'capability.threaded.route-blocked', adjudicationNote: displacement.message,
  }
  const linkedCompanionPlacementIds = capabilityLinkedMovementPlacementIds(input, movedPlacementId)
  return {
    map: applyAuthoritativeMovementMapTransition({
      map: input.map,
      placementId: movedPlacementId,
      destination: displacement.destination,
      distance: displacement.resolvedDistance,
      encounterState: parseEncounterState(input.map.encounterState ?? createEmptyEncounterState()),
      timestamp: input.now,
      userName: input.command.canonicalId,
      linkedCompanionPlacementIds,
      movementEvidence: {
        operationId: input.command.operationId,
        path: displacement.path,
        mode: 'forced',
      },
    }).nextMap,
    sheetMutations: [], rolls, produced: [], outcome: 'applied',
    reasonCode: 'capability.threaded.shift-applied', adjudicationNote: null,
  }
}

const withTrainerItem = (
  trainer: TrainerSheet,
  name: string,
  operationId: string,
  quantity = 1,
  section: 'pokemonItems' | 'foodStuff' = 'pokemonItems',
): TrainerSheet => {
  const current = deepCloneJson(trainer)
  const inventory = current.inventory ?? {}
  const rows = [...(inventory[section] ?? [])]
  const existingIndex = rows.findIndex(entry => entry.name.trim().toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))
  if (existingIndex >= 0) {
    const existing = rows[existingIndex]!
    rows[existingIndex] = { ...existing, qty: Math.max(0, existing.qty ?? 1) + quantity }
  }
  else {
    const row: InventoryEntry = {
      id: `capability:${operationId}:item`.slice(0, 200),
      name,
      qty: quantity,
      description: `Produced by Capability automation (${operationId}).`,
    }
    rows.push(row)
  }
  return { ...current, inventory: { ...inventory, [section]: rows } }
}

const trainerOwnsInventoryItem = (trainer: TrainerSheet, itemName: string): boolean => {
  const inventory = trainer.inventory
  const rows = [
    ...(inventory?.keyItems ?? []), ...(inventory?.pokemonItems ?? []),
    ...(inventory?.medicalKit ?? []), ...(inventory?.pokeBalls ?? []),
    ...(inventory?.foodStuff ?? []), ...(inventory?.equipment ?? []),
  ]
  return rows.some(row => row.name.trim().toLocaleLowerCase('en-US') === itemName.toLocaleLowerCase('en-US')
    && (row.qty ?? 1) > 0)
}

const recipientTrainer = (
  input: ExecuteCapabilityMechanicInput,
  requireExplicit = false,
): TrainerSheet => {
  const requested = input.command.selections.recipientTrainerSlug
  if (requireExplicit && !requested) throw new Error('This Capability output requires an explicitly selected linked Trainer inventory.')
  if (requested && !input.linkedTrainerSlugs.has(requested)) throw new Error('Item recipient is not linked to the Capability actor.')
  const slug = requested ?? (input.actorPlacement.sheetKind === 'trainer' ? input.actorPlacement.sheetSlug : [...input.linkedTrainerSlugs][0])
  if (!slug) throw new Error('Capability output requires a linked Trainer recipient.')
  const trainer = input.trainerSheets.get(slug)
  if (!trainer) throw new Error('Capability output recipient Trainer is unavailable.')
  return trainer
}

const itemOutput = (
  input: ExecuteCapabilityMechanicInput,
  itemName: string,
  options: {
    readonly canonicalItemId?: string
    readonly requireExplicitRecipient?: boolean
    readonly section?: 'pokemonItems' | 'foodStuff'
  } = {},
): { readonly mutation: CapabilityMechanicSheetMutation; readonly produced: CapabilityProducedResource } => {
  const recipient = recipientTrainer(input, options.requireExplicitRecipient === true)
  return {
    mutation: {
      kind: 'trainer', slug: recipient.slug, previous: recipient,
      current: withTrainerItem(recipient, itemName, input.command.operationId, 1, options.section),
    },
    produced: {
      kind: 'item', canonicalId: options.canonicalItemId ?? itemName,
      quantity: 1, recipientSheetSlug: recipient.slug,
    },
  }
}

const executeProduction = (input: ExecuteCapabilityMechanicInput): CapabilityMechanicExecution => {
  let itemName = input.action.itemOutputs[0]
  const rolls: CapabilityServerRoll[] = []
  if (input.command.actionId === 'harvest-mushroom') {
    const roll = input.rollDie('mushroom-harvest', 20)
    rolls.push(roll)
    itemName = roll.total <= 12 ? 'Tiny Mushroom' : roll.total <= 18 ? 'Big Mushroom' : 'Balm Mushroom'
  }
  if (!itemName) throw new Error('Capability item-production action has no reviewed output.')
  const output = itemOutput(input, itemName)
  return {
    map: input.map,
    sheetMutations: [output.mutation],
    rolls,
    produced: [output.produced],
    outcome: 'applied',
    reasonCode: 'capability.item-produced',
    adjudicationNote: null,
  }
}

const executeRoll = (input: ExecuteCapabilityMechanicInput): CapabilityMechanicExecution => {
  const rolls: CapabilityServerRoll[] = []
  const produced: CapabilityProducedResource[] = []
  const mutations: CapabilityMechanicSheetMutation[] = []
  let map = input.map
  let note: string | null = null
  if (input.command.actionId === 'oppose-examination') {
    const examinerId = input.command.selections.targetPlacementIds[0]
    const examiner = input.map.placements.find(placement => placement.id === examinerId)
    const examinerSheet = examiner?.sheetKind === 'pokemon'
      ? input.pokemonSheets.get(examiner.sheetSlug)
      : examiner ? input.trainerSheets.get(examiner.sheetSlug) : null
    if (!examiner || !examinerSheet) throw new Error('The retained Shapeshifter examiner is unavailable.')
    const stealth = rollSkill(input, input.actorSheet, input.actorPlacement.sheetKind, 'stealth', 'shapeshifter-stealth')
    const perception = rollSkill(input, examinerSheet, examiner.sheetKind, 'perception', 'examiner-perception')
    const revealed = perception.total >= stealth.total
    const summary = revealed
      ? `${examiner.id} recognized the Shapechanged subject’s true nature.`
      : `${examiner.id} did not recognize the Shapechanged subject’s true nature.`
    const noticed = mapWithPrivateNotice({
      map: input.map,
      operationId: input.command.operationId,
      canonicalId: input.command.canonicalId,
      actionId: input.command.actionId,
      label: 'Shapeshifter Examination',
      summary,
      sourcePlacementId: input.actorPlacement.id,
      revealToPlacementIds: [input.actorPlacement.id, examiner.id],
      createdAt: input.now,
    })
    const examinations = Array.isArray(noticed.metadata?.capabilityCloseExaminations)
      ? noticed.metadata.capabilityCloseExaminations as unknown[] : []
    return {
      map: {
        ...noticed,
        metadata: {
          ...(noticed.metadata ?? {}),
          capabilityCloseExaminations: examinations.filter(raw => (
            !raw || typeof raw !== 'object' || Array.isArray(raw)
            || (raw as Record<string, unknown>).subjectPlacementId !== input.actorPlacement.id
            || (raw as Record<string, unknown>).examinerPlacementId !== examiner.id
          )),
        },
      },
      sheetMutations: [], rolls: [stealth, perception], produced: [], outcome: 'applied',
      reasonCode: revealed ? 'capability.shapeshifter.revealed' : 'capability.shapeshifter.concealed',
      adjudicationNote: summary,
    }
  }
  if (input.command.actionId === 'lure-with-alluring') {
    const match = /^species:([^;]{1,80});level:(\d{1,3})$/.exec(input.command.selections.optionId ?? '')
    const species = match
      ? (pokedexData as readonly PokedexRecord[]).find(record => (
          record.species.trim().toLocaleLowerCase('en-US') === match[1]!.trim().toLocaleLowerCase('en-US')
        )) : null
    const level = Number(match?.[2])
    const position = input.command.selections.cells[0]
    if (!species || !position || !Number.isSafeInteger(level) || level < 1 || level > 100) {
      throw new Error('Alluring lure encounter parameters are unavailable.')
    }
    const runtime = runtimeFor(input.map)
    const task: CapabilityAlluringLureTaskState = {
      id: `capability.task.${input.actorPlacement.id}.alluring-lure`,
      kind: 'alluring-lure',
      actorPlacementId: input.actorPlacement.id,
      capabilityInstanceId: input.command.capabilityInstanceId,
      canonicalId: 'Alluring',
      encounterSpecies: species.species,
      encounterLevel: level,
      encounterCell: { ...position },
      originCell: { ...input.actorPlacement.position },
      failedChecks: 0,
      startedAt: input.now,
      completesAt: input.now + 15 * 60_000,
      sourceOperationId: input.command.operationId,
    }
    const nextRuntime = parseCapabilityRuntimeState({
      ...runtime,
      tasks: [
        ...runtime.tasks.filter(candidate => candidate.id !== task.id),
        task,
      ],
    })
    return {
      map: mapWithRuntimeAndEffects(input.map, nextRuntime, input.map.encounterState?.effects ?? []),
      sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.alluring.lure-started',
      adjudicationNote: 'The first authoritative Alluring lure check is due in 15 minutes.',
    }
  }
  if (input.command.actionId === 'abandon-alluring-lure') {
    const runtime = runtimeFor(input.map)
    const task = runtime.tasks.find(candidate => (
      candidate.kind === 'alluring-lure'
      && candidate.actorPlacementId === input.actorPlacement.id
      && candidate.capabilityInstanceId === input.command.capabilityInstanceId
      && candidate.canonicalId === 'Alluring'
    ))
    if (!task) throw new Error('The exact source-owned Alluring lure is no longer active.')
    const nextRuntime = parseCapabilityRuntimeState({
      ...runtime,
      tasks: runtime.tasks.filter(candidate => candidate.id !== task.id),
    })
    return {
      map: mapWithRuntimeAndEffects(input.map, nextRuntime, input.map.encounterState?.effects ?? []),
      sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.alluring.lure-abandoned',
      adjudicationNote: 'The active Alluring lure was abandoned before resolution.',
    }
  }
  if (input.command.actionId === 'resolve-alluring-lure-check') {
    const runtime = runtimeFor(input.map)
    const task = runtime.tasks.find((candidate): candidate is CapabilityAlluringLureTaskState => (
      candidate.kind === 'alluring-lure'
      && candidate.actorPlacementId === input.actorPlacement.id
      && candidate.capabilityInstanceId === input.command.capabilityInstanceId
      && candidate.canonicalId === 'Alluring'
    ))
    if (!task || input.now < task.completesAt) throw new Error('The next Alluring lure check is not due.')
    if (input.actorPlacement.position.x !== task.originCell.x
      || input.actorPlacement.position.y !== task.originCell.y
      || input.actorPlacement.position.z !== task.originCell.z) {
      throw new Error('The Alluring lure actor left its retained route position.')
    }
    const dueChecks = Math.min(
      3 - task.failedChecks,
      Math.floor((input.now - task.completesAt) / (15 * 60_000)) + 1,
    )
    const enticingBaitBonus = input.actorPlacement.sheetKind === 'pokemon'
      && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'Enticing Bait')
      ? Math.max(
          skillExpression(input.actorSheet, input.actorPlacement.sheetKind, 'athletics').count,
          skillExpression(input.actorSheet, input.actorPlacement.sheetKind, 'focus').count,
        ) : 0
    let successfulAttempt: number | null = null
    for (let offset = 0; offset < dueChecks; offset += 1) {
      const attempt = task.failedChecks + offset + 1
      const raw = input.rollDie(`alluring-lure-${attempt}`, 20)
      const roll: CapabilityServerRoll = enticingBaitBonus > 0 ? Object.freeze({
        ...raw,
        expression: `1d20+${enticingBaitBonus}`,
        modifier: enticingBaitBonus,
        total: raw.total + enticingBaitBonus,
      }) : raw
      rolls.push(roll)
      if (roll.total >= 15) {
        successfulAttempt = attempt
        break
      }
    }
    const completedChecks = rolls.length
    const failedChecks = task.failedChecks + completedChecks
    const withoutTask = parseCapabilityRuntimeState({
      ...runtime,
      tasks: runtime.tasks.filter(candidate => candidate.id !== task.id),
    })
    if (successfulAttempt === null && failedChecks < 3) {
      const continued = parseCapabilityRuntimeState({
        ...runtime,
        tasks: runtime.tasks.map(candidate => candidate.id === task.id ? {
          ...task,
          failedChecks,
          completesAt: task.completesAt + completedChecks * 15 * 60_000,
        } : candidate),
      })
      return {
        map: mapWithRuntimeAndEffects(input.map, continued, input.map.encounterState?.effects ?? []),
        sheetMutations: [], rolls, produced: [], outcome: 'applied',
        reasonCode: 'capability.alluring.lure-check-failed',
        adjudicationNote: `Alluring lure check ${failedChecks} failed; the next check is due in 15 minutes.`,
      }
    }
    const resolvedMap = mapWithRuntimeAndEffects(input.map, withoutTask, input.map.encounterState?.effects ?? [])
    if (successfulAttempt === null) return {
      map: resolvedMap, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
      reasonCode: 'capability.alluring.lure-expired',
      adjudicationNote: 'Three separately timed lure checks failed; the daily Alluring bait effect lost its potency.',
    }
    const species = (pokedexData as readonly PokedexRecord[]).find(record => (
      record.species.trim().toLocaleLowerCase('en-US') === task.encounterSpecies.trim().toLocaleLowerCase('en-US')
    ))
    if (!species) throw new Error('The retained Alluring encounter species is unavailable.')
    const level = task.encounterLevel
    const position = task.encounterCell
    const stableSuffix = task.sourceOperationId.toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-80)
    const slug = `alluring-${species.species.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')}-${stableSuffix}`.slice(0, 120)
    const placementId = `capability-alluring:${task.sourceOperationId}`.slice(0, 200)
    if (input.pokemonSheets.has(slug) || resolvedMap.placements.some(placement => placement.id === placementId)) {
      throw new Error('Alluring deterministic encounter identity already exists.')
    }
    const summoned: CharacterSheet = { slug, nickname: species.species, species: species.species, level }
    const placement: SheetPlacement = { id: placementId, sheetKind: 'pokemon', sheetSlug: slug, position: { ...position } }
    const pokemon = new Map(input.pokemonSheets)
    pokemon.set(slug, summoned)
    const sheets = { pokemon, trainer: new Map(input.trainerSheets) }
    const token = placementToSpawned(placement, sheets, resolvedMap)
    const existing = resolvedMap.placements.flatMap(candidate => {
      const resolved = placementToSpawned(candidate, sheets, resolvedMap)
      return resolved ? [resolved] : []
    })
    if (!token || !canPlacePokemon(token, position, existing, resolvedMap.dimensions, null, buildVoxelOccupancy(resolvedMap.voxels))) {
      throw new Error('The GM-selected Alluring encounter cell cannot contain the generated Pokémon.')
    }
    const generated = Array.isArray(resolvedMap.metadata?.capabilityGeneratedCreatures)
      ? resolvedMap.metadata.capabilityGeneratedCreatures as unknown[] : []
    const wildIds = Array.isArray(resolvedMap.metadata?.capabilityWildPlacementIds)
      ? resolvedMap.metadata.capabilityWildPlacementIds.filter((id): id is string => typeof id === 'string') : []
    map = {
      ...resolvedMap,
      placements: [...resolvedMap.placements, placement],
      metadata: {
        ...(resolvedMap.metadata ?? {}),
        capabilityWildPlacementIds: [...new Set([...wildIds, placementId])],
        capabilityGeneratedCreatures: [...generated, {
          id: placementId, sheetSlug: slug, species: species.species, level,
          position: { ...position }, disposition: 'wild', sourceOperationId: input.command.operationId,
          lureSourceOperationId: task.sourceOperationId,
        }],
      },
    }
    mutations.push({ kind: 'pokemon', slug, previous: null, current: summoned })
    produced.push({ kind: 'summoned-creature', canonicalId: species.species, quantity: 1, recipientSheetSlug: slug })
    note = `Alluring succeeded on separately timed check ${successfulAttempt}; a GM-selected Level ${level} ${species.species} appeared.`
  }
  else if (input.command.actionId === 'roam-for-fortune') {
    const runtime = runtimeFor(input.map)
    if (runtime.tasks.some(task => task.kind === 'fortune-roam'
      && task.actorPlacementId === input.actorPlacement.id
      && task.capabilityInstanceId === input.command.capabilityInstanceId)) {
      throw new Error('This exact Fortune source already has an active roam.')
    }
    const task: CapabilityFortuneRoamTaskState = {
      id: `capability.task.fortune-roam.${createHash('sha256')
        .update(`${input.map.slug}\u0000${input.actorPlacement.id}\u0000${input.command.capabilityInstanceId}\u0000${input.command.operationId}`)
        .digest('hex')}`,
      kind: 'fortune-roam',
      actorPlacementId: input.actorPlacement.id,
      capabilityInstanceId: input.command.capabilityInstanceId,
      canonicalId: 'Fortune',
      startedAt: input.now,
      completesAt: input.now + CAPABILITY_FORTUNE_ROAM_DURATION_MS,
      sourceOperationId: input.command.operationId,
    }
    const nextRuntime = parseCapabilityRuntimeState({
      ...runtime,
      tasks: [...runtime.tasks, task],
    })
    return {
      map: mapWithRuntimeAndEffects(input.map, nextRuntime, input.map.encounterState?.effects ?? []),
      sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.fortune.roam-started',
      adjudicationNote: 'The Fortune roam is due after one authoritative hour; no money was rolled early.',
    }
  }
  else if (input.command.actionId === 'abandon-fortune-roam') {
    const runtime = runtimeFor(input.map)
    const task = runtime.tasks.find(candidate => candidate.kind === 'fortune-roam'
      && candidate.actorPlacementId === input.actorPlacement.id
      && candidate.capabilityInstanceId === input.command.capabilityInstanceId
      && candidate.canonicalId === 'Fortune')
    if (!task) throw new Error('The exact source-owned Fortune roam is no longer active.')
    const nextRuntime = parseCapabilityRuntimeState({
      ...runtime,
      tasks: runtime.tasks.filter(candidate => candidate.id !== task.id),
      // A retained GM decision belongs to this exact roam. Invalidating its
      // public summary prevents the durable request from consuming a later
      // post-reset Fortune task that happens to use the same Capability source.
      pendingAdjudications: runtime.pendingAdjudications.filter(request => !(
        request.actorPlacementId === input.actorPlacement.id
        && request.capabilityInstanceId === input.command.capabilityInstanceId
        && request.canonicalId === 'Fortune'
        && request.actionId === 'resolve-fortune-roam'
      )),
    })
    return {
      map: mapWithRuntimeAndEffects(input.map, nextRuntime, input.map.encounterState?.effects ?? []),
      sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.fortune.roam-abandoned',
      adjudicationNote: 'The active Fortune roam was abandoned without refunding its daily use.',
    }
  }
  else if (input.command.actionId === 'resolve-fortune-roam') {
    const runtime = runtimeFor(input.map)
    const task = runtime.tasks.find(candidate => candidate.kind === 'fortune-roam'
      && candidate.actorPlacementId === input.actorPlacement.id
      && candidate.capabilityInstanceId === input.command.capabilityInstanceId
      && candidate.canonicalId === 'Fortune')
    if (!task || input.now < task.completesAt) {
      throw new Error('The exact Fortune roam has not completed its authoritative one-hour duration.')
    }
    const withoutTask = parseCapabilityRuntimeState({
      ...runtime,
      tasks: runtime.tasks.filter(candidate => candidate.id !== task.id),
    })
    const resolvedMap = mapWithRuntimeAndEffects(
      input.map,
      withoutTask,
      input.map.encounterState?.effects ?? [],
    )
    const lowLoyalty = input.actorPlacement.sheetKind === 'pokemon'
      && ((input.actorSheet as CharacterSheet).loyalty ?? 3) <= 1
    const decision = (input.command.selections.optionId ?? input.command.selections.description)
      ?.trim().toLocaleLowerCase('en-US')
    if (decision !== 'returns' && (decision !== 'runs-away' || !lowLoyalty)) {
      throw new Error(lowLoyalty
        ? 'Low-Loyalty Fortune requires the bounded GM choice returns or runs-away.'
        : 'A Fortune user above Loyalty 1 must return from its roam.')
    }
    if (decision === 'runs-away') {
      const rosterMutations = [...input.linkedTrainerSlugs].flatMap((slug): readonly CapabilityMechanicSheetMutation[] => {
        const previous = input.trainerSheets.get(slug)
        if (!previous) return []
        return [{
          kind: 'trainer', slug, previous,
          current: {
            ...deepCloneJson(previous),
            currentTeam: (previous.currentTeam ?? []).filter(pokemonSlug => pokemonSlug !== input.actorPlacement.sheetSlug),
            boxedPokemon: (previous.boxedPokemon ?? []).filter(pokemonSlug => pokemonSlug !== input.actorPlacement.sheetSlug),
          },
        }]
      })
      return {
        map: removeCapabilityPresenceGroup({ map: resolvedMap, ownerPlacementId: input.actorPlacement.id }).map,
        sheetMutations: rosterMutations, rolls, produced: [], outcome: 'applied',
        reasonCode: 'capability.fortune.user-ran-away',
        adjudicationNote: 'The GM retained the canonical low-Loyalty outcome: the user ran away, left play, and was removed from linked rosters.',
      }
    }
    map = resolvedMap
    const roll = input.rollDie('fortune', 10)
    rolls.push(roll)
    const amount = Math.max(0, input.actorSheet.level ?? 0) * roll.total
    const recipient = recipientTrainer(input, true)
    mutations.push({
      kind: 'trainer', slug: recipient.slug, previous: recipient,
      current: { ...deepCloneJson(recipient), money: Math.max(0, recipient.money ?? 0) + amount },
    })
    produced.push({ kind: 'money', canonicalId: 'Pokedollars', quantity: amount, recipientSheetSlug: recipient.slug })
    if (lowLoyalty) note = 'The GM retained the canonical low-Loyalty outcome: the user returned.'
  }
  else if (input.command.actionId === 'gather-unown') {
    const roll = input.rollDie('gather-unown', 8, 2)
    const formRoll = input.rollDie('gather-unown-form', 28)
    rolls.push(roll, formRoll)
    const level = Math.min(Math.max(1, input.actorSheet.level ?? 1), roll.total)
    const position = input.command.selections.cells[0]
    if (!position) throw new Error('Gather Unown requires a retained authoritative placement cell.')
    const form = formRoll.total <= 26 ? String.fromCharCode(64 + formRoll.total)
      : formRoll.total === 27 ? '!' : '?'
    const stableSuffix = input.command.operationId.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-80)
    const slug = `gathered-unown-${stableSuffix}`.slice(0, 120)
    const placementId = `capability-summon:${input.command.operationId}`.slice(0, 200)
    if (input.pokemonSheets.has(slug) || input.map.placements.some(placement => placement.id === placementId)) {
      throw new Error('Gather Unown deterministic entity identity already exists.')
    }
    const summoned: CharacterSheet = {
      slug,
      nickname: `Unown ${form}`,
      species: 'Unown',
      level,
      movelist: [{ name: 'Hidden Power' }],
    }
    const placement: SheetPlacement = {
      id: placementId, sheetKind: 'pokemon', sheetSlug: slug, position: { ...position },
    }
    const pokemon = new Map(input.pokemonSheets)
    pokemon.set(slug, summoned)
    const sheets = { pokemon, trainer: new Map(input.trainerSheets) }
    const token = placementToSpawned(placement, sheets, input.map)
    const existing = input.map.placements.flatMap(candidate => {
      const resolved = placementToSpawned(candidate, sheets, input.map)
      return resolved ? [resolved] : []
    })
    if (!token || !canPlacePokemon(token, position, existing, input.map.dimensions, null, buildVoxelOccupancy(input.map.voxels))) {
      throw new Error('The Gather Unown destination cannot contain the summoned Unown.')
    }
    const generated = Array.isArray(input.map.metadata?.capabilityGeneratedCreatures)
      ? input.map.metadata.capabilityGeneratedCreatures as unknown[] : []
    map = {
      ...input.map,
      placements: [...input.map.placements, placement],
      metadata: {
        ...(input.map.metadata ?? {}),
        capabilityWildPlacementIds: [...new Set([
          ...(Array.isArray(input.map.metadata?.capabilityWildPlacementIds)
            ? input.map.metadata.capabilityWildPlacementIds.filter((id): id is string => typeof id === 'string') : []),
          placementId,
        ])],
        capabilityGeneratedCreatures: [...generated, {
          id: placementId,
          sheetSlug: slug,
          species: 'Unown', form, level, position: { ...position }, disposition: 'non-hostile',
          sourceOperationId: input.command.operationId,
        }],
      },
    }
    mutations.push({ kind: 'pokemon', slug, previous: null, current: summoned })
    produced.push({ kind: 'summoned-creature', canonicalId: 'Unown', quantity: 1, recipientSheetSlug: slug })
    note = `A non-hostile Level ${level} Unown ${form} was created at (${position.x}, ${position.y}, ${position.z}).`
  }
  else if (input.command.actionId === 'harvest-mushroom') return executeProduction(input)
  else throw new Error(`Unsupported Capability roll action ${input.command.actionId}.`)
  return {
    map,
    sheetMutations: mutations,
    rolls,
    produced,
    outcome: 'applied',
    reasonCode: 'capability.roll-resolved',
    adjudicationNote: note,
  }
}

const skillExpression = (
  sheet: CharacterSheet | TrainerSheet,
  kind: 'pokemon' | 'trainer',
  key: 'focus' | 'perception' | 'combat' | 'acrobatics' | 'stealth' | 'athletics',
): { readonly count: number; readonly modifier: number } => {
  const expression = kind === 'pokemon'
    ? resolveSkills(sheet as CharacterSheet).find(row => row.key === key)?.value ?? '1d6'
    : resolveTrainerSkills(sheet as TrainerSheet).find(row => row.key === key)?.dice ?? '1d6'
  const match = /^(\d+)d6(?:\s*([+-])\s*(\d+))?$/i.exec(expression.trim())
  if (!match) throw new Error(`Authoritative ${key} skill expression is malformed.`)
  const count = Math.max(1, Math.min(6, Number.parseInt(match[1]!, 10)))
  const modifier = match[3] ? Number.parseInt(match[3], 10) * (match[2] === '-' ? -1 : 1) : 0
  return { count, modifier }
}

const rollSkill = (
  input: ExecuteCapabilityMechanicInput,
  sheet: CharacterSheet | TrainerSheet,
  kind: 'pokemon' | 'trainer',
  key: 'focus' | 'perception' | 'combat' | 'acrobatics' | 'stealth' | 'athletics',
  rollId: string,
  additionalModifier = 0,
): CapabilityServerRoll => {
  const expression = skillExpression(sheet, kind, key)
  const rolled = input.rollDie(rollId, 6, expression.count)
  const modifier = expression.modifier + additionalModifier
  return Object.freeze({
    ...rolled,
    expression: `${expression.count}d6${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}`,
    modifier,
    total: rolled.total + modifier,
  })
}

const executePhysicalPowerLoad = (
  input: ExecuteCapabilityMechanicInput,
): CapabilityMechanicExecution => {
  const rawObjects = Array.isArray(input.map.metadata?.capabilityObjects)
    ? input.map.metadata.capabilityObjects as unknown[] : []
  const ownedByExactSource = (raw: unknown): boolean => (
    Boolean(raw && typeof raw === 'object' && !Array.isArray(raw))
    && isPhysicalPowerLoadObject(raw as Record<string, unknown>)
    && (raw as Record<string, unknown>).attachedToPlacementId === input.actorPlacement.id
    && (raw as Record<string, unknown>).attachedCapabilityInstanceId === input.command.capabilityInstanceId
  )
  if (input.command.actionId === 'release-load') {
    let released = 0
    const capabilityObjects = rawObjects.map((raw) => {
      if (!ownedByExactSource(raw)) return raw
      released += 1
      return clearPhysicalPowerLoadAttachment(raw as Record<string, unknown>)
    })
    if (released === 0) throw new Error('The exact Power source owns no active physical load.')
    return {
      map: {
        ...input.map,
        metadata: { ...(input.map.metadata ?? {}), capabilityObjects },
      },
      sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.power.load-released',
      adjudicationNote: `${released} physical load object${released === 1 ? '' : 's'} released.`,
    }
  }

  const match = /^objects:([A-Za-z0-9._:/-]+(?:,[A-Za-z0-9._:/-]+){0,15})$/.exec(
    input.command.selections.optionId ?? '',
  )
  const objectIds = match?.[1]?.split(',') ?? []
  if (objectIds.length === 0 || new Set(objectIds).size !== objectIds.length) {
    throw new Error('Power requires unique authoritative physical load objects.')
  }
  const selectedIds = new Set(objectIds)
  const selected = objectIds.map((id) => {
    const matches = rawObjects.filter(raw => (
      raw && typeof raw === 'object' && !Array.isArray(raw)
      && (raw as Record<string, unknown>).id === id
    ))
    if (matches.length !== 1) {
      throw new Error(`Physical load object ${id} no longer resolves to exactly one authoritative object.`)
    }
    return matches[0] as Record<string, unknown>
  })
  const existing = rawObjects.filter(ownedByExactSource) as Record<string, unknown>[]
  const pounds = [...existing, ...selected]
    .reduce((total, object) => total + Number(object.pounds), 0)
  const effective = resolveEffectiveCapabilities({
    map: input.map,
    placement: input.actorPlacement,
    sheet: input.actorSheet,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
  }).instances.find(instance => (
    instance.effective
    && instance.instanceId === input.command.capabilityInstanceId
    && instance.canonicalId === 'Power'
  ))
  if (typeof effective?.value !== 'number' || !Number.isFinite(effective.value)) {
    throw new Error('The exact valued Power source is no longer effective.')
  }
  const load = resolveCapabilityPowerLoad(effective.value, pounds)
  if (load.loadClass === 'too-heavy') {
    throw new Error('The combined physical load must be strictly lighter than Drag Weight.')
  }
  const rolls: CapabilityServerRoll[] = []
  const currentRound = input.map.initiative?.round
  const round = Number.isSafeInteger(currentRound) && (currentRound as number) > 0
    ? currentRound as number : null
  if (load.loadClass === 'staggering') {
    const check = rollSkill(
      input,
      input.actorSheet,
      input.actorPlacement.sheetKind,
      'athletics',
      'physical-power-staggering-load',
    )
    rolls.push(check)
    if (check.total < (load.athleticsCheckDc ?? 4)) {
      const capabilityObjects = rawObjects.map(raw => ownedByExactSource(raw)
        ? clearPhysicalPowerLoadAttachment(raw as Record<string, unknown>) : raw)
      return {
        map: {
          ...input.map,
          metadata: { ...(input.map.metadata ?? {}), capabilityObjects },
        },
        sheetMutations: [], rolls, produced: [], outcome: 'no-op',
        reasonCode: 'capability.power.staggering-check-failed',
        adjudicationNote: `Athletics ${check.total} did not meet DC ${load.athleticsCheckDc ?? 4}; the load was not carried.`,
      }
    }
  }
  const retainedLastMovedRound = existing.reduce<number | null>((latest, object) => {
    const value = object.physicalLoadLastMovedRound
    return Number.isSafeInteger(value) && (value as number) > 0
      && (latest === null || (value as number) > latest) ? value as number : latest
  }, null)
  const retainedLastCheckRound = load.loadClass === 'staggering' ? round : null
  const attachment = physicalPowerLoadAttachment({
    placementId: input.actorPlacement.id,
    capabilityInstanceId: input.command.capabilityInstanceId,
    operationId: input.command.operationId,
    lastMovedRound: retainedLastMovedRound,
    lastCheckRound: retainedLastCheckRound,
  })
  const capabilityObjects = rawObjects.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const object = raw as Record<string, unknown>
    if (ownedByExactSource(object)) return {
      ...object,
      physicalLoadLastMovedRound: retainedLastMovedRound,
      physicalLoadLastCheckRound: retainedLastCheckRound,
    }
    if (!selectedIds.has(String(object.id))) return raw
    if (typeof object.attachedToPlacementId === 'string') {
      throw new Error(`Physical load object ${String(object.id)} is already attached.`)
    }
    return {
      ...object,
      ...attachment,
      position: { ...input.actorPlacement.position },
      lastCapabilityOperationId: input.command.operationId,
    }
  })
  return {
    map: {
      ...input.map,
      metadata: { ...(input.map.metadata ?? {}), capabilityObjects },
    },
    sheetMutations: [], rolls, produced: [], outcome: 'applied',
    reasonCode: `capability.power.${load.loadClass}-load-attached`,
    adjudicationNote: `${objectIds.length} object${objectIds.length === 1 ? '' : 's'} added; ${pounds} lb. resolves as ${load.loadClass} weight at Power ${Math.floor(effective.value)}.`,
  }
}

const bestOpposedSkill = (
  sheet: CharacterSheet | TrainerSheet,
  kind: 'pokemon' | 'trainer',
  keys: readonly ('combat' | 'acrobatics' | 'stealth' | 'athletics')[],
): 'combat' | 'acrobatics' | 'stealth' | 'athletics' => [...keys].sort((left, right) => {
  const leftExpression = skillExpression(sheet, kind, left)
  const rightExpression = skillExpression(sheet, kind, right)
  const leftExpected = leftExpression.count * 3.5 + leftExpression.modifier
  const rightExpected = rightExpression.count * 3.5 + rightExpression.modifier
  return rightExpected - leftExpected || left.localeCompare(right)
})[0]!

const targetPlacementAndSheet = (input: ExecuteCapabilityMechanicInput): {
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
} => {
  const targetId = input.command.selections.targetPlacementIds[0]
  const placement = targetId ? input.map.placements.find(candidate => candidate.id === targetId) : null
  if (!placement) throw new Error('Capability skill challenge requires one authoritative target.')
  const sheet = placement.sheetKind === 'pokemon'
    ? input.pokemonSheets.get(placement.sheetSlug)
    : input.trainerSheets.get(placement.sheetSlug)
  if (!sheet) throw new Error('Capability target sheet is unavailable.')
  return { placement, sheet }
}

const mutationWithCondition = (
  placement: SheetPlacement,
  sheet: CharacterSheet | TrainerSheet,
  condition: string,
): CapabilityMechanicSheetMutation => {
  if (placement.sheetKind === 'pokemon') {
    const current = deepCloneJson(sheet as CharacterSheet)
    const conditions = [...new Set([...(current.combat?.conditions ?? []), condition])]
    return {
      kind: 'pokemon', slug: current.slug, previous: sheet,
      current: { ...current, combat: { ...(current.combat ?? {}), conditions } },
    }
  }
  const current = deepCloneJson(sheet as TrainerSheet)
  return {
    kind: 'trainer', slug: current.slug, previous: sheet,
    current: { ...current, conditions: [...new Set([...(current.conditions ?? []), condition])] },
  }
}

const executeSkillChallenge = (input: ExecuteCapabilityMechanicInput): CapabilityMechanicExecution => {
  if (input.command.actionId === 'distract-with-alluring') {
    const target = targetPlacementAndSheet(input)
    const focus = rollSkill(input, target.sheet, target.placement.sheetKind, 'focus', 'alluring-target-focus')
    if (focus.total >= 12) return {
      map: input.map, sheetMutations: [], rolls: [focus], produced: [], outcome: 'no-op',
      reasonCode: 'capability.alluring.distraction-resisted',
      adjudicationNote: `The Wild Pokémon’s Focus ${focus.total} met DC 12.`,
    }
    const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
    const previous = encounter.turnResources[target.placement.id] ?? createEncounterTurnResourceLedger({
      placementId: target.placement.id,
      round: encounter.history.currentRound ?? input.map.initiative?.round ?? null,
      turn: encounter.history.currentTurn?.placementId === target.placement.id
        ? encounter.history.currentTurn.turn : null,
    })
    const standard = previous.actions.standard
    const canForfeitCurrent = input.map.initiative?.activeId === target.placement.id
      && standard.budget !== null && standard.spent < standard.budget
    const nextLedger = canForfeitCurrent ? {
      ...previous,
      actions: {
        ...previous.actions,
        standard: { ...standard, spent: Math.min(standard.budget!, standard.spent + 1) },
      },
    } : {
      ...previous,
      oncePerTurnFlags: [
        ...previous.oncePerTurnFlags.filter(flag => flag.id !== CAPABILITY_ALLURING_NEXT_TURN_STANDARD_FLAG_ID),
        {
          id: CAPABILITY_ALLURING_NEXT_TURN_STANDARD_FLAG_ID,
          sourceOperationId: input.command.operationId,
          resetOn: ['turn-start' as const],
        },
      ],
    }
    return {
      map: {
        ...input.map,
        encounterState: parseEncounterState({
          ...encounter,
          turnResources: parseEncounterTurnResources({
            ...encounter.turnResources,
            [target.placement.id]: nextLedger,
          }),
        }),
      },
      sheetMutations: [], rolls: [focus], produced: [], outcome: 'applied',
      reasonCode: 'capability.alluring.distraction-applied',
      adjudicationNote: canForfeitCurrent
        ? 'The Wild Pokémon forfeited its current available Standard Action to eat.'
        : 'The Wild Pokémon will forfeit its next Standard Action to eat.',
    }
  }
  if (input.command.actionId === 'read-aura' || input.command.actionId === 'read-dream') {
    const description = input.command.selections.description?.trim()
    if (!description) throw new Error(`${input.command.actionId} requires the retained GM-authored information result.`)
    const summary = input.command.actionId === 'read-aura'
      ? `${input.command.selections.optionId}: ${description}` : description
    const image = /^dream-mist-image:viewers:([A-Za-z0-9._:/-]+(?:,[A-Za-z0-9._:/-]+){0,15})$/.exec(input.command.selections.optionId ?? '')
    const viewers = image?.[1]?.split(',') ?? []
    let map = mapWithPrivateNotice({
      map: input.map,
      operationId: input.command.operationId,
      canonicalId: input.command.canonicalId,
      actionId: input.command.actionId,
      label: input.command.actionId === 'read-aura' ? 'Aura Reading' : image ? 'Dream Mist Image' : 'Dream Reading',
      summary,
      sourcePlacementId: input.actorPlacement.id,
      revealToPlacementIds: [input.actorPlacement.id, ...viewers],
      createdAt: input.now,
    })
    if (input.command.actionId === 'read-dream' && image && input.command.selections.gmConfirmed) {
      const targetId = input.command.selections.targetPlacementIds[0]!
      const evidence = Array.isArray(map.metadata?.capabilityDreamMistSleepEvidence)
        ? map.metadata.capabilityDreamMistSleepEvidence as unknown[] : []
      const retained = evidence.filter((raw) => {
        const record = raw as Record<string, unknown>
        return record?.targetPlacementId !== targetId
          && Number.isSafeInteger(record.expiresAt) && (record.expiresAt as number) > input.now
      })
      map = {
        ...map,
        metadata: {
          ...(map.metadata ?? {}),
          capabilityDreamMistSleepEvidence: [...retained.slice(-127), {
            targetPlacementId: targetId,
            confirmedAt: input.now,
            expiresAt: input.now + 60 * 60_000,
            sourceOperationId: input.command.operationId,
          }],
        },
      }
    }
    return {
      map, sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: `capability.${input.command.actionId}.revealed`,
      adjudicationNote: summary,
    }
  }
  if (input.command.actionId === 'manipulate-object') {
    const match = /^objects:([A-Za-z0-9._:/-]+(?:,[A-Za-z0-9._:/-]+){0,15})$/.exec(input.command.selections.optionId ?? '')
    const ids = match?.[1]?.split(',') ?? []
    const destination = input.command.selections.cells[0]
    if (!ids.length || !destination) throw new Error('Telekinetic object selection is unavailable.')
    const rawObjects = Array.isArray(input.map.metadata?.capabilityObjects)
      ? input.map.metadata.capabilityObjects as unknown[] : []
    const selected = ids.map(id => rawObjects.find(raw => (
      raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).id === id
    )) as Record<string, unknown>)
    if (selected.some(object => !object)) throw new Error('A Telekinetic object disappeared before resolution.')
    const pounds = selected.reduce((total, object) => total + Number(object.pounds), 0)
    const focusPower = skillExpression(input.actorSheet, input.actorPlacement.sheetKind, 'focus').count
      + (input.actorPlacement.sheetKind === 'pokemon'
        && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'TK Mastery') ? 2 : 0)
    const load = resolveCapabilityPowerLoad(focusPower, pounds)
    if (load.loadClass === 'too-heavy') throw new Error('Telekinetic load exceeds Drag Weight.')
    const rolls: CapabilityServerRoll[] = []
    if (load.loadClass === 'staggering') {
      const check = rollSkill(input, input.actorSheet, input.actorPlacement.sheetKind, 'focus', 'telekinetic-staggering-load')
      rolls.push(check)
      if (check.total < 10) return {
        map: input.map, sheetMutations: [], rolls, produced: [], outcome: 'no-op',
        reasonCode: 'capability.telekinetic.staggering-check-failed',
        adjudicationNote: `Focus ${check.total} did not meet DC 10.`,
      }
    }
    const firstPosition = selected[0]!.position as Record<string, unknown>
    const delta = {
      x: destination.x - Number(firstPosition.x),
      y: destination.y - Number(firstPosition.y),
      z: destination.z - Number(firstPosition.z),
    }
    const selectedIds = new Set(ids)
    const moved = rawObjects.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
      const object = raw as Record<string, unknown>
      if (!selectedIds.has(String(object.id))) return raw
      const position = object.position as Record<string, unknown>
      return {
        ...object,
        position: {
          x: Number(position.x) + delta.x,
          y: Number(position.y) + delta.y,
          z: Number(position.z) + delta.z,
        },
        lastCapabilityOperationId: input.command.operationId,
      }
    })
    const residue = load.loadClass === 'drag'
      ? [...(Array.isArray(input.map.metadata?.capabilityPsychicResidue)
          ? input.map.metadata.capabilityPsychicResidue as unknown[] : []), {
          id: `capability-residue:${input.command.operationId}`,
          kind: 'telekinetic-drag', actorPlacementId: input.actorPlacement.id,
          objectIds: ids, createdAt: input.now, sourceOperationId: input.command.operationId,
        }]
      : input.map.metadata?.capabilityPsychicResidue
    return {
      map: {
        ...input.map,
        metadata: {
          ...(input.map.metadata ?? {}),
          capabilityObjects: moved,
          ...(residue ? { capabilityPsychicResidue: residue } : {}),
        },
      },
      sheetMutations: [], rolls, produced: [], outcome: 'applied',
      reasonCode: 'capability.telekinetic.objects-moved',
      adjudicationNote: `${ids.length} object${ids.length === 1 ? '' : 's'} moved using Focus Power ${focusPower}.`,
    }
  }
  if (input.command.actionId === 'track-scent') {
    const selection = parseTrackerScentSelection(input.command.selections.optionId)
    if (!selection?.preyIdentity) throw new Error('Tracker requires an exact GM-retained prey identity.')
    const dc = selection.branch === 'familiar' ? 8
      : selection.branch === 'random' ? 14 : 20
    const trailSnifferBonus = input.actorPlacement.sheetKind === 'pokemon'
      && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'Trail Sniffer')
      ? skillExpression(input.actorSheet, input.actorPlacement.sheetKind, 'focus').count : 0
    const roll = rollSkill(
      input,
      input.actorSheet,
      input.actorPlacement.sheetKind,
      'perception',
      'tracker-perception',
      trailSnifferBonus,
    )
    const success = roll.total >= dc
    const summary = input.command.selections.description?.trim() ?? ''
    const map = success ? mapWithPrivateNotice({
      map: input.map,
      operationId: input.command.operationId,
      canonicalId: input.command.canonicalId,
      actionId: input.command.actionId,
      label: `Scent Trail — ${selection.preyIdentity}`,
      summary,
      sourcePlacementId: input.actorPlacement.id,
      revealToPlacementIds: [input.actorPlacement.id],
      createdAt: input.now,
    }) : input.map
    return {
      map, sheetMutations: [], rolls: [roll], produced: [],
      outcome: success ? 'applied' : 'no-op',
      reasonCode: success ? 'capability.tracker.scent-acquired' : 'capability.tracker.check-failed',
      adjudicationNote: success
        ? `Scent trail for ${selection.preyIdentity} acquired against DC ${dc}.`
        : `Perception ${roll.total} did not meet DC ${dc} for ${selection.preyIdentity}.`,
    }
  }
  const target = targetPlacementAndSheet(input)
  const telepathyPenalty = input.command.actionId === 'read-mind'
    ? runtimeFor(input.map).checkPenalties.filter(penalty => (
        penalty.actorPlacementId === input.actorPlacement.id
        && penalty.targetPlacementId === target.placement.id
        && penalty.canonicalId === 'Telepath'
        && penalty.actionId === 'read-mind'
        && penalty.expiresAt > input.now
      )).reduce((total, penalty) => total + penalty.value, 0)
    : 0
  const willingTelepathyTarget = input.command.actionId === 'read-mind'
    && Array.isArray(input.map.metadata?.capabilityWillingTargets)
    && input.map.metadata.capabilityWillingTargets.includes(`${input.actorPlacement.id}:${target.placement.id}`)
  const unopposedTelepathyTarget = willingTelepathyTarget
    && input.command.selections.optionId === 'aware'
  if (unopposedTelepathyTarget) {
    const summary = input.command.selections.description?.trim()
    if (!summary) throw new Error('A successful Telepathy read requires the retained surface-thought result.')
    let map = mapWithPrivateNotice({
      map: input.map, operationId: input.command.operationId,
      canonicalId: input.command.canonicalId, actionId: input.command.actionId,
      label: 'Surface Thoughts', summary, sourcePlacementId: input.actorPlacement.id,
      revealToPlacementIds: [input.actorPlacement.id], createdAt: input.now,
    })
    if (input.command.selections.optionId === 'aware') map = mapWithPrivateNotice({
      map, operationId: input.command.operationId, noticeIdSuffix: 'target-awareness',
      canonicalId: input.command.canonicalId, actionId: input.command.actionId,
      label: 'Telepathy Awareness', summary: `${input.actorPlacement.id} attempted to read your surface thoughts.`,
      sourcePlacementId: input.actorPlacement.id, revealToPlacementIds: [target.placement.id], createdAt: input.now,
    })
    return {
      map,
      sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.telepath.willing-read-succeeded', adjudicationNote: summary,
    }
  }
  const maneuverId = input.command.actionId === 'telekinetic-maneuver'
    ? input.command.selections.optionId : null
  const maneuverAc = maneuverId === 'push' ? 4
    : maneuverId === 'disarm' || maneuverId === 'trip' ? 6 : null
  const maneuverAccuracyRolls: CapabilityServerRoll[] = []
  if (maneuverAc !== null) {
    const actorToken = physicalLoadProjectedToken(input, input.actorPlacement, input.actorSheet)
    const targetToken = physicalLoadProjectedToken(input, target.placement, target.sheet)
    const statusScript: MoveAutomationScript = {
      ...THREADED_STATUS_SCRIPT,
      moveName: `Telekinetic ${maneuverId}`,
      type: 'Normal',
      ac: maneuverAc,
      range: `${Math.max(1, actorToken.focusSkillRankValue ?? 1)}, 1 Target`,
    }
    const accuracyModifier = moveAutomationUserAccuracy(actorToken, { fieldEffects: input.map.fieldEffects })
      - resolveMoveAutomationTargetEvasion(statusScript, targetToken, {
        attacker: actorToken, fieldEffects: input.map.fieldEffects,
      }).value
    const raw = input.rollDie('telekinetic-maneuver-accuracy', 20)
    const accuracy: CapabilityServerRoll = Object.freeze({
      ...raw,
      expression: `1d20${accuracyModifier === 0 ? '' : accuracyModifier > 0 ? `+${accuracyModifier}` : accuracyModifier}`,
      modifier: accuracyModifier,
      total: raw.total + accuracyModifier,
    })
    maneuverAccuracyRolls.push(accuracy)
    if (!accuracyRollHits(accuracy, maneuverAc)) return {
      map: input.map, sheetMutations: [], rolls: maneuverAccuracyRolls, produced: [], outcome: 'no-op',
      reasonCode: 'capability.telekinetic.maneuver-accuracy-missed',
      adjudicationNote: `Telekinetic ${maneuverId} did not meet AC ${maneuverAc} after authoritative Accuracy and Evasion.`,
    }
  }
  const wielderDisarmBonus = maneuverId === 'disarm'
    && resolveEffectiveCapabilities({
      map: input.map, placement: input.actorPlacement, sheet: input.actorSheet,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    }).instances.some(instance => instance.effective && instance.canonicalId === 'Wielder') ? 2 : 0
  const actorFocus = rollSkill(input, input.actorSheet, input.actorPlacement.sheetKind, 'focus', 'actor-focus', telepathyPenalty + wielderDisarmBonus)
  if (input.command.actionId === 'read-mind') {
    const targetFocus = rollSkill(input, target.sheet, target.placement.sheetKind, 'focus', 'target-focus')
    const success = actorFocus.total > targetFocus.total
    let map = input.map
    if (!success) {
      const runtime = runtimeFor(input.map)
      map = mapWithRuntimeAndEffects(input.map, parseCapabilityRuntimeState({
        ...runtime,
        checkPenalties: [...runtime.checkPenalties.filter(penalty => penalty.expiresAt > input.now), {
          id: `capability.penalty.${input.command.operationId}`,
          actorPlacementId: input.actorPlacement.id,
          targetPlacementId: target.placement.id,
          canonicalId: 'Telepath',
          actionId: 'read-mind',
          value: -3,
          expiresAt: input.now + 24 * 60 * 60_000,
          sourceOperationId: input.command.operationId,
        }],
      }), input.map.encounterState?.effects ?? [])
    }
    if (!willingTelepathyTarget) {
      const previousResidue = Array.isArray(map.metadata?.capabilityPsychicResidue)
        ? map.metadata.capabilityPsychicResidue as unknown[] : []
      map = {
        ...map,
        metadata: {
          ...(map.metadata ?? {}),
          capabilityPsychicResidue: [...previousResidue, {
            id: `capability-residue:${input.command.operationId}`,
            kind: 'telepathy', actorPlacementId: input.actorPlacement.id,
            targetPlacementId: target.placement.id, createdAt: input.now,
            sourceOperationId: input.command.operationId,
          }],
        },
      }
    }
    if (success) {
      const summary = input.command.selections.description?.trim()
      if (!summary) throw new Error('A successful Telepathy read requires the retained surface-thought result.')
      map = mapWithPrivateNotice({
        map, operationId: input.command.operationId,
        canonicalId: input.command.canonicalId, actionId: input.command.actionId,
        label: 'Surface Thoughts', summary, sourcePlacementId: input.actorPlacement.id,
        revealToPlacementIds: [input.actorPlacement.id], createdAt: input.now,
      })
    }
    if (input.command.selections.optionId === 'aware') map = mapWithPrivateNotice({
      map, operationId: input.command.operationId, noticeIdSuffix: 'target-awareness',
      canonicalId: input.command.canonicalId, actionId: input.command.actionId,
      label: 'Telepathy Awareness', summary: `${input.actorPlacement.id} attempted to read your surface thoughts.`,
      sourcePlacementId: input.actorPlacement.id, revealToPlacementIds: [target.placement.id], createdAt: input.now,
    })
    return {
      map, sheetMutations: [], rolls: [actorFocus, targetFocus], produced: [],
      outcome: success ? 'applied' : 'no-op',
      reasonCode: success ? 'capability.telepath.read-succeeded' : 'capability.telepath.read-resisted',
      adjudicationNote: success ? input.command.selections.description : 'The opposed Focus Check resisted Telepathy; a cumulative -3 retry penalty is retained for 24 hours.',
    }
  }
  if (input.command.actionId === 'telekinetic-maneuver') {
    const maneuver = input.command.selections.optionId
    const targetSkill = maneuver === 'trip'
      ? bestOpposedSkill(target.sheet, target.placement.sheetKind, ['combat', 'acrobatics'])
      : maneuver === 'push'
        ? bestOpposedSkill(target.sheet, target.placement.sheetKind, ['combat', 'athletics'])
        : bestOpposedSkill(target.sheet, target.placement.sheetKind, ['combat', 'stealth'])
    const targetRoll = rollSkill(input, target.sheet, target.placement.sheetKind, targetSkill, `target-${targetSkill}`)
    const success = actorFocus.total > targetRoll.total
    if (!success) return {
      map: input.map, sheetMutations: [], rolls: [...maneuverAccuracyRolls, actorFocus, targetRoll], produced: [], outcome: 'no-op',
      reasonCode: 'capability.telekinetic.maneuver-resisted', adjudicationNote: 'The opposed maneuver check was resisted.',
    }
    if (maneuver === 'trip') return {
      map: input.map,
      sheetMutations: [mutationWithCondition(target.placement, target.sheet, 'Tripped')],
      rolls: [...maneuverAccuracyRolls, actorFocus, targetRoll], produced: [], outcome: 'applied',
      reasonCode: 'capability.telekinetic.trip-applied', adjudicationNote: null,
    }
    if (maneuver === 'push') {
      const requestedDistance = Math.floor((
        skillExpression(input.actorSheet, input.actorPlacement.sheetKind, 'focus').count
        + (input.actorPlacement.sheetKind === 'pokemon'
          && hasPokemonCapabilityEdge(input.actorSheet as CharacterSheet, 'TK Mastery') ? 2 : 0)
      ) / 2)
      if (requestedDistance < 1) return {
        map: input.map, sheetMutations: [], rolls: [...maneuverAccuracyRolls, actorFocus, targetRoll], produced: [], outcome: 'no-op',
        reasonCode: 'capability.telekinetic.push-zero-range',
        adjudicationNote: 'Half the user’s effective Focus Rank rounds down to 0 metres.',
      }
      const vector = {
        x: Math.sign(target.placement.position.x - input.actorPlacement.position.x),
        y: Math.sign(target.placement.position.y - input.actorPlacement.position.y),
        z: Math.sign(target.placement.position.z - input.actorPlacement.position.z),
      }
      const displacement = resolveAuthoritativeDisplacement({
        map: input.map,
        sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
        placementId: target.placement.id,
        now: input.now,
        movementMode: 'forced',
        vector,
        requestedDistance,
        distancePolicy: 'up-to-distance',
        ignoredPlacementIds: capabilityLinkedMovementPlacementIds(input, target.placement.id),
      })
      const linkedCompanionPlacementIds = capabilityLinkedMovementPlacementIds(input, target.placement.id)
      const map = displacement.ok
        ? applyAuthoritativeMovementMapTransition({
            map: input.map,
            placementId: target.placement.id,
            destination: displacement.destination,
            distance: displacement.resolvedDistance,
            encounterState: parseEncounterState(input.map.encounterState ?? createEmptyEncounterState()),
            timestamp: input.now,
            userName: input.command.canonicalId,
            linkedCompanionPlacementIds,
            movementEvidence: {
              operationId: input.command.operationId,
              path: displacement.path,
              mode: 'forced',
            },
          }).nextMap
        : input.map
      return {
        map, sheetMutations: [], rolls: [...maneuverAccuracyRolls, actorFocus, targetRoll], produced: [],
        outcome: displacement.ok ? 'applied' : 'no-op',
        reasonCode: displacement.ok ? 'capability.telekinetic.push-applied' : 'capability.telekinetic.push-blocked',
        adjudicationNote: displacement.ok ? null : displacement.message,
      }
    }
    const targetCurrent = deepCloneJson(target.sheet)
    let itemName: string | null = null
    let current: CharacterSheet | TrainerSheet = targetCurrent
    if (target.placement.sheetKind === 'pokemon') {
      itemName = (targetCurrent as CharacterSheet).items?.held?.trim() || null
      current = { ...(targetCurrent as CharacterSheet), items: { ...((targetCurrent as CharacterSheet).items ?? {}), held: '' } }
    }
    else {
      itemName = (targetCurrent as TrainerSheet).equipmentSlots?.mainHand?.trim()
        || (targetCurrent as TrainerSheet).equipmentSlots?.offHand?.trim() || null
      const slots = { ...((targetCurrent as TrainerSheet).equipmentSlots ?? {}) }
      if (slots.mainHand?.trim()) slots.mainHand = ''
      else slots.offHand = ''
      current = { ...(targetCurrent as TrainerSheet), equipmentSlots: slots }
    }
    let disarmedMap = input.map
    if (itemName) {
      const canonicalName = canonicalCapabilityItemName(itemName) ?? itemName
      const canonicalItemId = canonicalCapabilityItemId(canonicalName) || 'disarmed-item'
      const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
      const groundItem = parseMapGroundItem({
        id: `ground.capability-disarm.${createHash('sha256').update(input.command.operationId).digest('hex').slice(0, 32)}`,
        canonicalItemId,
        canonicalItemName: canonicalName,
        quantity: 1,
        position: { ...target.placement.position },
        sourceResource: {
          kind: 'sheet', sheetKind: target.placement.sheetKind,
          slug: target.placement.sheetSlug, revision: normalizeRevision(target.sheet.revision),
        },
        sourceOperationId: capabilityGroundOperationId(input.command.operationId),
        sideId: target.placement.sideId ?? null,
        ownerPlacementId: target.placement.id,
      }, 'capability.telekinetic.disarm.groundItem')
      disarmedMap = {
        ...input.map,
        encounterState: parseEncounterState({ ...encounter, groundItems: [...encounter.groundItems, groundItem] }),
      }
    }
    return {
      map: disarmedMap,
      sheetMutations: itemName ? [{
        kind: target.placement.sheetKind,
        slug: target.placement.sheetSlug,
        previous: target.sheet,
        current,
      }] : [],
      rolls: [...maneuverAccuracyRolls, actorFocus, targetRoll], produced: [], outcome: itemName ? 'applied' : 'no-op',
      reasonCode: itemName ? 'capability.telekinetic.disarm-applied' : 'capability.telekinetic.no-item',
      adjudicationNote: itemName ? `${itemName} was authoritatively removed and fell at the target's cell.` : 'The target had no wielded item to disarm.',
    }
  }
  throw new Error(`Unsupported Capability skill challenge ${input.command.actionId}.`)
}

const executeAdjudication = (input: ExecuteCapabilityMechanicInput): CapabilityMechanicExecution => {
  const choice = input.command.selections.description ?? input.command.selections.optionId
  if (!choice?.trim()) throw new Error('Bounded Capability adjudication requires a retained choice.')
  const previous = Array.isArray(input.map.metadata?.capabilityWorldChanges)
    ? input.map.metadata.capabilityWorldChanges as unknown[] : []
  const retained = {
    id: `capability-world-change:${input.command.operationId}`,
    canonicalId: input.command.canonicalId,
    actionId: input.command.actionId,
    actorPlacementId: input.actorPlacement.id,
    targetPlacementIds: [...input.command.selections.targetPlacementIds],
    cells: input.command.selections.cells.map(cell => ({ ...cell })),
    optionId: input.command.selections.optionId,
    description: input.command.selections.description,
    acceptedAt: input.now,
    sourceOperationId: input.command.operationId,
  }
  let metadata: Record<string, unknown> = {
    ...(input.map.metadata ?? {}),
    capabilityWorldChanges: [...previous.slice(-127), retained],
  }
  if (input.command.actionId === 'manipulate-metal') {
    const match = /^objects:([A-Za-z0-9._:/-]+(?:,[A-Za-z0-9._:/-]+){0,15})$/.exec(input.command.selections.optionId ?? '')
    const objectIds = new Set(match?.[1]?.split(',') ?? [])
    const destination = input.command.selections.cells[0]
    const objects = Array.isArray(input.map.metadata?.capabilityObjects)
      ? input.map.metadata.capabilityObjects as unknown[] : []
    const first = objects.find(raw => raw && typeof raw === 'object' && !Array.isArray(raw)
      && objectIds.has(String((raw as Record<string, unknown>).id))) as Record<string, unknown> | undefined
    const firstPosition = first?.position as Record<string, unknown> | undefined
    if (!destination || !firstPosition) throw new Error('Magnetic manipulation requires retained authoritative objects and destination.')
    const delta = {
      x: destination.x - Number(firstPosition.x),
      y: destination.y - Number(firstPosition.y),
      z: destination.z - Number(firstPosition.z),
    }
    metadata = {
      ...metadata,
      capabilityObjects: objects.map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
        const object = raw as Record<string, unknown>
        if (!objectIds.has(String(object.id))) return raw
        const position = object.position as Record<string, unknown>
        const nextPosition = {
          x: Number(position.x) + delta.x,
          y: Number(position.y) + delta.y,
          z: Number(position.z) + delta.z,
        }
        return {
          ...object,
          position: nextPosition,
          ...(nextPosition.x === input.actorPlacement.position.x
            && nextPosition.y === input.actorPlacement.position.y
            && nextPosition.z === input.actorPlacement.position.z
            ? {
                attachedToPlacementId: input.actorPlacement.id,
                attachedCapabilityInstanceId: input.command.capabilityInstanceId,
                attachedCapabilityCanonicalId: 'Magnetic',
                attachmentKind: 'magnetic',
              }
            : {
                attachedToPlacementId: null,
                attachedCapabilityInstanceId: null,
                attachedCapabilityCanonicalId: null,
                attachmentKind: null,
              }),
          lastCapabilityOperationId: input.command.operationId,
        }
      }),
    }
  }
  if (input.command.actionId === 'sprout') {
    const berry = /^berry-yield:item:([^;]{1,100});qty:(\d{1,2})$/.exec(input.command.selections.optionId ?? '')
    if (berry) {
      const itemName = canonicalPtuBerryName(berry[1]!)
      const quantity = Number(berry[2])
      if (!itemName || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
        throw new Error('The retained Sprouter Berry yield is invalid.')
      }
      const recipient = recipientTrainer(input)
      return {
        map: { ...input.map, metadata },
        sheetMutations: [{
          kind: 'trainer', slug: recipient.slug, previous: recipient,
          current: withTrainerItem(recipient, itemName, input.command.operationId, quantity),
        }],
        rolls: [],
        produced: [{ kind: 'item', canonicalId: itemName, quantity, recipientSheetSlug: recipient.slug }],
        outcome: 'applied', reasonCode: 'capability.sprouter.berry-yield', adjudicationNote: choice,
      }
    }
  }
  return {
    map: {
      ...input.map,
      metadata,
    },
    sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
    reasonCode: 'capability.bounded-adjudication-accepted', adjudicationNote: choice,
  }
}

const executeCampaignTask = (input: ExecuteCapabilityMechanicInput): CapabilityMechanicExecution => {
  if (input.actorPlacement.sheetKind !== 'pokemon') throw new Error('This Capability campaign operation requires a Pokémon actor.')
  const previous = input.actorSheet as CharacterSheet
  const state = parseCapabilityCampaignState(previous.capabilityCampaignState ?? createEmptyCapabilityCampaignState())

  if (input.command.actionId === 'synchronize-keystone') {
    const keystoneId = input.command.selections.canonicalItemId
    if (!keystoneId) throw new Error('Odd Keystone synchronization requires an exact resource ID.')
    const keystones = Array.isArray(input.map.metadata?.capabilityKeystones)
      ? input.map.metadata.capabilityKeystones as unknown[] : []
    let matched = false
    const nextKeystones = keystones.map((raw) => {
      const keystone = raw as Record<string, unknown>
      if (keystone?.id !== keystoneId || !Array.isArray(keystone.synchronizedPlacementIds)
        || keystone.synchronizedPlacementIds.includes(input.actorPlacement.id)) return raw
      matched = true
      return {
        ...keystone,
        synchronizedPlacementIds: [...keystone.synchronizedPlacementIds, input.actorPlacement.id],
        lastCapabilityOperationId: input.command.operationId,
      }
    })
    if (!matched) throw new Error('The Odd Keystone synchronization resource disappeared.')
    const spent = Math.max(0, previous.tutorPoints?.spent ?? 0)
    const current: CharacterSheet = {
      ...deepCloneJson(previous),
      tutorPoints: { ...(previous.tutorPoints ?? {}), spent: spent + 2 },
      capabilityCampaignState: parseCapabilityCampaignState({
        ...state,
        keystoneSynchronizations: [
          ...state.keystoneSynchronizations.filter(entry => entry.keystoneId !== keystoneId),
          { keystoneId, synchronizedAt: input.now, sourceOperationId: input.command.operationId },
        ],
      }),
    }
    return {
      map: { ...input.map, metadata: { ...(input.map.metadata ?? {}), capabilityKeystones: nextKeystones } },
      sheetMutations: [{ kind: 'pokemon', slug: previous.slug, previous, current }],
      rolls: [], produced: [], outcome: 'applied', reasonCode: 'capability.keystone-warp.synchronized',
      adjudicationNote: `${keystoneId} was synchronized for 2 Tutor Points.`,
    }
  }

  if (input.command.actionId === 'consume-juicer-shell-juice-as-snack') {
    const materialized = materializeJuicerSheetAtTime(previous, input.now)
    const materializedState = parseCapabilityCampaignState(materialized.capabilityCampaignState)
    const stored = juicerShellJuice(materialized, input.now)
    if (!stored) throw new Error('The exact Shuckle’s Berry Juice shell item is unavailable.')
    let current = withJuicerShellJuiceSnack({
      map: input.map, placement: input.actorPlacement, sheet: materialized, now: input.now,
    })
    if (juicerHeldItemIsLegacyShellMirror(materializedState, materialized.items?.held)) {
      current = { ...current, items: { ...(current.items ?? {}), held: '' } }
    }
    current = {
      ...current,
      capabilityCampaignState: parseCapabilityCampaignState({
        ...materializedState,
        storedItems: materializedState.storedItems.filter(item => item.id !== stored.id),
      }),
    }
    return {
      map: input.map,
      sheetMutations: [{ kind: 'pokemon', slug: previous.slug, previous, current }],
      rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.juicer.shell-juice-consumed-as-snack',
      adjudicationNote: 'Shuckle consumed its exact shell juice as a Snack and stored the Shuckle’s Berry Juice Digestion Buff.',
    }
  }

  if (input.command.actionId === 'collect-juicer-output') {
    const materialized = materializeJuicerSheetAtTime(previous, input.now)
    const materializedState = parseCapabilityCampaignState(materialized.capabilityCampaignState)
    const stored = juicerShellOutput(materialized, input.now)
    const outputName = stored ? juicerShellItemName(stored.canonicalItemId) : null
    if (!stored || !outputName) throw new Error('The exact mature Juicer shell item is unavailable.')
    const output = itemOutput(input, outputName, {
      canonicalItemId: stored.canonicalItemId,
      requireExplicitRecipient: true,
      section: stored.stage === 'berry-juice' ? 'foodStuff' : 'pokemonItems',
    })
    let current: CharacterSheet = {
      ...deepCloneJson(materialized),
      capabilityCampaignState: parseCapabilityCampaignState({
        ...materializedState,
        storedItems: materializedState.storedItems.filter(item => item.id !== stored.id),
      }),
    }
    if (juicerHeldItemIsLegacyShellMirror(materializedState, materialized.items?.held)) {
      current = { ...current, items: { ...(current.items ?? {}), held: '' } }
    }
    return {
      map: input.map,
      sheetMutations: [
        { kind: 'pokemon', slug: previous.slug, previous, current },
        output.mutation,
      ],
      rolls: [], produced: [output.produced], outcome: 'applied',
      reasonCode: 'capability.juicer.output-collected',
      adjudicationNote: `${outputName} was removed from the shell and added to the explicitly linked Trainer inventory.`,
    }
  }

  if (input.command.actionId === 'plant') {
    if (state.planter) throw new Error('This Planter already contains a plant.')
    const selectedInput = input.command.selections.canonicalItemId
    const selectedPlant = input.command.selections.optionId ?? input.command.selections.description
    const inputItem = selectedInput ? canonicalCapabilityItemName(selectedInput) : null
    const planted = selectedPlant ? canonicalCapabilityItemName(selectedPlant) : null
    if (!inputItem || !planted) throw new Error('Planter requires canonical seed/input and planted item identities.')
    if ((previous.items?.held ?? '').trim().toLocaleLowerCase('en-US') !== inputItem.toLocaleLowerCase('en-US')) {
      throw new Error('The Planter actor is not authoritatively holding the selected seed or plant item.')
    }
    const current: CharacterSheet = {
      ...deepCloneJson(previous),
      items: { ...(previous.items ?? {}), held: '' },
      capabilityCampaignState: parseCapabilityCampaignState({
        ...state,
        planter: {
          id: `capability.planter.${input.actorPlacement.id}`,
          inputCanonicalItemId: inputItem,
          plantedCanonicalId: planted,
          plantedAt: input.now,
          sourceOperationId: input.command.operationId,
        },
      }),
    }
    return {
      map: input.map,
      sheetMutations: [{ kind: 'pokemon', slug: previous.slug, previous, current }],
      rolls: [], produced: [], outcome: 'applied', reasonCode: 'capability.planter.planted',
      adjudicationNote: `The Planter now authoritatively holds ${planted}.`,
    }
  }

  if (input.command.actionId === 'harvest') {
    if (!state.planter) throw new Error('This Planter has no authoritative plant to harvest.')
    const selectedHarvest = input.command.selections.optionId ?? input.command.selections.description ?? state.planter.plantedCanonicalId
    const harvested = canonicalCapabilityItemName(selectedHarvest)
    if (!harvested) throw new Error('Planter harvest requires a canonical retained inventory item.')
    const output = itemOutput(input, harvested)
    const actorCurrent: CharacterSheet = {
      ...deepCloneJson(previous),
      capabilityCampaignState: parseCapabilityCampaignState({ ...state, planter: null }),
    }
    return {
      map: input.map,
      sheetMutations: [
        { kind: 'pokemon', slug: previous.slug, previous, current: actorCurrent },
        output.mutation,
      ],
      rolls: [], produced: [output.produced], outcome: 'applied', reasonCode: 'capability.planter.harvested',
      adjudicationNote: `The GM-confirmed ${harvested} yield was committed and the Planter was emptied.`,
    }
  }

  if (input.command.actionId === 'tutor-cube-move') {
    const moveName = input.command.selections.canonicalItemId
    const move = moveName ? findMove(moveName) : null
    if (!move) throw new Error('Zygarde Cube tutoring requires a canonical Move identity.')
    const earned = computePokemonTutorPointsEarnedForSheet(previous)
    const spent = Math.max(0, previous.tutorPoints?.spent ?? 0)
    if (earned - spent < 1) throw new Error('Zygarde Cube tutoring requires 1 available Tutor Point.')
    if ([...(previous.movelist ?? []), ...(previous.appliedMoves ?? [])].some(entry => entry.name === move.name)) {
      throw new Error(`${move.name} is already present on the Pokémon’s Move List.`)
    }
    const learned: CharacterSheetAppliedMove = {
      name: move.name,
      type: move.type,
      ...(move.frequency ? { frequency: move.frequency } : {}),
      ...(move.ac != null ? { ac: move.ac } : {}),
      ...(move.damage_base != null ? { db: move.damage_base } : {}),
      ...(move.damage_roll ? { damageRoll: move.damage_roll } : {}),
      ...(move.damage_class === 'Physical' || move.damage_class === 'Special' || move.damage_class === 'Status'
        ? { category: move.damage_class } : {}),
      ...(move.range ? { range: move.range } : {}),
      ...(move.effect ? { effect: move.effect } : {}),
      ...(move.special ? { special: move.special } : {}),
      source: 'tutor',
    }
    const current: CharacterSheet = {
      ...deepCloneJson(previous),
      tutorPoints: { ...(previous.tutorPoints ?? {}), spent: spent + 1 },
      appliedMoves: [...(previous.appliedMoves ?? []), learned],
    }
    return {
      map: input.map,
      sheetMutations: [{ kind: 'pokemon', slug: previous.slug, previous, current }],
      rolls: [], produced: [], outcome: 'applied', reasonCode: 'capability.zygarde-cube.move-tutored',
      adjudicationNote: `${move.name} was added as a Tutor Move for 1 TP.`,
    }
  }

  throw new Error(`Unsupported Capability campaign operation ${input.command.actionId}.`)
}

export const executeCapabilityMechanic = (
  input: ExecuteCapabilityMechanicInput,
): CapabilityMechanicExecution => {
  if (capabilityActionDelegatesToCampaignAggregate(input.command.canonicalId, input.command.actionId)) {
    throw new Error(CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATION_MESSAGE)
  }
  if (input.action.mechanic === 'toggle-mode') return input.command.actionId === 'ready-light-shield'
    ? {
        map: readyLivingWeaponLightShield(input), sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
        reasonCode: 'capability.living-weapon.light-shield-readied', adjudicationNote: null,
      }
    : {
        map: applyToggle(input), sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
        reasonCode: 'capability.mode-changed', adjudicationNote: null,
      }
  if (input.action.mechanic === 'link-actors') {
    if (input.command.actionId === 'combine-unown') return executeLetterPress(input)
    if (input.command.actionId === 'assemble-zygarde' || input.command.actionId === 'disassemble-zygarde') {
      return executeZygardeAssemblyAction(input)
    }
    if (input.command.actionId === 'shelter-baby') {
      const babyPlacement = input.map.placements.find(placement => (
        placement.id === input.command.selections.targetPlacementIds[0] && placement.sheetKind === 'pokemon'
      ))
      const baby = babyPlacement ? input.pokemonSheets.get(babyPlacement.sheetSlug) : null
      if (!babyPlacement || !baby) throw new Error('The Marsupial baby disappeared before shelter was established.')
      const mother = input.actorSheet as CharacterSheet
      const experienceSharePercent = input.command.selections.optionId === 'experience-share:20' ? 20 as const : 0 as const
      const pouch = {
        motherSheetSlug: mother.slug,
        babySheetSlug: baby.slug,
        experienceSharePercent,
        establishedAt: input.now,
        sourceOperationId: input.command.operationId,
      }
      const motherState = parseCapabilityCampaignState(mother.capabilityCampaignState)
      const babyState = parseCapabilityCampaignState(baby.capabilityCampaignState)
      const motherCurrent: CharacterSheet = {
        ...deepCloneJson(mother),
        capabilityCampaignState: parseCapabilityCampaignState({ ...motherState, marsupialPouch: pouch }),
      }
      const babyCurrent: CharacterSheet = {
        ...deepCloneJson(baby),
        capabilityCampaignState: parseCapabilityCampaignState({ ...babyState, marsupialPouch: pouch }),
      }
      return {
        map: applyLink(input),
        sheetMutations: [
          { kind: 'pokemon', slug: mother.slug, previous: mother, current: motherCurrent },
          { kind: 'pokemon', slug: baby.slug, previous: baby, current: babyCurrent },
        ],
        rolls: [], produced: [], outcome: 'applied',
        reasonCode: 'capability.marsupial.pouch-established',
        adjudicationNote: input.command.selections.optionId === 'experience-share:20'
          ? 'The mother shelters the baby and transfers 20% of future Experience awards.'
          : 'The mother shelters the baby without Experience transfer.',
      }
    }
    return {
      map: applyLink(input), sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.link-changed', adjudicationNote: null,
    }
  }
  if (input.action.mechanic === 'shape-terrain') return {
    map: shapeGround(input), sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
    reasonCode: 'capability.terrain-shaped', adjudicationNote: null,
  }
  if (input.action.mechanic === 'movement-request') {
    if (input.command.actionId === 'threaded-shift') return executeThreadedShift(input)
    if (input.command.actionId === 'jump') return executeJump(input)
    if (input.command.actionId === 'reposition-illusion') return {
      map: repositionIllusion(input), sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.illusion.repositioned', adjudicationNote: null,
    }
    return {
      map: relocate(input), sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.movement-resolved', adjudicationNote: null,
    }
  }
  if (input.action.mechanic === 'physical-load') return executePhysicalPowerLoad(input)
  if (input.action.mechanic === 'produce-item') return executeProduction(input)
  if (input.action.mechanic === 'resolve-roll') return executeRoll(input)
  if (input.action.mechanic === 'skill-challenge') return executeSkillChallenge(input)
  if (input.action.mechanic === 'campaign-time') return executeCampaignTask(input)
  if (input.action.mechanic === 'adjudication') return executeAdjudication(input)
  if (input.action.mechanic === 'communication') {
    const summary = input.command.selections.description?.trim()
    if (!summary) throw new Error('Capability communication requires a bounded private payload.')
    const recipients = input.command.selections.targetPlacementIds
    return {
      map: mapWithPrivateNotice({
        map: input.map, operationId: input.command.operationId,
        canonicalId: input.command.canonicalId, actionId: input.command.actionId,
        label: input.command.canonicalId === 'Aura Pulse'
          ? input.command.selections.optionId === 'exchange-surface-thoughts' ? 'Aura Surface-Thought Exchange' : 'Aura Message'
          : 'Telepathic Message',
        summary, sourcePlacementId: input.actorPlacement.id,
        revealToPlacementIds: [input.actorPlacement.id, ...recipients], createdAt: input.now,
      }),
      sheetMutations: [], rolls: [], produced: [], outcome: 'applied',
      reasonCode: 'capability.communication-projected', adjudicationNote: summary,
    }
  }
  throw new Error(`Capability action ${input.command.canonicalId}/${input.command.actionId} has no native mechanic.`)
}
