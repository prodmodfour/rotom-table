import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detail = readFileSync('src/pages/contests/[contestId].vue', 'utf8')
const index = readFileSync('src/pages/contests/index.vue', 'utf8')

describe('Battle Contest Workshop setup', () => {
  it('offers the native Battle variant with a fixed-type, two-team setup explanation', () => {
    expect(index).toContain('CONTEST_RUNTIME_VARIANT_IDS')
    expect(index).toContain("row.completionState === 'native'")
    expect(index).not.toContain("row.id === 'battle'")
    expect(index).toContain('Two-team Battle Contest')
    expect(index).toContain('equal teams of 3–6 Pokémon')
    expect(index).toContain('round budget is derived as twice the first accepted team size')
    expect(index).toContain('data-rt-design-system="1" data-rt-context="workshop"')
  })

  it('makes equal roster size, canonical round budget, and readiness visible without editable budget authority', () => {
    for (const copy of ['Battle Contest setup', 'of 2 teams ready', '3–6 each', 'Rounds', 'Enroll the opposing team', 'Both teams are ready', 'Lock 2 teams and begin introductions']) expect(detail).toContain(copy)
    expect(detail).toContain('battleRosterSize')
    expect(detail).toContain('battleRoundBudget')
    expect(detail).toContain('battleSelectionValid')
    expect(detail).toContain("battleRoundBudget.value === battleRosterSize.value * 2")
    expect(detail).not.toMatch(/v-model="[^"]*roundBudget/u)
  })

  it('uses ordinary controller authority, exact multi-roster selection, and no Battle Contest turn order claim', () => {
    expect(detail).toContain('A selected profile must control this Trainer and every roster Pokémon.')
    expect(detail).toContain(':multiple="projection.variantId === \'rotation\' || isBattleSetup"')
    expect(detail).toContain("battleRosterSize.value === null ? 'choose 3–6'")
    expect(detail).toContain("projection.value?.variantId === 'rotation' && projection.value.rotationOrderPolicy === 'predeclared'")
    expect(detail).toContain('const rotationOrder =')
    expect(detail).toContain(':disabled="!enrollmentReady || runtime.submitting.value"')
  })

  it('renders accepted teams with non-colour evidence, keyboard focus, 44px targets, and narrow reflow', () => {
    expect(detail).toContain('class="battle-team-grid"')
    expect(detail).toContain('Team {{ index + 1 }} · accepted')
    expect(detail).toContain('<PhCheckCircle :size="18" aria-label="Accepted" />')
    expect(detail).toContain('outline:3px solid var(--rt-focus')
    expect(detail).toContain('min-height:44px')
    expect(detail).toMatch(/@media\(max-width:760px\)[\s\S]*?\.battle-team-grid,\.battle-intro-team-grid\{grid-template-columns:1fr\}/u)
    expect(detail).toContain('@media(prefers-reduced-motion:reduce)')
  })

  it('keeps the setup template free of raw sheet/provider/operation authority', () => {
    const template = detail.slice(detail.indexOf('<template>'), detail.indexOf('<style scoped>'))
    for (const forbidden of ['trainerSheetSlug', 'pokemonSheetSlug', 'operationId', 'roundBudget =']) expect(template).not.toContain(forbidden)
  })
})
