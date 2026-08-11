import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BREEDING_PRODUCTION_ACCEPTANCE_PROFILE_DEFINITION_SHA256,
  BREEDING_PRODUCTION_ACCEPTANCE_PROFILE_V1,
} from '../../scripts/breedingProductionAcceptance'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { loadBreedingWorkshop } from '../../server/useCases/loadBreedingWorkshop'

const ROOT = resolve(import.meta.dirname, '../..')
const databases: RotomDatabase[] = []
const tempRoots: string[] = []
const open = (path: string): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: true })
  databases.push(database)
  return database
}
const close = (database: RotomDatabase): void => {
  const index = databases.indexOf(database)
  if (index >= 0) databases.splice(index, 1)
  database.close()
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const profile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_production01' as never,
  displayName: 'Production Player' as never,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-mira' }],
}
const saveTrainer = (database: RotomDatabase, slug: string, name: string): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('trainer', slug, {
    slug,
    revision: 0,
    updatedAt: 100,
    name,
    currentTeam: [],
    boxedPokemon: [],
  })
}
const loadGm = (database: RotomDatabase) => loadBreedingWorkshop({
  role: 'gm',
  playerProfile: null,
  query: { trainerSheetSlug: 'trainer-mira', ownershipCursor: null },
}, { database })
const loadPlayer = (database: RotomDatabase) => loadBreedingWorkshop({
  role: 'player',
  playerProfile: profile,
  query: { trainerSheetSlug: 'trainer-mira', ownershipCursor: null },
}, { database })

describe('BR-087 production-like Breeding acceptance', () => {
  it('binds every production topology scenario to executable evidence', () => {
    const acceptance = BREEDING_PRODUCTION_ACCEPTANCE_PROFILE_V1
    expect(sha256(acceptance)).toBe(BREEDING_PRODUCTION_ACCEPTANCE_PROFILE_DEFINITION_SHA256)
    expect(acceptance).toMatchObject({
      schemaVersion: 1,
      ticket: 'BR-087',
      dataPolicy: 'synthetic-no-campaign-data',
      topology: {
        server: 'production-nitro-127.0.0.1:3017',
        storage: 'file-backed-sqlite-wal',
        browserContexts: ['authenticated-gm', 'selected-profile-player'],
        browserProjects: ['chromium', 'mobile-chromium'],
      },
      releaseCommand: 'npm run test:breeding-production-acceptance',
    })
    expect(acceptance.scenarios.map(value => value.scenarioId)).toEqual([
      'gm-player-multi-client',
      'long-timeskip',
      'restart-recovery',
      'dual-consent-transfer',
      'concurrent-hatch',
    ])
    expect(acceptance.invariants).toHaveLength(7)
    for (const scenario of acceptance.scenarios) {
      expect(scenario.expectedOutcome.length).toBeGreaterThan(80)
      for (const evidence of scenario.evidence) {
        expect(readFileSync(resolve(ROOT, evidence.path), 'utf8'))
          .toContain(evidence.requiredNeedle)
      }
    }
    expect(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
      .toContain('"test:breeding-production-acceptance"')
  })

  it('keeps simultaneous GM and selected-Profile clients private across restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'breeding-production-clients-'))
    tempRoots.push(directory)
    const path = join(directory, 'campaign.sqlite')
    const setup = open(path)
    saveTrainer(setup, 'trainer-mira', 'Mira')
    saveTrainer(setup, 'trainer-secret', 'Secret Trainer')
    close(setup)

    const gmDatabase = open(path)
    const playerDatabase = open(path)
    expect(gmDatabase.connection.prepare('PRAGMA journal_mode').get())
      .toEqual({ journal_mode: 'wal' })
    const gm = loadGm(gmDatabase)
    const player = loadPlayer(playerDatabase)

    expect(gm.ownershipContexts.map(value => value.trainerSheetSlug))
      .toEqual(['trainer-mira', 'trainer-secret'])
    expect(player.ownershipContexts.map(value => value.trainerSheetSlug))
      .toEqual(['trainer-mira'])
    expect(gm.generatedAtCampaignMinute).toBe(player.generatedAtCampaignMinute)
    expect(JSON.stringify(player)).not.toMatch(/trainer-secret|Secret Trainer/u)
    expect(JSON.stringify(gm)).not.toMatch(/profile_production01|linkedCharacters/u)

    close(gmDatabase)
    close(playerDatabase)
    const restartedGmDatabase = open(path)
    const restartedPlayerDatabase = open(path)
    const restartedGm = loadGm(restartedGmDatabase)
    const restartedPlayer = loadPlayer(restartedPlayerDatabase)

    expect(restartedGm).toEqual(gm)
    expect(restartedPlayer).toEqual(player)
    expect(JSON.stringify(restartedPlayer)).not.toMatch(/trainer-secret|Secret Trainer/u)
  })
})
