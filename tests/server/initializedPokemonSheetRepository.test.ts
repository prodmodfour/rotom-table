import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import sheetContractJson from '../../data/breeding-automation/initialized-pokemon-sheet-contract.json'
import type { CharacterSheet } from '../../src/types/characterSheet'
import { normalizeCharacterSheet } from '../../src/utils/sheetNormalize'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import {
  InitializedPokemonSheetValidationError,
  createSqliteInitializedPokemonSheetRepository,
  type CreateInitializedPokemonSheetInput,
} from '../../server/storage/initializedPokemonSheetRepository'

const databases: RotomDatabase[] = []
const tempRoots: string[] = []
const open = (path = ':memory:'): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: path !== ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})
const completeDocument = (): CreateInitializedPokemonSheetInput['document'] => {
  const normalized = normalizeCharacterSheet({
    slug: 'normalization-only', nickname: 'Sprout', species: 'Bulbasaur', level: 1, totalExp: 0,
    gender: 'Female', loyalty: 3, shiny: false, caughtBall: 'Basic Ball', player: false,
    nature: 'Cuddly', babyTemplate: false, inheritedRemaining: 0,
    serverPrivate: { breedingProviderTraits: { serpentsMark: null, fossilRestoration: null, prehistoricBond: null, coreHatchRules: {
      loyaltyRank: 3, startingTutorPoints: 1, providerEvidenceDefinitionSha256s: ['1'.repeat(64), '2'.repeat(64)],
      handoffDefinitionSha256: '3'.repeat(64), sourceEggId: 'pokemon-egg:v1:11111111111111111111111111111111',
    } } },
    combat: { currentHp: 11 }, abilities: [{ name: 'Overgrow' }],
  } as CharacterSheet) as CharacterSheet & Record<string, unknown>
  const candidate = { ...normalized }
  delete candidate.slug
  delete candidate.revision
  return candidate as CreateInitializedPokemonSheetInput['document']
}
const input = (overrides: Partial<CreateInitializedPokemonSheetInput> = {}): CreateInitializedPokemonSheetInput => ({
  baseSlug: 'Sprout', folder: 'Players/Ash/Box', updatedAt: 1_700_000_000_000,
  document: completeDocument(), ...overrides,
})
const rows = (database: RotomDatabase): Array<Record<string, unknown>> => database.connection.prepare(`
  SELECT kind, slug, document_json, revision, updated_at FROM sheets ORDER BY kind, slug
`).all() as Array<Record<string, unknown>>

describe('atomic initialized Pokémon sheet repository', () => {
  it('binds the reviewed no-placeholder, collision, transaction, and authority contract', () => {
    const policy = sheetContractJson as Record<string, any>
    const digest = createHash('sha256').update(stableJsonStringify(policy.definition)).digest('hex')
    expect(policy.definitionSha256).toBe(digest)
    expect(policy.definition.insert).toMatchObject({ kind: 'pokemon', revision: 0, placeholderWrite: 'forbidden', writesPerChild: 1 })
    expect(policy.definition.slugAllocation).toMatchObject({ scope: 'pokemon-sheet-kind', strategy: 'slugified-root-then-monotonic-numeric-suffix', maximumAttempts: 10_000 })
    expect(policy.definition.transaction).toMatchObject({ standalone: 'BEGIN-IMMEDIATE', callerOwnedParticipation: true, failedAttemptIsolation: 'SQLite-savepoint' })
    expect(policy.definition.authority).toMatchObject({ mapDependency: 'none', encounterDependency: 'none', eggSheetKind: 'none', browserWrite: 'none' })
  })

  it('inserts one complete revision-zero child and allocates deterministic collision suffixes', () => {
    const database = open()
    const repository = createSqliteInitializedPokemonSheetRepository({ database })
    const first = repository.create(input())
    const second = repository.create(input({ updatedAt: 1_700_000_000_001 }))
    const trainer = { slug: 'sprout', name: 'Trainer', level: 1, revision: 0, updatedAt: 1 }
    database.connection.prepare(`INSERT INTO sheets (kind, slug, document_json, revision, updated_at) VALUES ('trainer', 'sprout-2', ?, 0, 1)`).run(JSON.stringify(trainer))
    const third = repository.create(input({ updatedAt: 1_700_000_000_002 }))

    expect([first.slug, second.slug, third.slug]).toEqual(['sprout', 'sprout-1', 'sprout-2'])
    expect(first).toMatchObject({ kind: 'pokemon', revision: 0, folder: 'Players/Ash/Box', path: 'data/sheets/Players/Ash/Box/sprout.json' })
    expect(first.sheet).toMatchObject({ slug: 'sprout', revision: 0, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, species: 'Bulbasaur', nickname: 'Sprout' })
    const pokemonRows = rows(database).filter(row => row.kind === 'pokemon')
    expect(pokemonRows).toHaveLength(3)
    expect(pokemonRows.every(row => {
      const document = JSON.parse(String(row.document_json)) as Record<string, unknown>
      return document.species === 'Bulbasaur' && document.nickname === 'Sprout' && document.revision === 0 && document.slug === row.slug
    })).toBe(true)
  })

  it('uses a savepoint so injected failure leaves no child or folder even when the caller catches it', () => {
    const database = open()
    const repository = createSqliteInitializedPokemonSheetRepository({ database, afterSheetInsert: () => { throw new Error('injected after insert') } })
    database.withTransaction(() => {
      try { repository.create(input()) } catch (error) { expect(String(error)).toContain('injected after insert') }
      database.connection.prepare(`INSERT INTO sheets (kind, slug, document_json, revision, updated_at) VALUES ('trainer', 'survivor', '{}', 0, 1)`).run()
    })
    expect(rows(database).map(row => `${row.kind}:${row.slug}`)).toEqual(['trainer:survivor'])
    expect(database.connection.prepare(`SELECT path FROM sheet_folders WHERE kind = 'pokemon'`).all()).toEqual([])
  })

  it('participates in caller rollback and survives a file-database restart as one complete row', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-initialized-sheet-')); tempRoots.push(root)
    const path = join(root, 'campaign.sqlite')
    let database = open(path)
    const repository = createSqliteInitializedPokemonSheetRepository({ database })
    expect(() => database.withTransaction(() => { repository.create(input()); throw new Error('abort caller') })).toThrow('abort caller')
    expect(rows(database)).toEqual([])
    repository.create(input())
    database.close(); databases.splice(databases.indexOf(database), 1)
    database = open(path)
    const persisted = rows(database)
    expect(persisted).toHaveLength(1)
    expect(JSON.parse(String(persisted[0]?.document_json))).toMatchObject({ slug: 'sprout', species: 'Bulbasaur', revision: 0 })
  })

  it('rejects placeholders, unknown authority, non-canonical facts, and enriched input before any write', () => {
    const database = open()
    const repository = createSqliteInitializedPokemonSheetRepository({ database })
    const attempts: CreateInitializedPokemonSheetInput[] = [
      input({ document: { nickname: 'Blank', species: '' } as any }),
      input({ document: { ...completeDocument(), species: 'MissingNo' } as any }),
      input({ document: { ...completeDocument(), abilities: [{ name: 'Not An Ability' }] } as any }),
      input({ document: { ...completeDocument(), unknownHatchFact: true } as any }),
      input({ document: { ...completeDocument(), slug: 'forged' } as any }),
      input({ baseSlug: '../escape' }),
    ]
    const enriched = completeDocument() as Record<string, unknown>
    Object.defineProperty(enriched, 'hidden', { value: true, enumerable: false })
    attempts.push(input({ document: enriched as any }))
    const accessor = completeDocument() as Record<string, unknown>
    Object.defineProperty(accessor, 'nickname', { get: () => 'Getter', enumerable: true })
    attempts.push(input({ document: accessor as any }))

    for (const attempt of attempts) expect(() => repository.create(attempt)).toThrow(InitializedPokemonSheetValidationError)
    expect(rows(database)).toEqual([])
  })
})
