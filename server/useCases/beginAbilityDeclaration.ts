import { createHash } from 'node:crypto'
import { createError } from 'h3'
import type { AuthRole } from '#shared/auth'
import {
  ABILITY_DECLARATION_DIRECTIONS,
  ABILITY_DECLARATION_STAT_IDS,
  type AbilityDeclarationOfferTargeting,
  type AbilityDeclarationOption,
} from '#shared/abilityAutomation/declarationIntent'
import { POKEMON_TYPE_IDS } from '#shared/pokemonTypes'
import { reviewedAbilityConnectionMoveNames } from '#shared/abilityAutomation/connections'
import {
  AA071_WEATHER_TYPE_BY_KIND,
  isAa071FullyGrownTreeCell,
} from '#shared/abilityAutomation/aa071'
import {
  AA072_GARDENER_METADATA_KEY,
  aa072IsYieldingPlantCell,
  aa072PlantCellId,
  parseAa072GardenerMetadata,
} from '#shared/abilityAutomation/aa072'
import {
  createEmptyAbilityDailyUsageLedger,
  parseAbilityDailyUsageLedger,
} from '#shared/abilityAutomation/resources'
import {
  ABILITY_STAT_OPTIONS_PREDICATE_KIND,
  parseAbilityStatOptionsPredicate,
} from '#shared/abilityAutomation/statTargeting'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBeginAbilityClientDeclarationCommand,
  type AbilityClientDeclarationOffer,
} from '#shared/abilityAutomation/clientCommands'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AbilitySpecTargetingKind } from '#shared/abilityAutomation/spec'
import type { MoveSelector } from '#shared/moveAutomation/selectors'
import { findMove } from '~~/data/ptuReference'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../policies/playerProfileTokenControlPolicy'
import { buildAuthoritativeAbilityContext } from '../domain/abilityAutomation/context'
import { MOVE_AUTOMATION_RUNTIME_REGISTRY } from '../domain/moveAutomation/registry'
import {
  createAbilityDeclarationOffer,
  projectAbilityDeclarationOfferForClient,
} from '../domain/abilityAutomation/declarationIntent'
import { resolveAbilitySharedSelector } from '../domain/abilityAutomation/effectKernel'
import {
  ABILITY_AUTOMATION_RUNTIME_REGISTRY,
  type AbilityAutomationRuntimeRegistry,
} from '../domain/abilityAutomation/registry'
import { resolveAuthoritativeAbilityTargets } from '../domain/abilityAutomation/targeting'
import { createMoveAutomationWeatherResolver } from '../domain/moveAutomation/weather'
import { aa071ForecastTypeResolution } from '../domain/abilityAutomation/mechanics/aa071StaticIntegration'
import {
  createSqliteAbilityDeclarationOfferRepository,
  type AbilityDeclarationOfferRepository,
} from '../storage/abilityDeclarationOfferRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import { listRepositorySheets, type ListSheetsRepository } from './listSheets'
import { loadMapUseCase } from './loadMap'

export interface BeginAbilityDeclarationInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: unknown
}
export interface BeginAbilityDeclarationDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<unknown>, 'get' | 'list'>
  readonly sheetRepository?: ListSheetsRepository
  readonly offerRepository?: AbilityDeclarationOfferRepository
  readonly registry?: AbilityAutomationRuntimeRegistry
  readonly now?: () => number
}
const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const option = (
  declarationId: string,
  index: number,
  kind: AbilitySpecTargetingKind,
  value: AbilityDeclarationOption['value'],
): AbilityDeclarationOption => ({
  id: `${declarationId}:option:${index}`,
  presentationKey: `ability.option.${kind}`,
  value,
})
const fields = (map: Parameters<typeof buildAuthoritativeAbilityContext>[0]['map']): readonly string[] => {
  const effects = map.fieldEffects
  return [...new Set([
    ...(effects?.weather ?? []).map(entry => `weather:${entry.kind}`),
    ...(effects?.terrains ?? []).map(entry => `terrain:${entry.kind}`),
    ...(effects?.rooms ?? []).map(entry => `room:${entry.kind}`),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0))]
}
const declarationsFor = (
  context: ReturnType<typeof buildAuthoritativeAbilityContext>,
  abilityInstanceId: string,
): readonly AbilityDeclarationOfferTargeting[] => {
  const modeId = context.request.modeId
  return context.runtime.definition.spec.targeting
    .filter(declaration => declaration.modeId === modeId)
    .map((declaration): AbilityDeclarationOfferTargeting => {
      let options: readonly AbilityDeclarationOption[] = []
      if (declaration.kind === 'none') options = []
      else if (declaration.kind === 'self') options = [option(declaration.id, 0, declaration.kind, { kind: 'self', placementId: context.actor.placement.id })]
      else if (declaration.kind === 'token') {
        if (!declaration.predicate) fail(500, `Ability target declaration ${declaration.id} has no reviewed targeting policy.`)
        const selectedBySelector = declaration.selector
          ? new Set(resolveAbilitySharedSelector(context, declaration.selector as unknown as MoveSelector))
          : null
        const resolved = resolveAuthoritativeAbilityTargets({
          context,
          predicate: declaration.predicate,
          requestedPlacementIds: context.tokens.map(token => token.id),
          visiblePlacementIds: context.tokens.map(token => token.id),
        })
        const ballFetchTargets = context.runtime.canonicalId === 'Ball Fetch' && modeId === 'fetch'
          ? new Set((context.map.encounterState?.abilityOwnedState?.entries ?? []).flatMap(entry => (
              entry.ownerPlacementId === context.actor.placement.id
              && context.actor.effectiveAbilities.some(ability => (
                ability.effective && ability.canonicalId === 'Ball Fetch'
                && ability.instanceId === entry.sourceAbilityInstanceId
              ))
              && entry.canonicalId === 'Ball Fetch'
              && entry.payload.kind === 'mark'
              ? entry.targetPlacementIds
              : []
            )))
          : null
        const crushTrapTargets = context.runtime.canonicalId === 'Crush Trap' && modeId === 'crush'
          ? new Set((context.map.encounterState?.abilityOwnedState?.entries ?? []).flatMap(entry => (
              entry.ownerPlacementId === context.actor.placement.id
              && context.actor.effectiveAbilities.some(ability => ability.effective
                && ability.canonicalId === 'Crush Trap'
                && ability.instanceId === entry.sourceAbilityInstanceId)
              && entry.canonicalId === 'Crush Trap'
              && entry.payload.kind === 'mark'
              && entry.payload.markId.startsWith('aa065.crush-trap.grapple:')
                ? entry.targetPlacementIds
                : []
            )))
          : null
        const deadlyPoisonTargets = context.runtime.canonicalId === 'Deadly Poison' && modeId === 'upgrade'
          ? new Set((context.map.encounterState?.abilityOwnedState?.entries ?? []).flatMap(entry => (
              entry.ownerPlacementId === context.actor.placement.id
              && context.actor.effectiveAbilities.some(ability => ability.effective
                && ability.canonicalId === 'Deadly Poison'
                && ability.instanceId === entry.sourceAbilityInstanceId)
              && entry.canonicalId === 'Deadly Poison'
              && entry.payload.kind === 'mark'
              && entry.payload.markId.startsWith('aa066.deadly-poison.poisoned:')
                ? entry.targetPlacementIds
                : []
            )))
          : null
        options = resolved.legalTargetPlacementIds
          .filter(id => selectedBySelector === null || selectedBySelector.has(id))
          .filter(id => ballFetchTargets === null || ballFetchTargets.has(id))
          .filter(id => crushTrapTargets === null || crushTrapTargets.has(id))
          .filter(id => deadlyPoisonTargets === null || deadlyPoisonTargets.has(id))
          .map((placementId, index) => option(declaration.id, index, declaration.kind, { kind: 'token', placementId }))
      }
      else if (declaration.kind === 'side') options = Object.values(context.sides)
        .filter(side => side.status === 'active')
        .map((side, index) => option(declaration.id, index, declaration.kind, { kind: 'side', sideId: side.id }))
      else if (declaration.kind === 'field') options = fields(context.map)
        .map((fieldId, index) => option(declaration.id, index, declaration.kind, { kind: 'field', fieldId }))
      else if (declaration.kind === 'direction') options = ABILITY_DECLARATION_DIRECTIONS
        .map((directionId, index) => option(declaration.id, index, declaration.kind, { kind: 'direction', directionId }))
      else if (declaration.kind === 'type') {
        const typeIds = context.runtime.canonicalId === 'Forecast' && modeId === 'choose-weather'
          ? (() => {
              const active = [...new Set(createMoveAutomationWeatherResolver(context.map).active()
                .map(weather => AA071_WEATHER_TYPE_BY_KIND[weather.kind]))]
              return active.length > 0 ? active : ['normal' as const]
            })()
          : POKEMON_TYPE_IDS
        options = typeIds.map((typeId, index) => option(
          declaration.id, index, declaration.kind, { kind: 'type', typeId },
        ))
      }
      else if (declaration.kind === 'stat') {
        const statIds = declaration.predicate?.kind === ABILITY_STAT_OPTIONS_PREDICATE_KIND
          ? parseAbilityStatOptionsPredicate(declaration.predicate).statIds
          : ABILITY_DECLARATION_STAT_IDS
        options = statIds.map((statId, index) => option(
          declaration.id, index, declaration.kind, { kind: 'stat', statId },
        ))
      }
      else if (declaration.kind === 'move') {
        const moveNames = (context.actor.sheet.sheet.movelist ?? [])
          .flatMap(move => typeof move.name === 'string' && move.name.trim() ? [move.name.trim()] : [])
        if (context.runtime.canonicalId === 'Aqua Bullet' && modeId === 'launch' && !moveNames.includes('Aqua Jet')) {
          moveNames.push('Aqua Jet')
        }
        if (context.runtime.canonicalId === 'Bone Lord' && modeId === 'empower') {
          if (!moveNames.includes('Bonemerang')) moveNames.push('Bonemerang')
          const eligible = new Set(['Bone Club', 'Bone Rush', 'Bonemerang'])
          moveNames.splice(0, moveNames.length, ...moveNames.filter(moveName => eligible.has(moveName)))
        }
        if (context.runtime.canonicalId === 'Empower' && modeId === 'activate') {
          moveNames.push(...reviewedAbilityConnectionMoveNames(
            context.actor.effectiveAbilities.filter(ability => ability.effective)
              .map(ability => ability.canonicalId),
            moveNames,
          ))
          moveNames.splice(0, moveNames.length, ...moveNames.filter(moveName => {
            const runtime = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve(moveName)
            return findMove(moveName)?.damage_class === 'Status'
              && runtime?.kind === 'movespec-v2'
              && runtime.definition.spec.targeting.kind === 'self'
          }))
        }
        options = moveNames.map((canonicalMoveId, index) => option(
          declaration.id, index, declaration.kind, { kind: 'move', canonicalMoveId },
        ))
      }
      else if (declaration.kind === 'ability') {
        const abilities = context.runtime.canonicalId === 'Aura Break' && modeId === 'activate'
          ? (() => {
              const targetDeclaration = context.runtime.definition.spec.targeting.find(target => (
                target.modeId === modeId && target.kind === 'token'
              ))
              const targetPredicate = targetDeclaration?.predicate
                ?? fail(500, 'Aura Break has no reviewed foe targeting policy.')
              const legalTargets = resolveAuthoritativeAbilityTargets({
                context,
                predicate: targetPredicate,
                requestedPlacementIds: context.tokens.map(token => token.id),
                visiblePlacementIds: context.tokens.map(token => token.id),
              }).legalTargetPlacementIds
              return legalTargets.flatMap(placementId => (
                context.queries.effectiveAbilities.allForPlacement(placementId)
                  .filter(ability => ability.effective && ability.canonicalId.toLowerCase().includes('aura'))
              ))
            })()
          : context.actor.effectiveAbilities
        options = abilities.map((ability, index) => option(declaration.id, index, declaration.kind, {
          kind: 'ability', canonicalAbilityId: ability.canonicalId, abilityInstanceId: ability.instanceId,
        }))
      }
      else if (declaration.kind === 'item') options = context.runtime.canonicalId === 'Cud Chew'
        ? (context.map.encounterState?.abilityOwnedState?.entries ?? [])
            .filter(entry => entry.ownerPlacementId === context.actor.placement.id
              && context.actor.effectiveAbilities.some(ability => ability.effective
                && ability.canonicalId === 'Cud Chew'
                && ability.instanceId === entry.sourceAbilityInstanceId)
              && entry.canonicalId === 'Cud Chew'
              && entry.payload.kind === 'mark'
              && entry.payload.markId.startsWith('aa065.cud-chew.consumed:'))
            .map((entry, index) => option(declaration.id, index, declaration.kind, {
              kind: 'item', itemId: entry.stateId, itemResourceId: `ability-owned:${entry.stateId}`,
            }))
        : context.queries.items.requirements()
            .flatMap(requirement => context.queries.items.referencesForRequirement(requirement.id))
            .map((reference, index) => option(declaration.id, index, declaration.kind, {
              kind: 'item',
              itemId: reference.itemId,
              itemResourceId: reference.owner.kind === 'sheet'
                ? `sheet:${reference.owner.sheetKind}:${reference.owner.slug}`
                : `${reference.owner.kind}:${reference.owner.slug}`,
            }))
      else if (declaration.kind === 'branch') {
        if (context.runtime.canonicalId === 'Fabulous Trim' && modeId === 'style') {
          options = ['star', 'diamond', 'heart', 'pharaoh', 'kabuki', 'la-reine', 'matron', 'dandy', 'debutante']
            .map((branchId, index) => option(declaration.id, index, declaration.kind, { kind: 'branch', branchId }))
        }
        else if (context.runtime.canonicalId === 'Fashion Designer' && modeId === 'activate') {
          options = ['lucky-leaf', 'tasty-reeds', 'dew-cup', 'thorn-mantle', 'chewy-cluster', 'decorative-twine']
            .map((branchId, index) => option(declaration.id, index, declaration.kind, { kind: 'branch', branchId }))
        }
        else if (context.runtime.canonicalId === 'Defy Death' && modeId === 'activate') {
          const ability = context.actor.effectiveAbilities.find(candidate => (
            candidate.effective
            && candidate.canonicalId === 'Defy Death'
            && candidate.instanceId === abilityInstanceId
          )) ?? fail(409, 'Defy Death is no longer effective.')
          const ledger = parseAbilityDailyUsageLedger(
            context.actor.sheet.sheet.abilityUsage ?? createEmptyAbilityDailyUsageLedger(),
          )
          const lastingAbilityId = ability.sourceKind === 'base' ? 'base:Defy Death' : ability.instanceId
          const usage = ledger.entries.find(entry => (
            entry.ownerId === `sheet:${context.actor.sheet.kind}:${context.actor.sheet.slug}`
            && entry.abilityInstanceId === lastingAbilityId
            && entry.canonicalId === 'Defy Death'
            && entry.clauseId === 'injuries'
          ))
          const maximum = Math.min(3, context.actor.token.injuries ?? 0, Math.max(0, 3 - (usage?.spent ?? 0)))
          options = Array.from({ length: maximum }, (_, index) => option(
            declaration.id, index, declaration.kind, { kind: 'branch', branchId: `remove-${index + 1}` },
          ))
        }
        else fail(422, `Ability branch declaration ${declaration.id} requires a reviewed declaration adapter.`)
      }
      else if (declaration.kind === 'cell') {
        const cells = []
        if (context.runtime.canonicalId === 'Forest Lord' && modeId === 'activate') {
          const seen = new Set<string>()
          for (const voxel of context.map.voxels) {
            const cell = { x: voxel.x, y: voxel.y, z: voxel.z }
            const key = `${cell.x}:${cell.y}:${cell.z}`
            if (seen.has(key)
              || !isAa071FullyGrownTreeCell(context.map, cell)
              || ptuGridDistanceBetweenFootprints(context.actor.token, {
                position: cell, base: 1, clearance: 1,
              }) > 10) continue
            seen.add(key)
            cells.push(cell)
            if (cells.length > 512) fail(422, `Ability cell declaration ${declaration.id} exceeds the bounded offer size.`)
          }
        }
        else if (context.runtime.canonicalId === 'Gardener' && modeId === 'cultivate') {
          const ledger = parseAbilityDailyUsageLedger(
            context.actor.sheet.sheet.abilityUsage ?? createEmptyAbilityDailyUsageLedger(),
          )
          const dayKey = ledger.dayKey ?? 'campaign-day:initial'
          const gardener = parseAa072GardenerMetadata(
            context.map.metadata?.[AA072_GARDENER_METADATA_KEY],
          )
          const seen = new Set<string>()
          for (const voxel of context.map.voxels) {
            const cell = { x: voxel.x, y: voxel.y, z: voxel.z }
            const key = aa072PlantCellId(cell)
            if (seen.has(key)
              || !aa072IsYieldingPlantCell(context.map, cell)
              || gardener.plants[key]?.lastAppliedDayKey === dayKey) continue
            seen.add(key)
            cells.push(cell)
            if (cells.length > 512) fail(422, `Ability cell declaration ${declaration.id} exceeds the bounded offer size.`)
          }
        }
        else {
          for (let y = 0; y < context.map.dimensions.y; y += 1) for (let z = 0; z < context.map.dimensions.z; z += 1) for (let x = 0; x < context.map.dimensions.x; x += 1) {
            cells.push({ x, y, z })
            if (cells.length > 512) fail(422, `Ability cell declaration ${declaration.id} exceeds the bounded offer size.`)
          }
        }
        options = cells.map((cell, index) => option(declaration.id, index, declaration.kind, { kind: 'cell', cellId: `${declaration.id}:cell:${index}`, cell }))
      }
      else fail(422, `Ability targeting kind ${declaration.kind} requires a reviewed declaration adapter.`)
      if (options.length < declaration.maxSelections) {
        fail(409, `Ability declaration ${declaration.id} has too few currently legal options.`)
      }
      return Object.freeze({
        id: declaration.id,
        kind: declaration.kind,
        minSelections: declaration.minSelections,
        maxSelections: declaration.maxSelections,
        options: Object.freeze(options),
      })
    })
}

export const beginAbilityDeclarationUseCase = (
  input: BeginAbilityDeclarationInput,
  dependencies: BeginAbilityDeclarationDependencies = {},
): AbilityClientDeclarationOffer => {
  const command = parseBeginAbilityClientDeclarationCommand(input.command)
  const database = dependencies.database ?? getRotomDatabase()
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository(database) as Pick<MapRepository<unknown>, 'get' | 'list'>
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const offerRepository = dependencies.offerRepository ?? createSqliteAbilityDeclarationOfferRepository(database)
  const registry = dependencies.registry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY
  const requestSha256 = hash(command)
  const duplicate = offerRepository.findByRequestId(command.requestId)
  if (duplicate) {
    if (duplicate.requestSha256 !== requestSha256) fail(409, 'Ability declaration request ID was reused with changed input.')
    return projectAbilityDeclarationOfferForClient(duplicate.offer)
  }
  const { map, revision } = loadMapUseCase({ role: input.role, slug: command.mapSlug }, { mapRepository })
  if (revision !== command.baseRevision) fail(409, 'Ability declaration capability is stale.')
  const actor = map.placements.find(placement => placement.id === command.actorPlacementId)
    ?? fail(404, 'Ability actor placement is missing.')
  const trainerSheets = listRepositorySheets<TrainerSheet>(sheetRepository, 'trainer')
  const trainerBySlug = new Map(trainerSheets.map(sheet => [sheet.slug, sheet]))
  const linkedTrainerSheets = playerProfileLinkedTrainerSheetsForTokenControl(input.playerProfile, slug => trainerBySlug.get(slug))
  if (!actorCanControlMapPlacement({ role: input.role, profile: input.playerProfile, placement: actor, linkedTrainerSheets })) {
    fail(403, 'Ability actor is not controlled by this principal.')
  }
  const runtime = registry.resolve(command.canonicalId) ?? fail(409, 'Ability has no manifest-selected native runtime.')
  const mode = runtime.definition.spec.modes.find(entry => entry.id === command.modeId)
    ?? fail(409, 'Ability mode cannot be invoked by a declaration.')
  if (mode.kind !== 'activated' && mode.kind !== 'configuration') {
    fail(409, 'Ability mode cannot be invoked by a declaration.')
  }
  const pokemonSheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
  const context = buildAuthoritativeAbilityContext({
    map,
    pokemonSheets: new Map(pokemonSheets.map(sheet => [sheet.slug, sheet])),
    trainerSheets: trainerBySlug,
    request: {
      canonicalId: command.canonicalId,
      modeId: command.modeId,
      actorPlacementId: command.actorPlacementId,
      targetPlacementIds: [],
      triggeringEvent: null,
    },
    runtime,
    resolutionId: `declaration:${command.requestId}`,
    random: () => 0.5,
    time: dependencies.now?.() ?? Date.now(),
  })
  const activeAbility = context.actor.effectiveAbilities.find(ability => (
    ability.instanceId === command.abilityInstanceId
    && ability.canonicalId === command.canonicalId
    && ability.effective
    && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash)
  ))
  if (!activeAbility) fail(409, 'Ability instance is not currently effective.')
  if (mode.kind === 'configuration'
    && command.canonicalId === 'Forecast'
    && command.modeId === 'choose-weather'
    && !aa071ForecastTypeResolution({
      contextMap: context.map,
      placementId: context.actor.placement.id,
      hasForecast: true,
    }).ambiguous) {
    fail(409, 'Forecast configuration is available only while its Weather choice is unresolved.')
  }
  const createdAt = dependencies.now?.() ?? Date.now()
  const offer = createAbilityDeclarationOffer({
    runtime,
    draft: {
      offerId: `offer:${command.requestId}`,
      mapSlug: command.mapSlug,
      mapRevision: revision,
      createdAt,
      expiresAt: createdAt + 300_000,
      actorPlacementId: command.actorPlacementId,
      abilityInstanceId: command.abilityInstanceId,
      modeId: command.modeId,
      declarations: declarationsFor(context, command.abilityInstanceId),
    },
  })
  offerRepository.insert({ requestId: command.requestId, requestSha256, offer })
  return projectAbilityDeclarationOfferForClient(offer)
}
