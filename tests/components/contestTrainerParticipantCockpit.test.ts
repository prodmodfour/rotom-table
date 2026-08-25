import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/pages/contests/[contestId].vue', 'utf8')

describe('Trainer Participant liveplay Contest cockpit', () => {
  it('makes exact performer choice, shared dice, partner effects, and paired Voltage visible', () => {
    for (const copy of ['Choose who appeals first', 'Choose this appeal’s performer', 'Shared Contest dice', 'Submit appeal', 'Center of attention']) expect(source).toContain(copy)
    expect(source).toContain('participantLegalPerformers')
    expect(source).toContain(':aria-pressed="appeal.performerId === performer.performerId"')
    expect(source).toContain('performerVoltage(performer)')
    expect(source).toContain('partnerEffectTargetPerformerId: appeal.partnerEffectTargetPerformerId || null')
    expect(source).toContain("['get-ready','attention-grabber']")
  })

  it('submits interventions against the exact selected or accepted performer', () => {
    expect(source).toContain("targetPerformerId: projection.value?.participantVariantId === 'trainer-participant' ? activePerformer.value?.performerId ?? null : null")
    expect(source).toContain('pendingAppeal.value')
    expect(source).toContain('activeProviderIds')
    expect(source).toContain("id.startsWith('feature:')")
  })

  it('uses the versioned Live Encounter design contract with non-colour states and narrow reflow', () => {
    expect(source).toContain('data-rt-design-system="1" data-rt-context="live-encounter"')
    expect(source).toContain('<PhCheckCircle :size="18" aria-hidden="true" /> Selected')
    expect(source).toContain('<PhLockKey :size="14" />{{ moveDecisionReason(move) }}')
    expect(source).toContain('outline:3px solid var(--rt-focus')
    expect(source).toMatch(/\.participant-performer-choice\{[^}]*grid-template-columns:repeat\(2/u)
    expect(source).toMatch(/@media\(max-width:760px\)[\s\S]*?\.participant-performer-choice\{grid-template-columns:1fr\}/u)
    expect(source).toContain('min-height:44px')
    expect(source).toContain('@media(prefers-reduced-motion:reduce)')
  })

  it('keeps public stage and settlement labels free of raw sheet/provider authority', () => {
    const template = source.slice(source.indexOf('<template>'), source.indexOf('<style scoped>'))
    expect(template).not.toContain('providerIds')
    expect(template).not.toContain('trainerSheetSlug')
    expect(template).not.toContain('pokemonSheetSlug')
    expect(template).not.toContain('operationId')
    expect(template).toContain('settlementPokemonLabel')
  })
})
