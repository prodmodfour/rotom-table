/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BreedingConsentCenter from '../../src/components/breeding/BreedingConsentCenter.vue'
import { createBreedingConsentWorkflowProjectionV1 } from '../../server/domain/breeding/consentWorkflow'

const PROJECT_ID = 'breeding-project:v1:77777777777777777777777777777777'
const SOURCE_ID = 'egg-transfer-consent:v1:77777777777777777777777777777777'
const EGG_ID = 'pokemon-egg:v1:77777777777777777777777777777777'
const project = (gm = false) => ({
  projectId: PROJECT_ID as never,
  projectRevision: 1,
  coarseStatus: 'awaiting-consent' as const,
  ownParent: { pokemonSheetSlug: 'pokemon-parent', expectedSheetRevision: 3, displayName: 'Leaf', current: true },
  breederDisplayName: 'Campaign Breeder',
  consent: { consentId: null, status: 'waiting' as const, scopes: ['own-parent-contribution-attribution', 'own-parent-safe-summary', 'project-participation'] as const, expiresAtCampaignMinute: null },
  canGrant: !gm,
  canRevoke: false,
  ownerTrainerSlug: gm ? 'trainer-owner' : null,
  participantTrainerSlug: gm ? 'trainer-participant' : null,
  recovery: { state: 'none' as const, pendingSinceCampaignMinute: null },
  gmReview: gm ? { setupOverrideKind: 'cross-owner-consent' as const, setupOverrideOnly: true as const, consentSubstitutionAllowed: false as const, canCancelProject: true } : null,
})
const playerProjection = () => createBreedingConsentWorkflowProjectionV1({
  audience: 'player',
  context: { trainerSheetSlug: 'trainer-participant', trainerRevision: 4, displayName: 'Participant' },
  generatedAtCampaignMinute: 800,
  notifications: { projectRequests: 1, transferInvitations: 0, readyTransfers: 0, total: 1 },
  projectRequestsTruncated: false,
  eggTransfersTruncated: false,
  projectRequests: [project(false)],
  eggTransfers: [],
  gmPolicy: null,
  transition: 'none',
})
const mountCenter = (projection: ReturnType<typeof playerProjection>, extra: Record<string, unknown> = {}) => mount(
  BreedingConsentCenter,
  { attachTo: document.body, props: { projection, loading: false, submitting: false, error: null, transferSetup: null, ...extra } },
)
afterEach(() => document.body.replaceChildren())

describe('Breeding consent center', () => {
  it('shows only the participant parent and emits explicit scoped Project consent', async () => {
    const wrapper = mountCenter(playerProjection())
    const text = document.body.textContent ?? ''
    expect(text).toContain('Private authority')
    expect(text).toContain('Leaf')
    expect(text).toContain('Attribute this parent’s contribution')
    expect(text).not.toContain(PROJECT_ID)
    expect(text).not.toContain('trainer-owner')
    expect(text).not.toMatch(/egg group|gender|nature|ability|command hash/i)
    const button = [...document.body.querySelectorAll('button')].find(value => value.textContent?.includes('Give scoped consent'))!
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('grantProjectConsent')).toEqual([[playerProjection().projectRequests[0]]])
  })

  it('explains the setup-only GM boundary and never renders a positive-consent action', async () => {
    const gm = createBreedingConsentWorkflowProjectionV1({
      audience: 'gm',
      context: { trainerSheetSlug: 'trainer-owner', trainerRevision: 2, displayName: 'Owner' },
      generatedAtCampaignMinute: 800,
      notifications: { projectRequests: 0, transferInvitations: 0, readyTransfers: 0, total: 0 },
      projectRequestsTruncated: false,
      eggTransfersTruncated: false,
      projectRequests: [project(true)],
      eggTransfers: [],
      gmPolicy: { setupOverrideOnly: true, positiveConsentSubstitutionAllowed: false, transferRequiresTwoPositiveConsents: true },
      transition: 'none',
    })
    const wrapper = mountCenter(gm as never)
    const text = document.body.textContent ?? ''
    expect(document.body.querySelector('[data-testid="breeding-consent-gm-policy"]')).not.toBeNull()
    expect(text).toContain('Neither action creates participant consent')
    expect(text).toContain('separate positive source and recipient approvals')
    expect(text).not.toContain('Give scoped consent')
    const cancel = [...document.body.querySelectorAll('button')].find(value => value.textContent?.includes('Cancel Project'))!
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancelProjectAsGm')).toEqual([[gm.projectRequests[0]]])
  })

  it('contains transfer-dialog focus and restores the non-mutating opening control', async () => {
    const origin = document.createElement('button')
    origin.textContent = 'Set up Egg gift'
    document.body.append(origin)
    origin.focus()
    const wrapper = mountCenter(playerProjection())
    await wrapper.setProps({ transferSetup: { eggId: EGG_ID, eggRevision: 2 } })
    await wrapper.vm.$nextTick()
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(document.activeElement).toBe(dialog.querySelector('input'))
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
    focusable.at(-1)!.focus()
    focusable.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(focusable[0])
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(wrapper.emitted('closeTransferSetup')).toEqual([[]])
    await wrapper.setProps({ transferSetup: null })
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(origin)
  })

  it('uses a labelled modal for non-mutating transfer setup and validates a different Trainer slug', async () => {
    const wrapper = mountCenter(playerProjection(), { transferSetup: { eggId: EGG_ID, eggRevision: 2 } })
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('breeding-transfer-setup-title')
    expect(dialog.textContent).toContain('ownership remains unchanged')
    const input = dialog.querySelector('input[name="destinationTrainerSlug"]') as HTMLInputElement
    const submit = [...dialog.querySelectorAll('button')].find(value => value.textContent?.includes('Give source consent')) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await wrapper.find('input[name="destinationTrainerSlug"]').setValue('trainer-recipient')
    expect(submit.disabled).toBe(false)
    submit.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('offerEggTransfer')).toEqual([['trainer-recipient']])
    expect(input.pattern).toBe('[a-z0-9-]+')
  })

  it('renders pending operations as recovery-only state with every ordinary consent action absent', () => {
    const projection = createBreedingConsentWorkflowProjectionV1({
      audience: 'player',
      context: { trainerSheetSlug: 'trainer-participant', trainerRevision: 4, displayName: 'Participant' },
      generatedAtCampaignMinute: 810,
      notifications: { projectRequests: 0, transferInvitations: 0, readyTransfers: 0, total: 0 },
      projectRequestsTruncated: false,
      eggTransfersTruncated: false,
      projectRequests: [{
        ...project(false),
        canGrant: false,
        recovery: { state: 'pending', pendingSinceCampaignMinute: 809 },
      }],
      eggTransfers: [{
        offerConsentId: SOURCE_ID as never,
        ownConsentId: SOURCE_ID as never,
        eggId: EGG_ID as never,
        eggRevision: 2,
        audience: 'recipient',
        state: 'offered',
        expiresAtCampaignMinute: 44_000,
        canAccept: false,
        canTransfer: false,
        canRevoke: false,
        ownConsentActive: false,
        recovery: { state: 'pending', pendingSinceCampaignMinute: 809 },
      }],
      gmPolicy: null,
      transition: 'none',
    })
    mountCenter(projection as never)
    const text = document.body.textContent ?? ''
    expect(document.body.querySelectorAll('[role="status"]')).toHaveLength(2)
    expect(text.match(/System recovery required/g)).toHaveLength(2)
    expect(text).not.toMatch(/Give scoped consent|Accept this Egg gift|Transfer Egg|Revoke my transfer consent/)
  })

  it('presents a recipient invitation without counterpart identity or aggregate IDs', async () => {
    const recipient = createBreedingConsentWorkflowProjectionV1({
      audience: 'player',
      context: { trainerSheetSlug: 'trainer-recipient', trainerRevision: 2, displayName: 'Recipient' },
      generatedAtCampaignMinute: 800,
      notifications: { projectRequests: 0, transferInvitations: 1, readyTransfers: 0, total: 1 },
      projectRequestsTruncated: false,
      eggTransfersTruncated: false,
      projectRequests: [],
      eggTransfers: [{
        offerConsentId: SOURCE_ID as never,
        ownConsentId: SOURCE_ID as never,
        eggId: EGG_ID as never,
        eggRevision: 2,
        audience: 'recipient',
        state: 'offered',
        expiresAtCampaignMinute: 44_000,
        canAccept: true,
        canTransfer: false,
        canRevoke: false,
        ownConsentActive: false,
        recovery: { state: 'none', pendingSinceCampaignMinute: null },
      }],
      gmPolicy: null,
      transition: 'none',
    })
    const wrapper = mountCenter(recipient as never)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Private invitation')
    expect(text).not.toContain(SOURCE_ID)
    expect(text).not.toContain(EGG_ID)
    expect(text).not.toContain('trainer-owner')
    const accept = [...document.body.querySelectorAll('button')].find(value => value.textContent?.includes('Accept this Egg gift'))!
    accept.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('acceptEggTransfer')).toEqual([[recipient.eggTransfers[0]]])
  })
})
