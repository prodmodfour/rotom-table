import { createHash } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseContestPreparationCommand, type ContestPreparationCommandV1, type ContestPreparationResultV1 } from '#shared/contests/preparationOperations'
import { canConsumeContestPoffin, derivePokemonContestPreparation, parsePokemonContestStatsState } from '#shared/contests/preparation'
import { contestTrainerIntegrations } from '#shared/contests/integrations'
import itemsJson from '../../data/reference/items.json'
import movesJson from '../../data/reference/moves.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet, InventoryEntry } from '~/types/trainerSheet'
import { resolvedSheetFeatureClosure, sheetHasCanonicalFeature } from '#shared/featureAutomation/sheetFeatures'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from '#shared/featureAutomation/manifest'
import { settleFeatureDeclarationResources } from '../domain/featureAutomation/resources'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { createSqliteRealtimeEventRepository } from '../storage/realtimeEventRepository'
import { deduplicateAuthoritativeSheetDocumentUpdates, sheetDocumentUpdatedRealtimeAppendInput } from '../realtime/sheetDocumentRealtime'
import { publishPersistedRealtimeEventsAfterCommit, defaultPersistedRealtimeEventPublisher, defaultPersistedRealtimePublicationFailureReporter } from '../realtime/persistedBatchPublication'

export interface ContestPreparationDependencies { readonly database?: RotomDatabase, readonly sheets?: SheetRepository<Record<string, unknown>>, readonly now?: () => number }
export interface ContestPreparationActor { readonly role: AuthRole, readonly playerProfile?: PlayerProfile|null }
export class ContestPreparationUseCaseError extends Error { constructor(readonly statusCode: 400|403|404|409, readonly code: string, message: string) { super(message); this.name = 'ContestPreparationUseCaseError' } }
const fail = (status: 400|403|404|409, code: string, message: string): never => { throw new ContestPreparationUseCaseError(status, code, message) }
const linked = (profile: PlayerProfile, kind: 'trainer'|'pokemon', slug: string): boolean => profile.linkedCharacters.some(ref => ref.sheetKind === kind && ref.sheetSlug === slug)
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const normalizedMoveName = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').trim().toLowerCase().replace(/[^a-z0-9]+/gu, '')
const canonicalMoveNames = new Set(Object.entries(movesJson as Record<string, { readonly name?: string }>).flatMap(([id, row]) => [normalizedMoveName(id), normalizedMoveName(row.name ?? id)]))
const parseResult = (value: unknown): ContestPreparationResultV1 => value as ContestPreparationResultV1
const findRow = (trainer: TrainerSheet, section: 'foodStuff'|'pokemonItems', rowId: string): InventoryEntry => trainer.inventory?.[section]?.find(row => row.id === rowId) ?? fail(409, 'contest.item-source-stale', 'Poffin inventory source is missing or stale.')
const quantity = (row: InventoryEntry): number => Math.max(0, Math.floor(row.qty ?? 0))
const itemPresent = (row: InventoryEntry): boolean => row.qty === undefined || quantity(row) > 0
const decrement = (rows: InventoryEntry[], row: InventoryEntry, count = 1): void => {
  const remaining = quantity(row) - count
  if (remaining < 0) fail(409, 'contest.item-source-stale', 'Inventory quantity is no longer sufficient.')
  if (remaining === 0) rows.splice(rows.indexOf(row), 1)
  else row.qty = remaining
}
const getSheet = <T extends CharacterSheet|TrainerSheet>(repo: SheetRepository<Record<string, unknown>>, kind: 'pokemon'|'trainer', slug: string): { sheet: T, revision: number } => {
  const row = repo.get(kind, slug) ?? fail(404, 'contest.sheet-not-found', `${kind} sheet was not found.`)
  return { sheet: structuredClone(row.document) as unknown as T, revision: row.revision }
}
const assertActor = (actor: ContestPreparationActor, command: ContestPreparationCommandV1): void => {
  if (actor.role === 'gm') return
  const profile = actor.playerProfile ?? fail(403, 'contest.profile-required', 'Select a player profile first.')
  if (!linked(profile, 'trainer', command.trainerSheetSlug) || ('pokemonSheetSlug' in command && !linked(profile, 'pokemon', command.pokemonSheetSlug))) fail(403, 'contest.controller-required', 'These preparation resources belong to another player profile.')
}

export const executeContestPreparationUseCase = (value: unknown, actor: ContestPreparationActor, dependencies: ContestPreparationDependencies = {}): ContestPreparationResultV1 => {
  let command: ContestPreparationCommandV1
  try { command = parseContestPreparationCommand(value) } catch (error) { return fail(400, 'contest.preparation-command-invalid', error instanceof Error ? error.message : 'Invalid preparation command.') }
  assertActor(actor, command)
  if (command.commandKind === 'bind-created-move' && actor.role !== 'gm') fail(403, 'contest.gm-required', 'A GM must review and bind a created Move’s Contest identity.')
  const database = dependencies.database ?? dependencies.sheets?.database ?? getRotomDatabase()
  const sheets = dependencies.sheets ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const commandHash = hash(command)
  const existing = database.connection.prepare('SELECT command_hash, result_json FROM contest_preparation_operations WHERE operation_id = ?').get(command.operationId) as { command_hash?: unknown, result_json?: unknown } | undefined
  if (existing) {
    if (existing.command_hash !== commandHash || typeof existing.result_json !== 'string') fail(409, 'contest.operation-conflict', 'Preparation operation ID was reused with changed input.')
    return Object.freeze({ ...parseResult(JSON.parse(existing.result_json as string)), exactRetry: true })
  }
  const now = dependencies.now?.() ?? Date.now()
  let events: readonly PersistedRealtimeEvent[] = []
  let result!: ContestPreparationResultV1
  database.withTransaction(() => {
    const trainerCurrent = getSheet<TrainerSheet>(sheets, 'trainer', command.trainerSheetSlug)
    if (trainerCurrent.revision !== command.trainerRevision) fail(409, 'contest.revision-conflict', `Trainer sheet changed; current revision is ${trainerCurrent.revision}.`)
    const trainer = trainerCurrent.sheet
    let pokemonCurrent: ReturnType<typeof getSheet<CharacterSheet>> | null = null
    let pokemon: CharacterSheet | null = null
    if ('pokemonSheetSlug' in command) {
      pokemonCurrent = getSheet<CharacterSheet>(sheets, 'pokemon', command.pokemonSheetSlug)
      if (pokemonCurrent.revision !== command.pokemonRevision) fail(409, 'contest.revision-conflict', `Pokémon sheet changed; current revision is ${pokemonCurrent.revision}.`)
      pokemon = pokemonCurrent.sheet
    }
    const integration = contestTrainerIntegrations(trainer)
    const campaignDay = Math.floor(createSqliteCampaignClockRepository(database).get().campaignMinute / 1_440)
    let message = ''
    if (command.commandKind === 'consume-poffin') {
      const check = canConsumeContestPoffin({ sheet: pokemon!, hasGrace: integration.hasGrace })
      if (!check.ok) fail(409, check.code, check.reason)
      const row = findRow(trainer, command.sourceSection, command.sourceRowId)
      if (row.name !== 'Poffin' || row.serializedEquipment || row.itemVariant || quantity(row) < 1) fail(409, 'contest.item-source-stale', 'Selected source is not an available canonical Poffin stack.')
      if (row.contestPoffinStatId && row.contestPoffinStatId !== command.statId) fail(409, 'contest.poffin-stat-mismatch', `This crafted Poffin raises ${row.contestPoffinStatId}, not ${command.statId}.`)
      decrement(trainer.inventory![command.sourceSection]!, row)
      const state = parsePokemonContestStatsState(pokemon!.contestStats)
      pokemon!.contestStats = { ...state, poffins: [...state.poffins, Object.freeze({ entryId: `poffin:${pokemon!.slug}:${state.poffins.length + 1}`, statId: command.statId, sourceItemId: 'Poffin', sourceInventoryInstanceId: `trainer:${trainer.slug}:${command.sourceSection}:${command.sourceRowId}`, sourceOperationId: command.operationId, consumedAt: now })] }
      message = `Poffin consumed for +1d6 ${command.statId}.`
    } else if (command.commandKind === 'record-grooming') {
      if (!integration.hasGroomer) fail(403, 'contest.groomer-required', 'Trainer does not have the Groomer Edge.')
      const kit = Object.values(trainer.inventory ?? {}).flat().find(row => (row.name === 'Groomer’s Kit' || row.name === "Groomer's Kit") && itemPresent(row))
      if (!kit) fail(409, 'contest.groomer-kit-required', 'A Groomer’s Kit is required.')
      const state = parsePokemonContestStatsState(pokemon!.contestStats)
      pokemon!.contestStats = { ...state, grooming: { campaignDay, sourceTrainerSlug: trainer.slug, sourceOperationId: command.operationId, groomedAt: now } }
      message = 'Grooming recorded for the current campaign day.'
    } else if (command.commandKind === 'bind-created-move') {
      if (!sheetHasCanonicalFeature(trainer, command.sourceFeatureId)) fail(403, 'contest.feature-required', `Trainer does not have ${command.sourceFeatureId}.`)
      if (command.sourceFeatureId === 'Passing Waltz' && command.effectId !== 'get-ready') fail(400, 'contest.created-move-effect-invalid', 'Passing Waltz Dance Moves use Get Ready!.')
      if (command.sourceFeatureId === 'Beguiling Dance' && command.effectId !== 'excitement') fail(400, 'contest.created-move-effect-invalid', 'Beguiling Dance Moves use Excitement.')
      const normalizedName = command.moveName.normalize('NFKC').trim().toLowerCase()
      if (canonicalMoveNames.has(normalizedMoveName(command.moveName))) fail(409, 'contest.created-move-canonical', 'Canonical Moves keep their reviewed app-owned Contest identity and cannot be rebound.')
      const createdMoves = [...(pokemon!.movelist ?? []), ...(pokemon!.appliedMoves ?? [])]
      const createdMove = createdMoves.find(row => row.name.normalize('NFKC').trim().toLowerCase() === normalizedName)
        ?? fail(409, 'contest.created-move-missing', 'The named created Move is not on this Pokémon sheet.')
      if (createdMove.contestIdentity) fail(409, 'contest.created-move-immutable', 'This created Move already has an immutable accepted Contest identity.')
      if (command.sourceFeatureId === 'Innovation' && createdMoves.some(row => row.contestIdentity?.sourceFeatureId === 'Innovation')) fail(409, 'contest.created-move-limit', 'A Pokémon may retain only one Innovation-created Move at a time.')
      createdMove.contestIdentity = { schemaVersion: 1, status: 'defined', typeId: command.typeId, effectId: command.effectId, sourceFeatureId: command.sourceFeatureId, sourceOperationId: command.operationId, boundAt: now }
      message = `${command.moveName} bound to ${command.typeId} / ${command.effectId} through reviewed created-Move authority.`
    } else if (command.commandKind === 'flexible-preparations') {
      const instance = resolvedSheetFeatureClosure(trainer).find(row => row.canonicalId === 'Flexible Preparations') ?? fail(403, 'contest.feature-required', 'Trainer does not have Flexible Preparations.')
      const frequency = FEATURE_AUTOMATION_MANIFEST_BY_ID.get('Flexible Preparations')?.actions[0]?.frequency ?? fail(409, 'contest.feature-source-stale', 'Flexible Preparations has no reviewed resource contract.')
      const settlement = settleFeatureDeclarationResources({ sheet: trainer, canonicalId: 'Flexible Preparations', sourceInstanceId: instance.instanceId, frequency, scope: { campaignId: 'campaign', sceneId: `campaign-day:${campaignDay}`, dayId: `campaign-day:${campaignDay}`, roundNumber: null, now }, operationId: command.operationId })
      if (!settlement.accepted) fail(409, `contest.${settlement.code ?? 'resource-exhausted'}`, 'Flexible Preparations has already been used this campaign day or cannot pay its ordinary sheet resource.')
      const state = parsePokemonContestStatsState(pokemon!.contestStats)
      const preparation = derivePokemonContestPreparation(pokemon!, { hasGrace: integration.hasGrace, styleExpertStatIds: integration.styleExpertStatIds, campaignDay })
      if (preparation.rows[command.fromStatId].poffinDiceActive < command.dice) fail(409, 'contest.resource-exhausted', 'Not enough active Poffin-derived dice are available to reallocate.')
      trainer.featureApState = settlement.apState; trainer.featureUsage = settlement.usage
      pokemon!.contestStats = { ...state, reallocations: [...state.reallocations.filter(row => row.campaignDay === campaignDay), { reallocationId: `contest-reallocation:${pokemon!.slug}:${command.operationId.split(':').at(-1)}`, fromStatId: command.fromStatId, toStatId: command.toStatId, dice: command.dice, campaignDay, sourceTrainerSlug: trainer.slug, sourceFeatureId: 'Flexible Preparations', sourceOperationId: command.operationId }] }
      message = `${command.dice} Poffin dice reallocated for this campaign day.`
    } else if (command.commandKind === 'craft-contest-item') {
      if (!sheetHasCanonicalFeature(trainer, 'Contest Trends')) fail(403, 'contest.feature-required', 'Trainer does not have Contest Trends.')
      const prices = { 'Contest Accessory': 750, 'Contest Fashion': 500, 'Fancy Clothes': 2500 } as const
      const cost = prices[command.itemId]
      if ((trainer.money ?? 0) < cost) fail(409, 'contest.crafting-cost', `${command.itemId} crafting requires $${cost}.`)
      trainer.money = Math.max(0, Math.floor(trainer.money ?? 0) - cost)
      trainer.inventory ??= {}
      const section = command.itemId === 'Fancy Clothes' ? 'equipment' : 'pokemonItems'
      trainer.inventory[section] ??= []
      const rows = trainer.inventory[section]!
      if (section === 'equipment') rows.push({ id: `contest-trends-${command.operationId.split(':').at(-1)}`, name: command.itemId })
      else {
        const existing = rows.find(row => row.name === command.itemId && !row.itemVariant && !row.serializedEquipment)
        if (existing) existing.qty = quantity(existing) + 1
        else rows.push({ id: `contest-trends-${command.operationId.split(':').at(-1)}`, name: command.itemId, qty: 1 })
      }
      message = `${command.itemId} crafted for $${cost} through Contest Trends.`
    } else {
      if (!Object.values(trainer.inventory ?? {}).flat().some(row => row.name === 'Poffin Mixer' && itemPresent(row))) fail(409, 'contest.poffin-mixer-required', 'A Poffin Mixer is required.')
      const mechanics = (itemsJson as Record<string, any>)['Poffin Mixer']?.contestMechanics
      const allowed = new Set<string>(mechanics?.reviewedBerryStatMapping?.[command.statId] ?? [])
      const selectedName = command.reviewedBerryItemIds.find(id => allowed.has(id))
      if (!selectedName) fail(400, 'contest.berry-mapping-invalid', 'Choose a berry from the reviewed mapping for this Contest stat.')
      const inventorySections = Object.entries(trainer.inventory ?? {}) as Array<[string, InventoryEntry[] | undefined]>
      const sourceSection = inventorySections.find(([, rows]) => rows?.some((row: InventoryEntry) => row.name === selectedName && quantity(row) > 0))
      if (!sourceSection) fail(409, 'contest.berry-source-missing', 'Selected reviewed berry is not in this Trainer inventory.')
      const sourceRows = sourceSection![1]!
      const berry = sourceRows.find((row: InventoryEntry) => row.name === selectedName && quantity(row) > 0)!
      if ((trainer.money ?? 0) < 500) fail(409, 'contest.crafting-cost', 'Poffin crafting requires $500 of ingredients.')
      decrement(sourceRows, berry); trainer.money = (trainer.money ?? 0) - 500
      trainer.inventory ??= {}; trainer.inventory.foodStuff ??= []
      const poffin = trainer.inventory.foodStuff.find(row => row.name === 'Poffin' && row.contestPoffinStatId === command.statId && !row.itemVariant && !row.serializedEquipment)
      if (poffin) poffin.qty = quantity(poffin) + 2
      else trainer.inventory.foodStuff.push({ id: `poffin-${command.operationId.split(':').at(-1)}`, name: 'Poffin', qty: 2, contestPoffinStatId: command.statId })
      message = `Two ${command.statId} Poffins crafted through the reviewed berry mapping.`
    }
    const trainerStatus = sheets.applyLivePlayUpdate({ kind: 'trainer', slug: trainer.slug, expectedRevision: trainerCurrent.revision, nextSheet: trainer as unknown as Record<string, unknown>, sourceOperationId: command.operationId })
    if (trainerStatus !== 'applied') fail(409, 'contest.revision-conflict', 'Trainer sheet changed during preparation.')
    if (pokemon && pokemonCurrent) {
      const pokemonStatus = sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: pokemon.slug, expectedRevision: pokemonCurrent.revision, nextSheet: pokemon as unknown as Record<string, unknown>, sourceOperationId: command.operationId })
      if (pokemonStatus !== 'applied') fail(409, 'contest.revision-conflict', 'Pokémon sheet changed during preparation.')
    }
    const storedTrainer = sheets.get('trainer', trainer.slug)!
    const storedPokemon = pokemon ? sheets.get('pokemon', pokemon.slug)! : null
    result = Object.freeze({ schemaVersion: 1, operationId: command.operationId, commandKind: command.commandKind, exactRetry: false, trainerRevision: storedTrainer.revision, pokemonRevision: storedPokemon?.revision ?? null, message })
    database.connection.prepare('INSERT INTO contest_preparation_operations (operation_id, pokemon_sheet_slug, trainer_sheet_slug, command_hash, command_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(command.operationId, pokemon?.slug ?? '', trainer.slug, commandHash, stableJsonStringify(command), stableJsonStringify(result), now)
    const updates = deduplicateAuthoritativeSheetDocumentUpdates([
      { kind: 'trainer', slug: storedTrainer.slug, sheet: storedTrainer.document },
      ...(storedPokemon ? [{ kind: 'pokemon' as const, slug: storedPokemon.slug, sheet: storedPokemon.document }] : []),
    ])
    const realtime = createSqliteRealtimeEventRepository({ database })
    events = realtime.appendMany(updates.map(update => sheetDocumentUpdatedRealtimeAppendInput({ update, destination: 'specific', dedupeKey: `${command.operationId}:${update.kind}:${update.slug}` })))
  })
  publishPersistedRealtimeEventsAfterCommit({ events, operation: command.commandKind, publish: defaultPersistedRealtimeEventPublisher, reportFailure: defaultPersistedRealtimePublicationFailureReporter })
  return result
}
