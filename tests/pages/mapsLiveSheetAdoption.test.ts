import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('map page live-play sheet updates', () => {
  it('uses central revision-aware sheet adoption instead of shallow merging command sheet documents', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/maps/[slug].vue'), 'utf8')

    expect(source).toContain('adoptSheetUpdate({')
    expect(source).toContain('reportLiveSheetReconciliationRequired')
    expect(source).not.toContain('...(previous ?? {})')
    expect(source).not.toContain('...update.sheet } as CharacterSheet')
    expect(source).not.toContain('...update.sheet } as TrainerSheet')
  })
})
