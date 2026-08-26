import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { manageWildGenerationUseCase } from '~~/server/useCases/manageWildGeneration'
import { manageNpcGenerationUseCase } from '~~/server/useCases/manageNpcGeneration'

const databases: RotomDatabase[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })
const counts = (database: RotomDatabase) => Object.fromEntries([
  'sheets', 'realtime_events', 'gm_wild_generation_ops', 'gm_generated_packages', 'gm_npc_generation_ops', 'gm_npc_packages', 'gm_session_preparations', 'gm_session_preparation_ops', 'encounter_documents', 'encounter_launch_ops',
].map(table => [table, Number((database.connection.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count)]))

describe('GM Toolkit preview storage inertness', () => {
  it('leaves no durable row anywhere after maximum wild and 1+6 NPC previews', () => {
    const database = openRotomDatabase({ path: ':memory:' }); databases.push(database)
    const before = counts(database)
    const common = {
      database, now: () => '2026-08-26T12:00:00.000Z', signingKey: 'test-only-gm-toolkit-signing-key-that-is-long-enough',
      publishPersistedRealtimeEvent: () => undefined, publishToolkitInvalidation: () => undefined,
    }
    const wild = manageWildGenerationUseCase({
      schemaVersion: 1, mode: 'preview', operationId: 'preview-inert-wild', tableId: 'encounter-table:v1:thickerby-vale-forest', expectedTableRevision: 0, requestedSlots: 30,
      party: { trainerRefs: [] }, environment: { timeOfDay: null, weather: null }, policy: { shinyChancePercent: 0, heldItemName: null }, exploration: null,
    }, { ...common, seedForCommand: () => createHash('sha256').update('preview-inert-wild').digest('hex') })
    const npc = manageNpcGenerationUseCase({
      schemaVersion: 1, mode: 'preview', operationId: 'preview-inert-npc', archetypeId: 'npc-archetype:v1:field-researcher', expectedArchetypeRevision: 0, rosterCount: 6,
      guided: { name: 'Inert Researcher', identity: '', tactics: '', notes: '' },
    }, { ...common, seedForCommand: () => createHash('sha256').update('preview-inert-npc').digest('hex') })
    expect(wild).toHaveProperty('previewToken'); expect(npc).toHaveProperty('previewToken')
    expect(counts(database)).toEqual(before)
    expect(JSON.stringify(database.connection.prepare("SELECT name FROM sqlite_schema WHERE sql LIKE '%previewToken%'").all())).not.toContain('previewToken')
  }, 15_000)
})
