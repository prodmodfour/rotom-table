import type { AuthRole } from '#shared/auth'
import {
  CAPABILITY_AUTOMATION_RULESET_ID,
} from '#shared/capabilityAutomation/ruleset'
import type {
  CapabilityClientActionOffer,
  CapabilityClientCapabilityBundle,
  CapabilityClientFact,
  PlacementCapabilityClientBundle,
} from '#shared/capabilityAutomation/clientCapabilities'
import type { CapabilityUsageEntry } from '#shared/capabilityAutomation/state'
import { parseCapabilityCampaignState } from '#shared/capabilityAutomation/campaignState'
import type { PlayerProfile } from '#shared/playerProfiles'
import { encounterPresentationStableId } from '#shared/encounterPresentation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet, TrainerInventory } from '~/types/trainerSheet'
import {
  actorControlledMapPlacementIds,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../../policies/playerProfileTokenControlPolicy'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from './registry'
import { computePokemonTutorPointsEarnedForSheet } from '~/utils/sheets/pokemonTutorPoints'
import { resolveSkills } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { hasPokemonCapabilityEdge } from '#shared/capabilityAutomation/pokemonEdges'
import {
  resolvePackMonDisposition,
  resolvePremonitionBand,
  tremorsenseCanResolve,
  xRayVisionCanPenetrate,
} from './passiveProviders'
import {
  juicerCanConsumeShellJuiceAsSnack,
  juicerOfferAuthorityIdentity,
  juicerShellOutput,
  pokemonHasAuthoritativeJuicerIdentity,
} from './juicer'
import {
  teleporterRoundIdentity,
  teleporterRoundUseSpent,
} from './teleporterRoundUse'

export interface BuildCapabilityClientCapabilityBundleInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly now?: number
}

const capabilitySelectionOptions = (
  map: TabletopMap,
  actionId: string,
  placement: SheetPlacement,
  actorLinkedTrainers: readonly TrainerSheet[],
  contexts: ReadonlySet<string>,
): CapabilityClientActionOffer['selectionOptions'] => {
  if (actionId === 'collect-juicer-output') {
    return Object.freeze(actorLinkedTrainers
      .map(trainer => Object.freeze({ kind: 'trainer' as const, value: trainer.slug, label: trainer.name || trainer.slug }))
      .sort((left, right) => left.label.localeCompare(right.label)))
  }
  const source = actionId === 'manipulate-object' || actionId === 'manipulate-metal' || actionId === 'threaded-shift'
    ? { key: 'capabilityObjects', kind: 'object' as const }
    : actionId === 'enter-machine' || actionId === 'exit-machine'
      ? { key: 'capabilityDevices', kind: 'device' as const }
      : actionId === 'synchronize-keystone'
        ? { key: 'capabilityKeystones', kind: 'keystone' as const }
        : actionId === 'warm-egg' ? { key: 'capabilityEggs', kind: 'egg' as const } : null
  const values = source ? (map.metadata as Record<string, unknown> | undefined)?.[source.key] : null
  if (!source || !Array.isArray(values)) return Object.freeze([])
  const linkedTrainerSlugs = new Set(actorLinkedTrainers.map(trainer => trainer.slug))
  return Object.freeze(values.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const resource = raw as Record<string, unknown>
    if (source.kind === 'keystone') {
      const ownerTrainerSlug = typeof resource.ownerTrainerSlug === 'string' ? resource.ownerTrainerSlug : null
      if (ownerTrainerSlug !== null ? !linkedTrainerSlugs.has(ownerTrainerSlug)
        : !contexts.has(`keystone-access:${placement.id}:${String(resource.id)}`.toLocaleLowerCase('en-US'))) return []
    }
    if (typeof resource.id !== 'string' || !/^[A-Za-z0-9._:/-]{1,160}$/.test(resource.id)) return []
    const descriptor = typeof resource.name === 'string' && resource.name.trim()
      ? resource.name.trim() : typeof resource.material === 'string' && resource.material.trim()
        ? resource.material.trim() : source.kind[0]!.toUpperCase() + source.kind.slice(1)
    return [Object.freeze({
      kind: source.kind,
      value: resource.id,
      label: `${descriptor.slice(0, 80)} (${resource.id})`.slice(0, 120),
    })]
  }).slice(0, 64))
}

const normalizedContexts = (map: TabletopMap): ReadonlySet<string> => {
  const raw = map.metadata?.capabilityContexts
  return new Set(Array.isArray(raw) ? raw.flatMap(value => (
    typeof value === 'string' && value.trim() ? [value.trim().toLocaleLowerCase('en-US')] : []
  )) : [])
}

const modeFor = (
  map: TabletopMap,
  placementId: string,
  modes: readonly string[],
  now: number,
  effectiveInstanceIds?: ReadonlySet<string>,
): boolean => (map.encounterState?.capabilityRuntime?.modes ?? []).some(mode => (
  mode.actorPlacementId === placementId
  && modes.includes(mode.mode)
  && (effectiveInstanceIds === undefined || effectiveInstanceIds.has(mode.capabilityInstanceId))
  && (mode.expiresAt === null || mode.expiresAt > now)
))

const linkFor = (
  map: TabletopMap,
  placementId: string,
  kinds: readonly string[],
  effectiveInstanceIds?: ReadonlySet<string>,
): boolean => (map.encounterState?.capabilityRuntime?.links ?? []).some(link => (
  link.ownerPlacementId === placementId && kinds.includes(link.kind)
  && (effectiveInstanceIds === undefined || effectiveInstanceIds.has(link.capabilityInstanceId))
))

const placementDistance = (left: SheetPlacement, right: SheetPlacement): number => Math.max(
  Math.abs(left.position.x - right.position.x),
  Math.abs(left.position.y - right.position.y),
  Math.abs(left.position.z - right.position.z),
)

const allInventoryEntries = (inventory: TrainerInventory | undefined): readonly { readonly name: string; readonly qty?: number }[] => [
  ...(inventory?.keyItems ?? []), ...(inventory?.pokemonItems ?? []),
  ...(inventory?.medicalKit ?? []), ...(inventory?.pokeBalls ?? []),
  ...(inventory?.foodStuff ?? []), ...(inventory?.equipment ?? []),
]

const trainerHasItem = (sheet: TrainerSheet, name: string): boolean => allInventoryEntries(sheet.inventory)
  .some(entry => entry.name.trim().toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US') && (entry.qty ?? 1) > 0)

const linkedTrainers = (
  placement: SheetPlacement,
  sheet: CharacterSheet | TrainerSheet,
  trainers: readonly TrainerSheet[],
): readonly TrainerSheet[] => placement.sheetKind === 'trainer'
  ? [sheet as TrainerSheet]
  : trainers.filter(trainer => (trainer.currentTeam ?? []).includes(placement.sheetSlug)
    || (trainer.boxedPokemon ?? []).includes(placement.sheetSlug))

const hasSleepingTarget = (
  map: TabletopMap,
  actor: SheetPlacement,
  pokemonBySlug: ReadonlyMap<string, CharacterSheet>,
  trainerBySlug: ReadonlyMap<string, TrainerSheet>,
): boolean => map.placements.some(placement => {
  if (placement.id === actor.id) return false
  const conditions = placement.sheetKind === 'pokemon'
    ? pokemonBySlug.get(placement.sheetSlug)?.combat?.conditions
    : trainerBySlug.get(placement.sheetSlug)?.conditions
  return (conditions ?? []).some(condition => /^sleep(?:ing|ed)?$/i.test(condition.trim()))
})

const explicitContext = (contexts: ReadonlySet<string>, context: string): boolean => (
  contexts.has(context.toLocaleLowerCase('en-US'))
  || contexts.has(`capability.${context.toLocaleLowerCase('en-US')}`)
)

const contextSatisfied = (input: {
  readonly context: string
  readonly canonicalId: string
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly linkedTrainers: readonly TrainerSheet[]
  readonly pokemonBySlug: ReadonlyMap<string, CharacterSheet>
  readonly trainerBySlug: ReadonlyMap<string, TrainerSheet>
  readonly contexts: ReadonlySet<string>
  readonly now: number
  readonly effectiveInstanceIds: ReadonlySet<string>
}): boolean => {
  const { context, map, placement } = input
  const activeScene = Boolean(map.activeScene)
  const otherPlacements = map.placements.filter(candidate => candidate.id !== placement.id)
  const adjacent = otherPlacements.some(candidate => placementDistance(placement, candidate) <= 1)
  const mode = (modes: readonly string[]) => modeFor(map, placement.id, modes, input.now, input.effectiveInstanceIds)
  const link = (kinds: readonly string[]) => linkFor(map, placement.id, kinds, input.effectiveInstanceIds)
  const contextual = explicitContext(input.contexts, context)
  const alluringLureTask = (map.encounterState?.capabilityRuntime?.tasks ?? []).find(task => (
    task.kind === 'alluring-lure'
    && task.actorPlacementId === placement.id
    && task.canonicalId === 'Alluring'
    && input.effectiveInstanceIds.has(task.capabilityInstanceId)
  ))
  const synchronizedKeystoneIds = placement.sheetKind === 'pokemon'
    ? new Set(parseCapabilityCampaignState((input.sheet as CharacterSheet).capabilityCampaignState)
        .keystoneSynchronizations.map(entry => entry.keystoneId))
    : new Set<string>()
  switch (context) {
    case 'encounter': return activeScene
    case 'exploration': return !activeScene || contextual
    case 'communication-target':
    case 'living-target': return otherPlacements.length > 0
    case 'wild-target': {
      const wildIds = new Set(Array.isArray(map.metadata?.capabilityWildPlacementIds)
        ? map.metadata.capabilityWildPlacementIds.filter((id): id is string => typeof id === 'string') : [])
      return otherPlacements.some(candidate => wildIds.has(candidate.id))
    }
    case 'communication-targets': {
      const expression = placement.sheetKind === 'pokemon'
        ? resolveSkills(input.sheet as CharacterSheet).find(skill => skill.key === 'focus')?.value
        : resolveTrainerSkills(input.sheet as TrainerSheet).find(skill => skill.key === 'focus')?.dice
      const rank = Number.parseInt(/^(\d+)d6/i.exec(expression ?? '')?.[1] ?? '1', 10)
      return otherPlacements.length > 0 && rank >= 2
    }
    case 'sleeping-target': return hasSleepingTarget(map, placement, input.pokemonBySlug, input.trainerBySlug)
    case 'adjacent-willing-mount': return adjacent && !link(['as-one-mount'])
    case 'adjacent-willing-rider': return adjacent
    case 'adjacent-willing-wielder': return adjacent && !link(['living-weapon'])
    case 'adjacent-willing-baby-target': return placement.sheetKind === 'pokemon'
      && (input.sheet as CharacterSheet).species.trim().toLocaleLowerCase('en-US') === 'kangaskhan'
      && !link(['marsupial-pouch'])
      && otherPlacements.some((candidate) => {
        if (placementDistance(placement, candidate) > 1 || candidate.sheetKind !== 'pokemon') return false
        const baby = input.pokemonBySlug.get(candidate.sheetSlug)
        return baby?.species.trim().toLocaleLowerCase('en-US') === 'kangaskhan'
          && (baby.level ?? 0) < 25
          && !(map.encounterState?.capabilityRuntime?.links ?? []).some(entry => (
            entry.kind === 'marsupial-pouch' && entry.participantPlacementIds.includes(candidate.id)
          ))
      })
    case 'mounted': return link(['as-one-mount'])
    case 'carrying-rider': return link(['mount-rider'])
    case 'wielded': return link(['living-weapon'])
    case 'bonded': return link(['viral-fusion'])
    case 'adjacent-release-cell': {
      const expectedKind = input.canonicalId === 'As One' ? 'as-one-mount'
        : input.canonicalId === 'Living Weapon' ? 'living-weapon'
          : input.canonicalId === 'Viral Fusion' ? 'viral-fusion'
            : input.canonicalId === 'Shadow Meld' ? 'shadow-rider' : ''
      return Boolean(expectedKind) && link([expectedKind])
    }
    case 'linked-rider-and-adjacent-cell': return link(['mount-rider'])
    case 'normal-form': return activeScene && !mode(['inflated', 'shrunken'])
    case 'inflated': return mode(['inflated'])
    case 'shrunken': return mode(['shrunken'])
    case 'tangible': return activeScene && !mode(['intangible'])
    case 'intangible': return mode(['intangible'])
    case 'shadow-melded': return mode(['shadow-melded'])
    case 'adjacent-living-shadow': return mode(['shadow-melded']) && adjacent && !link(['shadow-rider'])
    case 'shadow-riding': return link(['shadow-rider'])
    case 'shapechanged': return mode(['shapechanged'])
    case 'close-examination-target': return mode(['shapechanged'])
      && Array.isArray(map.metadata?.capabilityCloseExaminations)
      && map.metadata.capabilityCloseExaminations.some(raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
        const examination = raw as Record<string, unknown>
        return examination.subjectPlacementId === placement.id
          && typeof examination.examinerPlacementId === 'string'
          && otherPlacements.some(candidate => candidate.id === examination.examinerPlacementId)
      })
    case 'not-glowing': return !mode(['glowing'])
    case 'glowing': return mode(['glowing'])
    case 'glowing-nearby-wilds': return mode(['glowing']) && contextual
    case 'owned-illusion': return mode(['illusion'])
    case 'moving-illusion': return (map.encounterState?.capabilityRuntime?.modes ?? []).some(entry => (
      entry.actorPlacementId === placement.id
      && entry.mode === 'illusion'
      && input.effectiveInstanceIds.has(entry.capabilityInstanceId)
      && (entry.expiresAt === null || entry.expiresAt > input.now)
      && /(?:^|;)motion:(?:minor|major)$/.test(entry.configurationId ?? '')
    ))
    case 'inside-machine': return mode(['inside-machine'])
    case 'crowned-form': return mode(['crowned'])
    case 'power-construct-zygarde': return Array.isArray(map.metadata?.capabilityZygardeAssemblies)
      && map.metadata.capabilityZygardeAssemblies.some(raw => {
        const state = raw as Record<string, unknown>
        return state?.actorPlacementId === placement.id && state.powerConstruct === true
          && input.linkedTrainers.some(trainer => trainer.slug === state.trainerSlug
            && trainerHasItem(trainer, 'Zygarde Cube'))
      })
    case 'visible-and-ready': {
      const lastInvisible = [...(map.encounterState?.capabilityRuntime?.modes ?? [])].reverse().find(entry => (
        entry.actorPlacementId === placement.id
        && entry.mode === 'invisible'
        && input.effectiveInstanceIds.has(entry.capabilityInstanceId)
      ))
      const automaticCooldownUntil = lastInvisible?.expiresAt !== null && lastInvisible?.expiresAt !== undefined
        && input.now >= lastInvisible.expiresAt
        ? lastInvisible.expiresAt + 2 * 60_000 + Math.max(0, lastInvisible.expiresAt - lastInvisible.activatedAt)
        : null
      return !mode(['invisible'])
        && (automaticCooldownUntil === null || input.now >= automaticCooldownUntil)
        && !usageActive(input.sheet.capabilityUsage?.entries ?? [], input.canonicalId, 'become-invisible', input.now)
    }
    case 'invisible': return mode(['invisible'])
    case 'darkness': return contextual
    case 'lit-surface-shadow': return contextual
    case 'collection-jar': return input.linkedTrainers.some(trainer => trainerHasItem(trainer, 'Collection Jar'))
    case 'item-recipient': return input.linkedTrainers.length > 0
    case 'stored-juicer-juice': return input.placement.sheetKind === 'pokemon'
      && pokemonHasAuthoritativeJuicerIdentity(input.sheet as CharacterSheet)
      && juicerCanConsumeShellJuiceAsSnack({
        map: input.map,
        placement: input.placement,
        sheet: input.sheet as CharacterSheet,
        now: input.now,
      })
    case 'stored-juicer-output': return input.placement.sheetKind === 'pokemon'
      && pokemonHasAuthoritativeJuicerIdentity(input.sheet as CharacterSheet)
      && input.linkedTrainers.length > 0
      && juicerShellOutput(input.sheet as CharacterSheet, input.now) !== null
    case 'empty-planter-and-seed': return input.placement.sheetKind === 'pokemon'
      && !(input.sheet as CharacterSheet).capabilityCampaignState?.planter
      && Boolean((input.sheet as CharacterSheet).items?.held?.trim())
    case 'yielding-planter': return input.placement.sheetKind === 'pokemon'
      && Boolean((input.sheet as CharacterSheet).capabilityCampaignState?.planter)
      && contextual
    case 'ancestral-weapon': return input.placement.sheetKind === 'pokemon'
      && /ancestral (?:sword|shield)/i.test((input.sheet as CharacterSheet).items?.held ?? '')
    case 'delta-mega-ready': {
      if (!activeScene || mode(['mega-evolved']) || input.placement.sheetKind !== 'pokemon'
        || !(input.sheet as CharacterSheet).species.toLocaleLowerCase('en-US').includes('rayquaza')
        || ![...((input.sheet as CharacterSheet).movelist ?? []), ...((input.sheet as CharacterSheet).appliedMoves ?? [])]
          .some(move => move.name.trim().toLocaleLowerCase('en-US') === 'dragon ascent')) return false
      const sceneStartedAt = map.activeScene?.startedAt
      if (!Number.isSafeInteger(sceneStartedAt) || (sceneStartedAt ?? -1) < 0) return false
      const uses = Array.isArray(map.metadata?.capabilityMegaEvolutionUses)
        ? map.metadata.capabilityMegaEvolutionUses as unknown[] : []
      return input.linkedTrainers.some(trainer => (
        trainer.equipmentSlots?.accessory?.trim().toLocaleLowerCase('en-US') === 'mega ring'
        && !uses.some(raw => {
          const use = raw as Record<string, unknown>
          return use?.trainerSlug === trainer.slug && use.sceneStartedAt === sceneStartedAt
        })
      ))
    }
    case 'jump-destination-cell': return true
    case 'teleport-destination-cell': {
      try {
        const identity = teleporterRoundIdentity(map)
        return identity === null || !teleporterRoundUseSpent({
          map,
          placementId: placement.id,
          identity,
        })
      }
      catch {
        return false
      }
    }
    case 'cardinal-ground-cells': return map.voxels.some(voxel => (
      Math.abs(voxel.x - placement.position.x) + Math.abs(voxel.z - placement.position.z) === 1
    ))
    case 'anchor-or-target-in-4m': {
      const range = placement.sheetKind === 'pokemon'
        && hasPokemonCapabilityEdge(input.sheet as CharacterSheet, 'Precise Threadings') ? 6 : 4
      return map.voxels.some(voxel => Math.max(
        Math.abs(voxel.x - placement.position.x), Math.abs(voxel.y - placement.position.y), Math.abs(voxel.z - placement.position.z),
      ) <= range) || otherPlacements.some(candidate => placementDistance(placement, candidate) <= range)
      || (Array.isArray(map.metadata?.capabilityObjects) && map.metadata.capabilityObjects.some(raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
        const position = (raw as Record<string, unknown>).position as Record<string, unknown> | undefined
        return Number.isSafeInteger(position?.x) && Number.isSafeInteger(position?.y) && Number.isSafeInteger(position?.z)
          && Math.max(
            Math.abs((position!.x as number) - placement.position.x),
            Math.abs((position!.y as number) - placement.position.y),
            Math.abs((position!.z as number) - placement.position.z),
          ) <= range
      }))
    }
    case 'mind-in-focus-range': {
      const focus = placement.sheetKind === 'pokemon'
        ? Number.parseInt(/^(\d+)d6/i.exec(resolveSkills(input.sheet as CharacterSheet)
            .find(skill => skill.key === 'focus')?.value ?? '')?.[1] ?? '1', 10)
        : Number.parseInt(/^(\d+)d6/i.exec(resolveTrainerSkills(input.sheet as TrainerSheet)
            .find(skill => skill.key === 'focus')?.dice ?? '')?.[1] ?? '1', 10)
      const effectiveFocus = focus + (placement.sheetKind === 'pokemon'
        && hasPokemonCapabilityEdge(input.sheet as CharacterSheet, 'Far Reading') ? 2 : 0)
      return otherPlacements.some(candidate => placementDistance(placement, candidate) <= effectiveFocus * 2)
    }
    case 'maneuver-target-in-focus-range': {
      const focus = placement.sheetKind === 'pokemon'
        ? Number.parseInt(/^(\d+)d6/i.exec(resolveSkills(input.sheet as CharacterSheet)
            .find(skill => skill.key === 'focus')?.value ?? '')?.[1] ?? '1', 10)
        : Number.parseInt(/^(\d+)d6/i.exec(resolveTrainerSkills(input.sheet as TrainerSheet)
            .find(skill => skill.key === 'focus')?.dice ?? '')?.[1] ?? '1', 10)
      const effectiveFocus = focus + (placement.sheetKind === 'pokemon'
        && hasPokemonCapabilityEdge(input.sheet as CharacterSheet, 'TK Mastery') ? 2 : 0)
      return otherPlacements.some(candidate => placementDistance(placement, candidate) <= effectiveFocus)
    }
    case 'visible-cell':
    case 'valid-shape-description': return activeScene || contextual
    case 'object-in-8m': return Array.isArray(map.metadata?.capabilityObjects)
      && map.metadata.capabilityObjects.some(raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
        const position = (raw as Record<string, unknown>).position as Record<string, unknown> | undefined
        return Number.isSafeInteger(position?.x) && Number.isSafeInteger(position?.y) && Number.isSafeInteger(position?.z)
          && Math.max(
            Math.abs((position!.x as number) - placement.position.x),
            Math.abs((position!.y as number) - placement.position.y),
            Math.abs((position!.z as number) - placement.position.z),
          ) <= 8
      })
    case 'iron-or-steel-object': return contextual && Array.isArray(map.metadata?.capabilityObjects)
      && map.metadata.capabilityObjects.some(raw => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
        const material = (raw as Record<string, unknown>).material
        return typeof material === 'string' && /^(?:iron|steel)$/i.test(material.trim())
      })
    case 'eligible-unown': return contextual && otherPlacements.some(candidate => (
      candidate.sheetKind === 'pokemon'
      && input.pokemonBySlug.get(candidate.sheetSlug)?.species.trim().toLocaleLowerCase('en-US') === 'unown'
    ))
    case 'abundant-plant-life-and-collection-jar': return contextual
      && input.linkedTrainers.some(trainer => trainerHasItem(trainer, 'Collection Jar'))
    case 'city-or-town-one-hour':
    case 'abundant-plant-life':
    case 'plant-or-planted-berry': return contextual
    case 'scent-trail': return contextual || (Array.isArray(map.metadata?.capabilityScentEvidence)
      && map.metadata.capabilityScentEvidence.some(raw => {
        const evidence = raw as Record<string, unknown>
        return evidence?.actorPlacementId === placement.id
          && (typeof evidence.expiresAt !== 'number' || evidence.expiresAt > input.now)
      }))
    case 'open-space': return contextual && map.dimensions.x * map.dimensions.y * map.dimensions.z > map.placements.length
    case 'alluring-lure-cell': return alluringLureTask === undefined
      && (!activeScene || contextual)
      && map.dimensions.x * map.dimensions.y * map.dimensions.z > map.placements.length
    case 'alluring-lure-due': return alluringLureTask !== undefined
      && input.now >= alluringLureTask.completesAt
    case 'alluring-lure-active': return alluringLureTask !== undefined
    case 'electronic-device': return contextual && Array.isArray(map.metadata?.capabilityDevices)
      && map.metadata.capabilityDevices.length > 0
    case 'unsynchronized-keystone-and-2tp': return placement.sheetKind === 'pokemon'
      && computePokemonTutorPointsEarnedForSheet(input.sheet as CharacterSheet)
        - Math.max(0, (input.sheet as CharacterSheet).tutorPoints?.spent ?? 0) >= 2
      && Array.isArray(map.metadata?.capabilityKeystones)
      && map.metadata.capabilityKeystones.some(raw => {
        const keystone = raw as Record<string, unknown>
        return keystone && typeof keystone === 'object'
          && typeof keystone.id === 'string'
          && (typeof keystone.ownerTrainerSlug === 'string'
            ? input.linkedTrainers.some(trainer => trainer.slug === keystone.ownerTrainerSlug)
            : input.contexts.has(`keystone-access:${placement.id}:${keystone.id}`.toLocaleLowerCase('en-US')))
          && !synchronizedKeystoneIds.has(keystone.id)
          && Array.isArray(keystone.synchronizedPlacementIds)
          && !keystone.synchronizedPlacementIds.includes(placement.id)
      })
    case 'synchronized-keystone': return Array.isArray(map.metadata?.capabilityKeystones)
      && map.metadata.capabilityKeystones.some(raw => {
        const keystone = raw as Record<string, unknown>
        return keystone && typeof keystone === 'object'
          && typeof keystone.id === 'string'
          && (synchronizedKeystoneIds.has(keystone.id)
            || (Array.isArray(keystone.synchronizedPlacementIds)
              && keystone.synchronizedPlacementIds.includes(placement.id)))
      })
    case 'egg': return contextual && Array.isArray(map.metadata?.capabilityEggs)
      && map.metadata.capabilityEggs.some(entry => entry && typeof entry === 'object'
        && typeof (entry as Record<string, unknown>).id === 'string'
        && Number.isSafeInteger((entry as Record<string, unknown>).hatchHours))
    case 'zygarde-cube-and-cells': return input.placement.sheetKind === 'pokemon'
      && input.linkedTrainers.some(trainer => trainerHasItem(trainer, 'Zygarde Cube'))
      && contextual
      && Array.isArray(map.metadata?.capabilityZygardeCells)
      && map.metadata.capabilityZygardeCells.some(raw => {
        const resource = raw as Record<string, unknown>
        return input.linkedTrainers.some(trainer => trainer.slug === resource?.trainerSlug)
          && Number.isSafeInteger(resource?.count) && (resource.count as number) >= 10
      })
    case 'disassemblable-zygarde': return input.placement.sheetKind === 'pokemon'
      && Array.isArray(map.metadata?.capabilityZygardeAssemblies)
      && map.metadata.capabilityZygardeAssemblies.some(raw => {
        const state = raw as Record<string, unknown>
        return state?.actorPlacementId === placement.id && state.disassemblable === true
          && input.linkedTrainers.some(trainer => trainer.slug === state.trainerSlug
            && trainerHasItem(trainer, 'Zygarde Cube'))
      })
    case 'zygarde-cube-and-tp': return input.placement.sheetKind === 'pokemon'
      && input.linkedTrainers.some(trainer => trainerHasItem(trainer, 'Zygarde Cube'))
      && contextual
    case 'willing-or-helpless-target': return contextual && !link(['viral-fusion'])
    default: return false
  }
}

const usageActive = (
  entries: readonly CapabilityUsageEntry[],
  canonicalId: string,
  actionId: string,
  now: number,
): boolean => {
  const actionIds = canonicalId === 'Alluring' && actionId === 'act-as-bait'
    ? new Set(['act-as-bait', 'lure-with-alluring', 'distract-with-alluring'])
    : new Set([actionId])
  return entries.some(entry => (
    entry.canonicalId === canonicalId && actionIds.has(entry.actionId)
    && (entry.availableAt === null || entry.availableAt > now)
    && (entry.remainingDayAdvances === null || entry.remainingDayAdvances > 0)
  ))
}

const economySpent = (
  map: TabletopMap,
  placementId: string,
  economy: string,
): boolean => {
  if (economy === 'free' || economy === 'extended') return false
  const ledger = map.encounterState?.turnResources[placementId]
  if (!ledger || !['standard', 'shift', 'swift'].includes(economy)) return false
  const resource = ledger.actions[economy as 'standard' | 'shift' | 'swift']
  return resource.budget !== null && resource.spent >= resource.budget
}

const passiveContextualSummary = (input: {
  readonly canonicalId: string
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly pokemonBySlug: ReadonlyMap<string, CharacterSheet>
  readonly trainerBySlug: ReadonlyMap<string, TrainerSheet>
  readonly now: number
}): string | null => {
  const visibleSummary = (raw: unknown, key: string): string | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const record = raw as Record<string, unknown>
    const viewers = record.revealToPlacementIds
    const summary = record[key]
    return Array.isArray(viewers) && viewers.includes(input.placement.id)
      && typeof summary === 'string' && summary.trim() && summary.trim().length <= 400
      ? summary.trim() : null
  }
  if (input.canonicalId === 'Premonition' && Array.isArray(input.map.metadata?.capabilityPremonitions)) {
    const warnings = input.map.metadata.capabilityPremonitions.flatMap((raw): readonly string[] => {
      const summary = visibleSummary(raw, 'summary')
      const record = raw as Record<string, unknown>
      const magnitude = record?.magnitude
      const proximity = record?.proximity
      const startsAt = typeof record?.startsAt === 'number' ? record.startsAt : 0
      const expiresAt = typeof record?.expiresAt === 'number' ? record.expiresAt : Number.MAX_SAFE_INTEGER
      if (!summary || ![1, 2, 3].includes(magnitude as number) || ![1, 2, 3].includes(proximity as number)
        || input.now < startsAt || input.now >= expiresAt) return []
      const band = resolvePremonitionBand({ magnitude: magnitude as 1 | 2 | 3, proximity: proximity as 1 | 2 | 3 })
      return [`${band.warningBand}: ${summary}`]
    })
    return warnings.length ? warnings.slice(0, 4).join(' · ') : null
  }
  if (input.canonicalId === 'X-Ray Vision' && Array.isArray(input.map.metadata?.capabilityXRayObservations)) {
    const observations = input.map.metadata.capabilityXRayObservations.flatMap((raw): readonly string[] => {
      const summary = visibleSummary(raw, 'outlineSummary')
      const record = raw as Record<string, unknown>
      return summary && xRayVisionCanPenetrate({
        thicknessFeet: Number(record?.thicknessFeet), material: String(record?.material ?? ''),
      }) ? [summary] : []
    })
    return observations.length ? observations.slice(0, 4).join(' · ') : null
  }
  if (input.canonicalId === 'Tremorsense' && Array.isArray(input.map.metadata?.capabilityTremorsenseObservations)) {
    const perceptionRank = input.placement.sheetKind === 'pokemon'
      ? Number.parseInt(/^(\d+)d6/i.exec(resolveSkills(input.sheet as CharacterSheet)
          .find(skill => skill.key === 'perception')?.value ?? '')?.[1] ?? '1', 10)
      : Number.parseInt(/^(\d+)d6/i.exec(resolveTrainerSkills(input.sheet as TrainerSheet)
          .find(skill => skill.key === 'perception')?.dice ?? '')?.[1] ?? '1', 10)
    const maximumMeters = 5 + (input.placement.sheetKind === 'pokemon'
      && hasPokemonCapabilityEdge(input.sheet as CharacterSheet, 'Seismometer') ? perceptionRank : 0)
    const observations = input.map.metadata.capabilityTremorsenseObservations.flatMap((raw): readonly string[] => {
      const summary = visibleSummary(raw, 'shapeSummary')
      const record = raw as Record<string, unknown>
      return summary && tremorsenseCanResolve({
        distanceMeters: Number(record?.distanceMeters), inGround: record?.inGround === true, maximumMeters,
      }) ? [summary] : []
    })
    return observations.length ? observations.slice(0, 4).join(' · ') : null
  }
  if (input.canonicalId === 'Pack Mon') {
    const wildIds = new Set(Array.isArray(input.map.metadata?.capabilityWildPlacementIds)
      ? input.map.metadata.capabilityWildPlacementIds.filter((id): id is string => typeof id === 'string') : [])
    const unevolvedRelations = new Set(Array.isArray(input.map.metadata?.capabilityUnevolvedRelations)
      ? input.map.metadata.capabilityUnevolvedRelations.filter((id): id is string => typeof id === 'string') : [])
    const results = input.map.placements.flatMap((target): readonly string[] => {
      if (target.id === input.placement.id || !wildIds.has(target.id)) return []
      const targetSheet = target.sheetKind === 'pokemon'
        ? input.pokemonBySlug.get(target.sheetSlug) : input.trainerBySlug.get(target.sheetSlug)
      if (!targetSheet) return []
      const targetHasPackMon = resolveEffectiveCapabilities({
        map: input.map, placement: target, sheet: targetSheet,
        sheets: { pokemon: input.pokemonBySlug, trainer: input.trainerBySlug },
      }).instances.some(instance => instance.effective && instance.canonicalId === 'Pack Mon')
      const disposition = resolvePackMonDisposition({
        userSpecies: input.placement.sheetKind === 'pokemon' ? (input.sheet as CharacterSheet).species : input.sheet.slug,
        userLevel: input.sheet.level ?? 0,
        userIsWild: wildIds.has(input.placement.id),
        targetSpecies: target.sheetKind === 'pokemon' ? (targetSheet as CharacterSheet).species : targetSheet.slug,
        targetLevel: targetSheet.level ?? 0,
        targetIsWild: true,
        targetIsUnevolvedFormOfUser: unevolvedRelations.has(`${target.id}:${input.placement.id}`),
        bothHavePackMon: targetHasPackMon,
      })
      return disposition === 'none' ? [] : [`${target.id}: ${disposition}`]
    })
    return results.length ? results.slice(0, 8).join(' · ') : null
  }
  if (input.canonicalId === 'Magnetic') return 'Magnetic north is discernible.'
  return null
}

const privateNoticesFor = (
  map: TabletopMap,
  placementId: string,
): PlacementCapabilityClientBundle['privateNotices'] => {
  const raw = map.metadata?.capabilityPrivateNotices
  if (!Array.isArray(raw)) return []
  return raw.slice(-256).flatMap((candidate): PlacementCapabilityClientBundle['privateNotices'] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const notice = candidate as Record<string, unknown>
    const viewers = notice.revealToPlacementIds
    const canonicalId = typeof notice.canonicalId === 'string' ? notice.canonicalId.trim() : ''
    const actionId = typeof notice.actionId === 'string' ? notice.actionId.trim() : ''
    const summary = typeof notice.summary === 'string' ? notice.summary.trim() : ''
    const label = typeof notice.label === 'string' ? notice.label.trim() : ''
    if (!Array.isArray(viewers) || !viewers.includes(placementId)
      || typeof notice.id !== 'string' || !notice.id.trim()
      || !CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId)
      || !actionId || !label || label.length > 120 || !summary || summary.length > 500
      || typeof notice.sourcePlacementId !== 'string'
      || typeof notice.createdAt !== 'number' || !Number.isFinite(notice.createdAt)) return []
    return [Object.freeze({
      noticeId: notice.id,
      canonicalId,
      actionId,
      label,
      summary,
      sourcePlacementId: notice.sourcePlacementId,
      createdAt: notice.createdAt,
    })]
  })
}

const title = (actionId: string): string => actionId.split('-')
  .map(part => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : '')
  .join(' ')

/** Build owner/GM-safe facts and only source-contextual action offers. */
export const buildCapabilityClientCapabilityBundle = (
  input: BuildCapabilityClientCapabilityBundleInput,
): CapabilityClientCapabilityBundle => {
  const pokemonBySlug = new Map(input.pokemonSheets.map(sheet => [sheet.slug, sheet]))
  const trainerBySlug = new Map(input.trainerSheets.map(sheet => [sheet.slug, sheet]))
  const linkedTrainerSheets = playerProfileLinkedTrainerSheetsForTokenControl(
    input.playerProfile,
    slug => trainerBySlug.get(slug),
  )
  const controlledIds = new Set(actorControlledMapPlacementIds({
    role: input.role,
    profile: input.playerProfile,
    placements: input.map.placements,
    linkedTrainerSheets,
  }))
  const contexts = normalizedContexts(input.map)
  const now = input.now ?? input.map.updatedAt ?? 0
  const effectiveInstanceIdsByPlacement = new Map<string, ReadonlySet<string>>()
  const effectiveInstanceIdsFor = (placementId: string): ReadonlySet<string> => {
    const cached = effectiveInstanceIdsByPlacement.get(placementId)
    if (cached) return cached
    const candidate = input.map.placements.find(placement => placement.id === placementId)
    const candidateSheet = candidate?.sheetKind === 'pokemon'
      ? pokemonBySlug.get(candidate.sheetSlug)
      : candidate ? trainerBySlug.get(candidate.sheetSlug) : null
    const ids = new Set(candidate && candidateSheet ? resolveEffectiveCapabilities({
      map: input.map,
      placement: candidate,
      sheet: candidateSheet,
      sheets: { pokemon: pokemonBySlug, trainer: trainerBySlug },
    }).instances.filter(instance => instance.effective).map(instance => instance.instanceId) : [])
    effectiveInstanceIdsByPlacement.set(placementId, ids)
    return ids
  }
  const placements: PlacementCapabilityClientBundle[] = []
  for (const placement of input.map.placements) {
    if (!controlledIds.has(placement.id)) continue
    const sheet = placement.sheetKind === 'pokemon'
      ? pokemonBySlug.get(placement.sheetSlug)
      : trainerBySlug.get(placement.sheetSlug)
    if (!sheet) continue
    const effective = resolveEffectiveCapabilities({
      map: input.map,
      placement,
      sheet,
      sheets: { pokemon: pokemonBySlug, trainer: trainerBySlug },
    })
    const actorTrainers = linkedTrainers(placement, sheet, input.trainerSheets)
    const effectiveInstanceIds = new Set(effective.instances.filter(instance => instance.effective).map(instance => instance.instanceId))
    effectiveInstanceIdsByPlacement.set(placement.id, effectiveInstanceIds)
    const facts: CapabilityClientFact[] = effective.instances.map(instance => {
      const runtime = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(instance.canonicalId)
      return Object.freeze({
        instanceId: instance.instanceId,
        canonicalId: instance.canonicalId,
        displayName: instance.canonicalId,
        active: instance.effective,
        value: instance.value,
        parameters: instance.parameters,
        semanticTags: runtime.spec.semanticTags,
        sourceEffect: runtime.source.effect,
        contextualSummary: passiveContextualSummary({
          canonicalId: instance.canonicalId,
          map: input.map,
          placement,
          sheet,
          pokemonBySlug,
          trainerBySlug,
          now,
        }),
        sources: Object.freeze(instance.sources.map(source => Object.freeze({
          kind: source.kind,
          label: source.label,
          value: source.value,
        }))),
        suppressionReasons: instance.suppressionReasons,
      })
    })
    const offers: CapabilityClientActionOffer[] = []
    const independentActionBlocked = (
      placement.sheetKind === 'pokemon'
      && (Boolean((sheet as CharacterSheet).babyTemplate)
        || Boolean((sheet as CharacterSheet).letterPressCombinedInto))
    ) || (input.map.encounterState?.capabilityRuntime?.links ?? []).some(link => (
      (link.kind === 'as-one-mount' || link.kind === 'viral-fusion' || link.kind === 'marsupial-pouch')
      && link.participantPlacementIds.includes(placement.id)
      && effectiveInstanceIdsFor(link.ownerPlacementId).has(link.capabilityInstanceId)
    ))
    for (const instance of effective.instances) {
      if (!instance.effective) continue
      const runtime = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(instance.canonicalId)
      for (const action of runtime.spec.actions) {
        if (independentActionBlocked) continue
        const context = action.contextPredicateId.slice(action.contextPredicateId.lastIndexOf('.') + 1)
        if (!contextSatisfied({
          context,
          canonicalId: instance.canonicalId,
          map: input.map,
          placement,
          sheet,
          linkedTrainers: actorTrainers,
          pokemonBySlug,
          trainerBySlug,
          contexts,
          now,
          effectiveInstanceIds,
        })) continue
        const reasons: string[] = []
        const activeModeEntries = (input.map.encounterState?.capabilityRuntime?.modes ?? [])
          .filter(entry => entry.actorPlacementId === placement.id
            && effectiveInstanceIds.has(entry.capabilityInstanceId)
            && (entry.expiresAt === null || entry.expiresAt > now))
        const activeModes = new Set(activeModeEntries.map(entry => entry.mode))
        const illusionMotion = activeModeEntries.find(entry => entry.mode === 'illusion')?.configurationId ?? ''
        const illusionReservesStandard = /(?:^|;)motion:major$/.test(illusionMotion)
        const illusionReservesSwift = /(?:^|;)motion:minor$/.test(illusionMotion)
        if (action.economy === 'standard'
          && (activeModes.has('intangible') || activeModes.has('shadow-melded') || activeModes.has('shrunken') || illusionReservesStandard)
          && !(activeModes.has('shrunken') && action.actionId === 'restore-size')) {
          reasons.push('capability.standard-action-blocked')
        }
        if (action.economy === 'swift' && illusionReservesSwift) reasons.push('capability.swift-action-reserved')
        if (action.economy === 'extended' && input.map.initiative?.activeId) reasons.push('economy.extended-unavailable-during-initiative')
        if (action.economy !== 'extended' && action.economy !== 'none'
          && input.map.initiative?.activeId
          && input.map.initiative.activeId !== placement.id) reasons.push('economy.actor-turn-required')
        if (action.levelRequirement !== null && (sheet.level ?? 0) < action.levelRequirement) reasons.push('source.level-required')
        if (economySpent(input.map, placement.id, action.economy)) reasons.push(`economy.${action.economy}-spent`)
        const usageEntries = [
          ...(sheet.capabilityUsage?.entries ?? []),
          ...(input.map.encounterState?.capabilityRuntime?.usages.entries ?? []),
        ]
        const usageActionId = action.actionId === 'lure-with-alluring' || action.actionId === 'distract-with-alluring'
          ? 'act-as-bait' : action.actionId
        if (action.frequency !== 'at-will' && usageActive(usageEntries, instance.canonicalId, usageActionId, now)) reasons.push(`usage.${action.frequency}-exhausted`)
        const juicerAuthorityIdentity = placement.sheetKind === 'pokemon'
          ? juicerOfferAuthorityIdentity(
              sheet as CharacterSheet,
              action.actionId,
              now,
              actorTrainers.map(trainer => trainer.slug),
            )
          : null
        offers.push(Object.freeze({
          offerId: encounterPresentationStableId(
            'capability-offer', input.map.slug, String(input.mapRevision), placement.id,
            instance.instanceId, action.actionId,
            ...(juicerAuthorityIdentity ? [juicerAuthorityIdentity] : []),
          ),
          mapSlug: input.map.slug,
          mapRevision: input.mapRevision,
          actorPlacementId: placement.id,
          capabilityInstanceId: instance.instanceId,
          canonicalId: instance.canonicalId,
          actionId: action.actionId,
          label: title(action.actionId),
          economy: action.economy,
          frequency: action.frequency,
          mechanic: action.mechanic,
          contextPredicateId: action.contextPredicateId,
          requiresGmConfirmation: action.requiresGmConfirmation,
          available: reasons.length === 0,
          unavailableReasonCodes: Object.freeze(reasons),
          selectionOptions: capabilitySelectionOptions(input.map, action.actionId, placement, actorTrainers, contexts),
        }))
      }
    }
    placements.push(Object.freeze({
      placementId: placement.id,
      facts: Object.freeze(facts),
      offers: Object.freeze(offers),
      unresolvedLabels: Object.freeze(effective.unresolved.map(entry => entry.normalizedLabel)),
      pendingAdjudications: Object.freeze(input.role === 'gm'
        ? (input.map.encounterState?.capabilityRuntime?.pendingAdjudications ?? []).filter(entry => (
            entry.actorPlacementId === placement.id && entry.expiresAt > now
          )).map(entry => Object.freeze({ ...entry }))
        : []),
      privateNotices: Object.freeze(privateNoticesFor(input.map, placement.id)),
    }))
  }
  return Object.freeze({
    schemaVersion: 1,
    rulesetId: CAPABILITY_AUTOMATION_RULESET_ID,
    mapSlug: input.map.slug,
    mapRevision: input.mapRevision,
    placements: Object.freeze(placements),
  })
}
