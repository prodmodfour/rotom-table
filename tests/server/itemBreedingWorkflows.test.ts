import { afterEach, describe, expect, it } from 'vitest'
import {
  parseItemBreedingOperationResult,
  parseItemBreedingSourcePreview,
  parseItemBreedingWorkflowProjection,
} from '#shared/breeding/itemWorkflows'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import {
  executeItemBreedingOperation,
  loadItemBreedingWorkflows,
  previewItemBreedingSourceWorkflow,
} from '../../server/useCases/manageItemBreedingWorkflows'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PlayerProfile } from '#shared/playerProfiles'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()?.close() })
const operationId = (character: string) => `item-breeding:v1:${character.repeat(32)}`
const gm = { role: 'gm' as const, playerProfile: null }
const saveTrainer = (database: RotomDatabase, document: TrainerSheet, revision = 3) => createSqliteSheetRepository(database).save({
  kind: 'trainer', slug: document.slug, document, revision, updatedAt: 100,
})
const selected = (preview: ReturnType<typeof parseItemBreedingSourcePreview>, labels: Readonly<Record<string, string>>) => preview.choices.map(choice => {
  const expected = labels[choice.label]
  const option = expected
    ? choice.options.find(value => value.label === expected)
    : choice.options[0]
  if (!option) throw new Error(`Missing test option for ${choice.label}: ${expected ?? 'first'}`)
  return option.optionId
}).sort()

describe('P8-058 breeding item workflows', () => {
  it('projects exact reusable tools without exposing inventory row identities', () => {
    const database = open()
    saveTrainer(database, {
      slug: 'trainer-tools', name: 'Tool Keeper', level: 10, money: 5_000,
      skillBackground: { novice: 'pokeEd' }, skills: { techEd: { rankBonus: 3 } },
      edges: [{ name: 'Paleontologist' }],
      features: [{ name: 'Playing God', choices: { species: 'Castform' } }],
      currentTeam: [], boxedPokemon: [],
      inventory: { keyItems: [
        { id: 'warmer-row-private', name: 'Egg Warmer', qty: 1 },
        { id: 'machine-row-private', name: 'Reanimation Machine', qty: 1 },
        { id: 'chemistry-row-private', name: 'Chemistry Set', qty: 1 },
        { id: 'sample-row-private', name: 'Stone Sample', qty: 1 },
      ] },
    })
    const projection = parseItemBreedingWorkflowProjection(loadItemBreedingWorkflows({
      authority: gm, trainerSheetSlug: 'trainer-tools',
    }, { database }))
    expect(projection).toMatchObject({
      audience: 'gm', trainer: { trainerSheetSlug: 'trainer-tools', trainerRevision: 3 },
      eggWarmer: { capacity: 4, progressRateNumerator: 2, progressRateDenominator: 1 },
      fossil: { consumesFossilSource: 1, consumesMachine: 0 },
      artificial: { moneyCost: 3500, consumesChemistrySet: 0 },
    })
    expect(JSON.stringify(projection)).not.toContain('row-private')
    expect(projection.fossil.availability, JSON.stringify(projection.fossil.availability)).toMatchObject({ enabled: true })
    expect(projection.artificial.availability, JSON.stringify(projection.artificial.availability)).toMatchObject({ enabled: true })
  })

  it('projects source-Egg workflows as unavailable to an owner and rejects player designation authority', () => {
    const database = open()
    saveTrainer(database, {
      slug: 'trainer-player-tools', name: 'Player Keeper', level: 10, money: 5_000,
      skillBackground: { novice: 'pokeEd' }, edges: [{ name: 'Paleontologist' }],
      features: [{ name: 'Playing God', choices: { species: 'Castform' } }],
      currentTeam: [], boxedPokemon: [], inventory: { keyItems: [
        { id: 'player-source-private', name: 'Stone Sample', qty: 1 },
        { id: 'player-machine-private', name: 'Reanimation Machine', qty: 1 },
        { id: 'player-chemistry-private', name: 'Chemistry Set', qty: 1 },
      ] },
    })
    const profile: PlayerProfile = {
      schemaVersion: 1, id: 'profile_owner_0058', displayName: 'Owner',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-player-tools' }],
    }
    const authority = { role: 'player' as const, playerProfile: profile }
    const projection = loadItemBreedingWorkflows({ authority, trainerSheetSlug: 'trainer-player-tools' }, { database })
    expect(projection).toMatchObject({
      audience: 'owner',
      fossil: { availability: { enabled: false, unavailableReason: 'A GM must designate and restore Fossils.' } },
      artificial: { availability: { enabled: false, unavailableReason: 'A GM must authorize Playing God creation.' } },
    })
    expect(JSON.stringify(projection)).not.toContain('private')
    expect(() => previewItemBreedingSourceWorkflow({ authority, request: {
      schemaVersion: 1, action: 'preview-fossil', operationId: operationId('d'),
      trainerSheetSlug: 'trainer-player-tools', expectedTrainerRevision: 3,
      fossilSourceOptionId: projection.fossil.sourceOptions[0]!.optionId,
      machineOptionId: projection.fossil.machineOptions[0]!.optionId,
      speciesOptionId: projection.fossil.speciesOptions[0]!.optionId,
    } }, { database })).toThrow('Only a GM may designate and restore a Fossil')
  })

  it('restores one Fossil through the existing Egg lifecycle, consumes only the source, and replays exactly', () => {
    const database = open()
    saveTrainer(database, {
      slug: 'trainer-fossil-item', name: 'Fossil Researcher', level: 20, money: 0,
      skillBackground: { novice: 'pokeEd' }, edges: [{ name: 'Paleontologist' }], features: [],
      currentTeam: [], boxedPokemon: [], inventory: { keyItems: [
        { id: 'fossil-source-row', name: 'Unidentified Stone Sample', qty: 1 },
        { id: 'reanimation-row', name: 'Reanimation Machine', qty: 1 },
      ] },
    })
    const projection = loadItemBreedingWorkflows({ authority: gm, trainerSheetSlug: 'trainer-fossil-item' }, { database })
    const op = operationId('a')
    const source = projection.fossil.sourceOptions[0]!
    const machine = projection.fossil.machineOptions[0]!
    const species = projection.fossil.speciesOptions.find(value => value.label === 'Omanyte')!
    const preview = parseItemBreedingSourcePreview(previewItemBreedingSourceWorkflow({ authority: gm, request: {
      schemaVersion: 1, action: 'preview-fossil', operationId: op,
      trainerSheetSlug: 'trainer-fossil-item', expectedTrainerRevision: 3,
      fossilSourceOptionId: source.optionId, machineOptionId: machine.optionId, speciesOptionId: species.optionId,
    } }, { database }))
    const selectedOptionIds = selected(preview, { Nature: 'Cuddly', 'Basic Ability': 'Shell Armor', Gender: 'Female' })
    const command = {
      schemaVersion: 1 as const, kind: 'restore-fossil' as const, operationId: op,
      trainerSheetSlug: 'trainer-fossil-item', expectedTrainerRevision: 3,
      fossilSourceOptionId: source.optionId, machineOptionId: machine.optionId, speciesOptionId: species.optionId,
      selectedOptionIds,
    }
    const result = parseItemBreedingOperationResult(executeItemBreedingOperation({ authority: gm, command }, { database, now: () => 500 }))
    expect(result).toMatchObject({ status: 'accepted', kind: 'restore-fossil', trainerRevision: 4,
      egg: { sourceKind: 'fossil', speciesName: 'Omanyte', startingLevel: 10, status: 'incubating' } })
    expect(createSqliteSheetRepository(database).getByRef('trainer', 'trainer-fossil-item')?.sheet).toMatchObject({
      inventory: { keyItems: [{ id: 'reanimation-row', name: 'Reanimation Machine', qty: 1 }] },
    })
    expect(createSqlitePokemonEggRepository(database).listByOwner('trainer-fossil-item')).toHaveLength(1)
    expect(executeItemBreedingOperation({ authority: gm, command }, { database })).toEqual(result)
  })

  it('creates a Playing God Artificial Egg, spends $3500, preserves Chemistry Set custody, and rejects changed replay input', () => {
    const database = open()
    saveTrainer(database, {
      slug: 'trainer-artificial-item', name: 'Researcher', level: 20, money: 5_000,
      skillBackground: { novice: ['pokeEd'] }, skills: { techEd: { rankBonus: 3 } },
      edges: [], features: [{ name: 'Playing God', choices: { species: 'Castform' } }],
      currentTeam: [], boxedPokemon: [], inventory: { keyItems: [
        { id: 'chemistry-row', name: 'Chemistry Set', qty: 1 },
        { id: 'warmer-row', name: 'Egg Warmer', qty: 1 },
      ] },
    })
    const projection = loadItemBreedingWorkflows({ authority: gm, trainerSheetSlug: 'trainer-artificial-item' }, { database })
    const op = operationId('b')
    const chemistry = projection.artificial.chemistryOptions[0]!
    const preview = parseItemBreedingSourcePreview(previewItemBreedingSourceWorkflow({ authority: gm, request: {
      schemaVersion: 1, action: 'preview-artificial', operationId: op,
      trainerSheetSlug: 'trainer-artificial-item', expectedTrainerRevision: 3, chemistryOptionId: chemistry.optionId,
    } }, { database }))
    const selectedOptionIds = selected(preview, {
      Nature: 'Cuddly', 'Basic Ability': 'Forecast',
      'Playing God upgrade 1': 'Coloration · cool',
      'Playing God upgrade 2': 'Move · Ominous Wind',
      'Playing God upgrade 3': 'Base Stat · HP',
      'Playing God upgrade 4': 'Base Stat · ATK',
      'Playing God upgrade 5': 'Base Stat · DEF',
    })
    const command = { schemaVersion: 1 as const, kind: 'create-artificial-egg' as const, operationId: op,
      trainerSheetSlug: 'trainer-artificial-item', expectedTrainerRevision: 3,
      chemistryOptionId: chemistry.optionId, selectedOptionIds }
    const result = executeItemBreedingOperation({ authority: gm, command }, { database, now: () => 600 })
    expect(result).toMatchObject({ status: 'accepted', kind: 'create-artificial-egg', trainerRevision: 4,
      egg: { sourceKind: 'feature-artificial', speciesName: 'Castform', startingLevel: 5 } })
    expect(createSqliteSheetRepository(database).getByRef('trainer', 'trainer-artificial-item')?.sheet).toMatchObject({
      money: 1_500, inventory: { keyItems: [
        { id: 'chemistry-row', name: 'Chemistry Set', qty: 1 },
        { id: 'warmer-row', name: 'Egg Warmer', qty: 1 },
      ] },
    })
    expect(() => executeItemBreedingOperation({ authority: gm, command: { ...command, selectedOptionIds: selectedOptionIds.slice(1) } }, { database }))
      .toThrow('Item breeding operation ID was reused with changed input')

    const afterCreation = loadItemBreedingWorkflows({ authority: gm, trainerSheetSlug: 'trainer-artificial-item' }, { database })
    const assignment = executeItemBreedingOperation({ authority: gm, command: {
      schemaVersion: 1, kind: 'assign-egg-warmer', operationId: operationId('c'),
      trainerSheetSlug: 'trainer-artificial-item', expectedTrainerRevision: 4,
      warmerUnitOptionId: afterCreation.eggWarmer.units[0]!.optionId,
      eggOptionIds: [afterCreation.eggWarmer.eggs[0]!.optionId],
    } }, { database, now: () => 700 })
    expect(assignment).toMatchObject({ status: 'accepted', kind: 'assign-egg-warmer', trainerRevision: 5,
      assignment: { assignedEggLabels: ['Castform Egg'], capacity: 4, progressRateNumerator: 2 } })
    expect(createSqliteSheetRepository(database).get('trainer', 'trainer-artificial-item')?.document).toMatchObject({
      serverPrivate: { itemBreeding: { eggWarmerAssignments: [{ inventoryEntryId: 'warmer-row', unitOrdinal: 0 }] } },
    })
  })
})
