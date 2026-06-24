import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('map page initiative control semantics', () => {
  it('keeps live initiative controls to one authoritative command and preserves setup local side effects', () => {
    const source = readSource('src/pages/maps/[slug].vue')

    expect(source).toContain(`const previousInitiativeFromControls = async () => {\n  if (!isSetupEditMode()) {\n    await Promise.resolve(previousInitiative())\n    return\n  }`)
    expect(source).toContain(`const nextInitiativeFromControls = async () => {\n  if (!isSetupEditMode()) {\n    await Promise.resolve(nextInitiative())\n    return\n  }`)
    expect(source).toContain('attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()')
    expect(source).toContain('expireActiveOrdersLocallyAfterInitiativeAdvance({ before, after: orderTimelinePoint() })')
    expect(source).not.toContain('nextInitiativeAndExpireAoo')
    expect(source).not.toContain('previousInitiativeAndExpireAoo')
    expect(source).not.toContain('expireActiveOrdersAfterInitiativeAdvance')
  })
})
