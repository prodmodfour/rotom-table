import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

const toolkitPages = [
  'src/pages/encounter-tables.vue',
  'src/pages/generate.vue',
  'src/pages/npc-trainers.vue',
  'src/pages/session-prep.vue',
] as const

const tablePrimitives = [
  'src/components/encounters/EncounterToolkitNavigation.vue',
  'src/components/encounters/EncounterToolkitTableLibrary.vue',
  'src/components/encounters/EncounterToolkitTableDetail.vue',
  'src/components/encounters/EncounterToolkitTableEditor.vue',
] as const

describe('GM Campaign Toolkit accessibility and responsive acceptance', () => {
  it('uses one semantic Workshop navigation, labelled regions, safe alerts, and polite completion announcements', () => {
    const navigation = source('src/components/encounters/EncounterToolkitNavigation.vue')
    expect(navigation).toContain('aria-label="Campaign Toolkit"')
    expect(navigation).toContain(':aria-current="props.active === item.id ? \'page\' : undefined"')
    for (const label of ['Tables', 'Wild encounter', 'NPC Trainers', 'Session prep']) expect(navigation).toContain(label)

    for (const path of toolkitPages) {
      const page = source(path)
      expect(page, path).toContain('<h1>Campaign Toolkit</h1>')
      expect(page, path).toContain('aria-live="polite"')
      expect(page, path).toContain('role="alert"')
      expect(page, path).toContain('GM preparation workspace')
      expect(page, path).toMatch(/aria-(?:label|labelledby)=/)
    }
    const builder = source('src/pages/encounters/new.vue')
    expect(builder).toContain('data-rt-context="workshop"')
    expect(builder).toContain('aria-live="polite"')
    expect(builder).toContain(':aria-busy="builder.packageLoading.value"')
    expect(builder).toContain('role="alert"')
  })

  it('restores focus after asynchronous context changes and names repeated decisions by their visible object', () => {
    const wild = source('src/pages/generate.vue')
    expect(wild).toContain('reviewHeading.value?.focus()')
    expect(wild).toContain('acceptedHeading.value?.focus()')
    expect(source('src/composables/encounters/useWildGenerationToolkit.ts')).toContain('Preview ready with')

    const npc = source('src/pages/npc-trainers.vue')
    expect(npc).toContain('reviewHeading.value?.focus()')
    expect(npc).toContain('acceptedHeading.value?.focus()')
    expect(npc).toContain('aria-label="Private guided decisions"')
    expect(source('src/composables/encounters/useNpcGenerationToolkit.ts')).toContain('Preview ready for')

    const preparation = source('src/pages/session-prep.vue')
    expect(preparation).toContain('canvasHeading.value?.focus()')
    expect(preparation).toContain('readinessHeading.value?.focus()')
    expect(preparation).toContain(':aria-label="`Decision for ${candidate.label}`"')
    expect(preparation).toContain(':aria-label="`Private note for ${candidate.label}`"')

    const tables = source('src/pages/encounter-tables.vue')
    expect(tables).toContain('detailShell.value?.focus()')
    expect(tables).toContain('tabindex="-1"')

    const builder = source('src/pages/encounters/new.vue')
    expect(builder).toContain('sourceHeading.value?.focus()')
    expect(builder).toContain('Launch unavailable.')
    expect(builder).toContain('h2[tabindex]:focus-visible')
  })

  it('keeps primary interactive targets at least 44 pixels, exposes focus, and disables nonessential motion', () => {
    for (const path of [...toolkitPages, ...tablePrimitives]) {
      const page = source(path)
      expect(page, path).toContain('44px')
      expect(page, path).toContain('focus-visible')
    }
    for (const path of toolkitPages) {
      expect(source(path), path).toContain('@media (prefers-reduced-motion: reduce)')
    }
    const editor = source('src/components/encounters/EncounterToolkitTableEditor.vue')
    for (const rule of [
      'input, select, textarea { width: 100%; min-height: 44px',
      '.check-chip > span { display: inline-flex; min-height: 44px',
      '.row-add-actions button, .secondary-action { min-height: 44px',
      '.row-order button, .remove-row { width: 44px; height: 44px',
      '.row-availability summary { min-height: 44px',
    ]) expect(editor).toContain(rule)
    expect(source('src/pages/generate.vue')).toContain('.candidate-select { width: 44px; min-height: 44px')
    expect(source('src/pages/session-prep.vue')).toContain('.handout-card summary { min-height: 44px')
  })

  it('collapses dense three- and two-region workspaces without hiding essential actions', () => {
    const preparation = source('src/pages/session-prep.vue')
    expect(preparation).toContain('@media (max-width: 820px)')
    expect(preparation).toContain('.prep-grid { grid-template-columns: 1fr; }')
    expect(preparation).toContain('@media (max-width: 480px)')

    const wild = source('src/pages/generate.vue')
    expect(wild).toContain('@media (max-width: 850px)')
    expect(wild).toContain('.wild-grid { grid-template-columns: 1fr; }')
    expect(wild).toContain('@media (max-width: 520px)')

    const npc = source('src/pages/npc-trainers.vue')
    expect(npc).toContain('@media (max-width: 850px)')
    expect(npc).toContain('.npc-grid { grid-template-columns: 1fr; }')
    expect(npc).toContain('@media (max-width: 540px)')

    const tables = source('src/pages/encounter-tables.vue')
    expect(tables).toContain('@media (max-width: 1040px)')
    expect(tables).toContain('.workspace-grid { grid-template-columns: 1fr; }')

    const builder = source('src/pages/encounters/new.vue')
    expect(builder).toContain('@media (max-width: 42rem)')
    expect(builder).toContain('grid-template-columns: minmax(0, 1fr)')
  })
})
