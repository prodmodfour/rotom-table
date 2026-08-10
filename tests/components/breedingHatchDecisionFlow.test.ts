/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BreedingHatchDecisionFlow from '../../src/components/breeding/BreedingHatchDecisionFlow.vue'
import { createBreedingHatchWorkflowProjectionV1 } from '../../server/domain/breeding/hatchWorkflow'
import type { BreedingHatchWorkflowProjectionV1 } from '../../shared/breeding/hatchWorkflow'

const EGG_ID = 'pokemon-egg:v1:75757575757575757575757575757575'
const BOX_OPTION_ID = 'option:v1:75757575757575757575757575757570'
const TEAM_OPTION_ID = 'option:v1:75757575757575757575757575757571'
const ready = () => createBreedingHatchWorkflowProjectionV1({
  audience: 'owner', trainerSheetSlug: 'trainer-owner', stage: 'ready',
  egg: { eggId: EGG_ID as never, revision: 1, status: 'ready', speciesName: 'Bulbasaur', updatedAtCampaignMinute: 700 },
  decision: { kind: 'begin-hatch', canSubmit: true, requiresConfirmation: true, reasonId: null },
  special: { state: 'not-rolled', outcomeId: null, gmReview: null },
  destination: { teamCapacity: 6, acceptedKind: null, options: [
    { optionId: BOX_OPTION_ID as never, kind: 'box', availability: 'available', reasonId: null, remainingTeamSlots: null },
    { optionId: TEAM_OPTION_ID as never, kind: 'team', availability: 'available', reasonId: null, remainingTeamSlots: 2 },
  ] }, childReveal: null,
  recovery: { state: 'none', pendingSinceCampaignMinute: null }, transition: 'none', generatedAtCampaignMinute: 700,
})
const mountFlow = (projection: BreedingHatchWorkflowProjectionV1 | null = ready(), extra: Record<string, unknown> = {}) => mount(
  BreedingHatchDecisionFlow,
  {
    attachTo: document.body,
    props: { open: true, projection, loading: false, submitting: false, error: null, ...extra },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  },
)
afterEach(() => document.body.replaceChildren())

describe('Breeding hatch decision flow', () => {
  it('renders a labelled modal and requires an explicit begin confirmation', async () => {
    const wrapper = mountFlow()
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('hatch-flow-title')
    expect(dialog.textContent).toContain('Choose where the child will join')
    expect(dialog.textContent).toContain('persist exactly one special-result roll')
    const button = [...dialog.querySelectorAll('button')].find(candidate => candidate.textContent?.includes('Confirm destination and begin hatch')) as HTMLButtonElement
    expect(button.classList.contains('hatch-flow__button')).toBe(true)
    expect(button.disabled).toBe(true)
    ;(dialog.querySelector('input[name="hatch-destination-option"]') as HTMLInputElement).click()
    await wrapper.vm.$nextTick()
    expect(button.disabled).toBe(false)
    button.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('begin')).toEqual([[BOX_OPTION_ID]])
  })

  it('disables a full team with a closed explanation while keeping Box selectable', async () => {
    const full = createBreedingHatchWorkflowProjectionV1({
      audience: 'owner', trainerSheetSlug: 'trainer-owner', stage: 'ready',
      egg: { eggId: EGG_ID as never, revision: 1, status: 'ready', speciesName: 'Bulbasaur', updatedAtCampaignMinute: 700 },
      decision: { kind: 'begin-hatch', canSubmit: true, requiresConfirmation: true, reasonId: null },
      special: { state: 'not-rolled', outcomeId: null, gmReview: null },
      destination: { teamCapacity: 6, acceptedKind: null, options: [
        { optionId: BOX_OPTION_ID as never, kind: 'box', availability: 'available', reasonId: null, remainingTeamSlots: null },
        { optionId: TEAM_OPTION_ID as never, kind: 'team', availability: 'unavailable', reasonId: 'breeding.hatch-offer.team-full', remainingTeamSlots: 0 },
      ] }, childReveal: null,
      recovery: { state: 'none', pendingSinceCampaignMinute: null }, transition: 'none', generatedAtCampaignMinute: 700,
    })
    const wrapper = mountFlow(full)
    const radios = document.body.querySelectorAll<HTMLInputElement>('input[name="hatch-destination-option"]')
    expect(radios).toHaveLength(2)
    expect(radios[0]!.disabled).toBe(false)
    expect(radios[1]!.disabled).toBe(true)
    expect(document.body.textContent).toContain('0 of 6 team slots available')
    expect(document.body.textContent).toContain('The active team is full. Choose the Pokémon Box')
    radios[0]!.click()
    await wrapper.vm.$nextTick()
    const confirm = [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes('Confirm destination')) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    confirm.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('begin')).toEqual([[BOX_OPTION_ID]])
  })

  it('redacts private special mechanics for owners while presenting a waiting state', () => {
    const owner = createBreedingHatchWorkflowProjectionV1({
      audience: 'owner', trainerSheetSlug: 'trainer-owner', stage: 'awaiting-gm',
      egg: { eggId: EGG_ID as never, revision: 2, status: 'awaiting-special-adjudication', speciesName: 'Bulbasaur', updatedAtCampaignMinute: 700 },
      decision: { kind: 'none', canSubmit: false, requiresConfirmation: false, reasonId: 'breeding.hatch.awaiting-gm' },
      special: { state: 'pending-adjudication', outcomeId: null, gmReview: null },
      destination: { teamCapacity: 6, acceptedKind: 'box', options: [] }, childReveal: null,
      recovery: { state: 'none', pendingSinceCampaignMinute: null }, transition: 'special-review-required', generatedAtCampaignMinute: 700,
    })
    mountFlow(owner)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Waiting for the GM')
    expect(text).not.toContain('Persisted d100')
    expect(text).not.toContain('Special hatch outcome')
    expect(text).not.toContain('option:v1:')
  })

  it('gives the GM a native radio group and separate confirmation control', async () => {
    const first = 'option:v1:75757575757575757575757575757575'
    const gm = createBreedingHatchWorkflowProjectionV1({
      audience: 'gm', trainerSheetSlug: 'trainer-owner', stage: 'awaiting-gm',
      egg: { eggId: EGG_ID as never, revision: 2, status: 'awaiting-special-adjudication', speciesName: 'Bulbasaur', updatedAtCampaignMinute: 700 },
      decision: { kind: 'resolve-special', canSubmit: true, requiresConfirmation: true, reasonId: null },
      special: { state: 'pending-adjudication', outcomeId: null, gmReview: { rollTotal: 1, triggerIds: ['roll-1'], options: [
        { optionId: first as never, outcomeId: 'breeding.hatch-special.outcome.campaign-significance', label: 'Campaign significance', description: 'Story consequence.' },
        { optionId: 'option:v1:75757575757575757575757575757576' as never, outcomeId: 'breeding.hatch-special.outcome.distinctive-appearance', label: 'Distinctive appearance', description: 'Memorable appearance.' },
        { optionId: 'option:v1:75757575757575757575757575757577' as never, outcomeId: 'breeding.hatch-special.outcome.distinctive-temperament', label: 'Distinctive temperament', description: 'Memorable temperament.' },
      ] } }, destination: { teamCapacity: 6, acceptedKind: 'box', options: [] }, childReveal: null,
      recovery: { state: 'none', pendingSinceCampaignMinute: null }, transition: 'none', generatedAtCampaignMinute: 700,
    })
    const wrapper = mountFlow(gm)
    expect(document.body.textContent).toContain('Persisted d100: 1')
    const radios = document.body.querySelectorAll('input[type="radio"]')
    expect(radios).toHaveLength(3)
    const confirmation = [...document.body.querySelectorAll('button')].find(candidate => candidate.textContent?.includes('Confirm special outcome')) as HTMLButtonElement
    expect(confirmation.disabled).toBe(true)
    ;(radios[0] as HTMLInputElement).click()
    await wrapper.vm.$nextTick()
    expect(confirmation.disabled).toBe(false)
    confirmation.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('resolveSpecial')).toEqual([[first]])
  })

  it('announces the accepted reveal with bounded child facts and no command evidence', () => {
    const reveal = createBreedingHatchWorkflowProjectionV1({
      audience: 'owner', trainerSheetSlug: 'trainer-owner', stage: 'hatched',
      egg: { eggId: EGG_ID as never, revision: 3, status: 'hatched', speciesName: 'Bulbasaur', updatedAtCampaignMinute: 700 },
      decision: { kind: 'none', canSubmit: false, requiresConfirmation: false, reasonId: 'breeding.hatch.current-authority-unavailable' },
      special: { state: 'normal', outcomeId: null, gmReview: null },
      destination: { teamCapacity: 6, acceptedKind: 'box', options: [] },
      childReveal: { childSheetSlug: 'bulbasaur', speciesName: 'Bulbasaur', natureName: 'Cuddly', abilityName: 'Overgrow', genderId: 'female', startingLevel: 1, destinationKind: 'box', hatchedAtCampaignMinute: 700 },
      recovery: { state: 'none', pendingSinceCampaignMinute: null }, transition: 'child-revealed', generatedAtCampaignMinute: 700,
    })
    mountFlow(reveal)
    const text = document.body.textContent ?? ''
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain('Bulbasaur hatched and joined')
    expect(text).toContain('Bulbasaur hatched!')
    expect(text).toContain('Cuddly')
    expect(text).toContain('Overgrow')
    expect(text).not.toContain(EGG_ID)
    expect(text).not.toMatch(/authorization|operation id|read set|definition hash/i)
    const links = [...document.body.querySelectorAll('a')].map(link => ({ text: link.textContent?.trim(), href: link.getAttribute('href') }))
    expect(links).toContainEqual({ text: 'Open child sheet', href: '/sheets/bulbasaur' })
    expect(links).toContainEqual({ text: 'Open Trainer sheet', href: '/sheets/trainers/trainer-owner' })
  })

  it('renders pending operations as recovery rather than a hatch choice', async () => {
    const recovery = createBreedingHatchWorkflowProjectionV1({
      audience: 'owner', trainerSheetSlug: 'trainer-owner', stage: 'recovery',
      egg: { eggId: EGG_ID as never, revision: 1, status: 'ready', speciesName: 'Bulbasaur', updatedAtCampaignMinute: 700 },
      decision: { kind: 'none', canSubmit: false, requiresConfirmation: false, reasonId: 'breeding.hatch.recovery-required' },
      special: { state: 'not-rolled', outcomeId: null, gmReview: null },
      destination: { teamCapacity: 6, acceptedKind: null, options: [] }, childReveal: null,
      recovery: { state: 'pending', pendingSinceCampaignMinute: 700 }, transition: 'none', generatedAtCampaignMinute: 700,
    })
    const wrapper = mountFlow(recovery)
    expect(document.body.textContent).toContain('System recovery required')
    expect(document.body.textContent).not.toContain('Confirm and begin hatch')
    const button = [...document.body.querySelectorAll('button')].find(candidate => candidate.textContent?.includes('Refresh recovery state'))!
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('retry')).toEqual([[]])
  })
})
