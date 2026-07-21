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
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../policies/playerProfileTokenControlPolicy'
import { buildAuthoritativeAbilityContext } from '../domain/abilityAutomation/context'
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
const declarationsFor = (context: ReturnType<typeof buildAuthoritativeAbilityContext>): readonly AbilityDeclarationOfferTargeting[] => {
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
        options = resolved.legalTargetPlacementIds
          .filter(id => selectedBySelector === null || selectedBySelector.has(id))
          .filter(id => ballFetchTargets === null || ballFetchTargets.has(id))
          .filter(id => crushTrapTargets === null || crushTrapTargets.has(id))
          .map((placementId, index) => option(declaration.id, index, declaration.kind, { kind: 'token', placementId }))
      }
      else if (declaration.kind === 'side') options = Object.values(context.sides)
        .filter(side => side.status === 'active')
        .map((side, index) => option(declaration.id, index, declaration.kind, { kind: 'side', sideId: side.id }))
      else if (declaration.kind === 'field') options = fields(context.map)
        .map((fieldId, index) => option(declaration.id, index, declaration.kind, { kind: 'field', fieldId }))
      else if (declaration.kind === 'direction') options = ABILITY_DECLARATION_DIRECTIONS
        .map((directionId, index) => option(declaration.id, index, declaration.kind, { kind: 'direction', directionId }))
      else if (declaration.kind === 'type') options = POKEMON_TYPE_IDS
        .map((typeId, index) => option(declaration.id, index, declaration.kind, { kind: 'type', typeId }))
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
      else if (declaration.kind === 'cell') {
        const cells = []
        for (let y = 0; y < context.map.dimensions.y; y += 1) for (let z = 0; z < context.map.dimensions.z; z += 1) for (let x = 0; x < context.map.dimensions.x; x += 1) {
          cells.push({ x, y, z })
          if (cells.length > 512) fail(422, `Ability cell declaration ${declaration.id} exceeds the bounded offer size.`)
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
  if (!mode || mode.kind !== 'activated') fail(409, 'Ability mode cannot be actively invoked.')
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
      declarations: declarationsFor(context),
    },
  })
  offerRepository.insert({ requestId: command.requestId, requestSha256, offer })
  return projectAbilityDeclarationOfferForClient(offer)
}
