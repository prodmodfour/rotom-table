import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readRepoText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('group inventory workflow docs', () => {
  it('documents authority, transfers, realtime, export, and move live-play boundaries', () => {
    const workflow = readRepoText('docs/group-inventory.md')
    const docsIndex = readRepoText('docs/README.md')
    const dataModel = readRepoText('docs/data-model.md')
    const livePlayAuthority = readRepoText('docs/live-play-authority.md')

    expect(docsIndex).toContain('[Group inventory workflow](group-inventory.md)')
    expect(dataModel).toContain('[Group inventory workflow](group-inventory.md)')
    expect(livePlayAuthority).toContain('[Group inventory workflow](group-inventory.md)')

    expect(workflow).toContain('Runtime group inventory state lives in SQLite in the `group_inventories` table')
    expect(workflow).toContain('Do not treat exported JSON as runtime fallback state')
    expect(workflow).toContain('do not store group inventory in map metadata or in a fake trainer sheet')
    expect(workflow).toContain('POST /api/group-inventory/save')
    expect(workflow).toContain('expectedRevision')
    expect(workflow).toContain('Players cannot perform direct full-document group inventory saves')
    expect(workflow).toContain('selected player profile ID')
    expect(workflow).toContain('group-inventory:<slug>')
    expect(workflow).toContain('data/group-inventories/')
    expect(workflow).toContain('`resolveMove` may now carry an explicit')
    expect(workflow).toContain('{ kind: "groupInventory", slug, field: "inventory" }')
    expect(workflow).toContain('map, damage or other sheet effects, group inventory item changes')
    expect(workflow).toContain('An exact duplicate move `opId` returns the stored result')
  })
})
