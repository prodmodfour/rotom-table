import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const activationPath = resolve(root, 'data/gm-campaign-toolkit/generation-preparation-footprint.v1.json')
const finalityPath = resolve(root, 'data/gm-campaign-toolkit/footprint-finality.v1.json')
const parse = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
const activation = parse(activationPath)
const finality = parse(finalityPath)
const activationRows = activation.rows as Array<{ path?: string, surface?: string }>
const finalityRows = finality.rows as Array<{
  rowKey: string
  targetState: string
  implementationState: string
  ownerTicket: string
  authorityPaths: string[]
  runtimeReachable: boolean
  proof: string
}>

const finalStates = ['Native', 'Migrated', 'Preserved', 'Retired', 'Documentary'] as const
const keyFor = (row: { path?: string, surface?: string }): string => row.path ?? `absent:${row.surface}`

describe('GM Campaign Toolkit footprint finality', () => {
  it('keeps the exact 40-row activation snapshot immutable', () => {
    const digest = createHash('sha256').update(readFileSync(activationPath)).digest('hex')
    expect(digest).toBe('161be4cb987549b3947ba65262d325fcfd28dd5538286d633528e4ef2a2f9862')
    expect(activationRows).toHaveLength(40)
    expect(new Set(activationRows.map(keyFor)).size).toBe(40)
  })

  it('accepts every row in exactly one concrete state with reachable proof or physical retirement', () => {
    expect(finality).toMatchObject({ status: 'accepted-final', finalityTicket: 'P12-093' })
    expect(finalityRows).toHaveLength(40)
    expect(finalityRows.map(row => row.rowKey).sort()).toEqual(activationRows.map(keyFor).sort())

    const counts = Object.fromEntries(finalStates.map(state => [state, 0])) as Record<(typeof finalStates)[number], number>
    for (const row of finalityRows) {
      expect(finalStates).toContain(row.targetState)
      expect(row.implementationState).toBe(row.targetState)
      expect(row.ownerTicket).toMatch(/^P12-\d{3}$/u)
      expect(row.proof.trim().length).toBeGreaterThan(0)
      expect(row.authorityPaths.length).toBeGreaterThan(0)
      row.authorityPaths.forEach(path => expect(existsSync(resolve(root, path)), path).toBe(true))
      const state = row.implementationState as (typeof finalStates)[number]
      counts[state] = (counts[state] ?? 0) + 1

      const activationSource = activationRows.find(candidate => keyFor(candidate) === row.rowKey)?.path
      if (row.implementationState === 'Retired') {
        expect(row.runtimeReachable).toBe(false)
        expect(activationSource && existsSync(resolve(root, activationSource)), activationSource).toBeFalsy()
      } else if (row.implementationState === 'Documentary') {
        expect(row.runtimeReachable).toBe(false)
      } else {
        expect(row.runtimeReachable).toBe(true)
      }
    }

    expect(counts).toEqual({ Native: 20, Migrated: 4, Preserved: 5, Retired: 10, Documentary: 1 })
    expect(finality.summary).toEqual({ rows: 40, final: 40, pending: 0, blocked: 0, byState: counts })
  })

  it('runs the final drift gate and leaves no browser/file generation compatibility cluster', () => {
    expect(execFileSync('python3', [
      'scripts/generate_gm_campaign_toolkit_footprint.py',
      '--check',
      '--check-final',
    ], { cwd: root, encoding: 'utf8' })).toContain('40/40 registered; final=True')

    for (const path of [
      'server/utils/campaignPaths.ts:CAMPAIGN_ENCOUNTER_TABLES_ROOT',
      'src/utils/encounterTables.ts',
      'src/utils/encounterTableEditing.ts',
      'src/utils/encounterTableLibrary.ts',
      'src/composables/encounters/useEncounterTableBrowser.ts',
      'src/composables/encounters/useEncounterTableLibraryPage.ts',
    ]) {
      if (path.includes(':')) {
        const [file, symbol] = path.split(':')
        expect(readFileSync(resolve(root, file!), 'utf8')).not.toContain(symbol)
      } else {
        expect(existsSync(resolve(root, path)), path).toBe(false)
      }
    }
  })
})
