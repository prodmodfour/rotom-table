// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrainerGuidedItemPanel from '../../src/components/sheets/TrainerGuidedItemPanel.vue'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'trainer-guided-component' }))
vi.mock('~/composables/useRealtime', () => ({ subscribeChannel: () => () => undefined }))

const offer = {
  schemaVersion: 1, offerId: 'guided-re-breather:offer', canonicalItemId: 'Re-Breather', itemLabel: 'Re-Breather',
  ownerKind: 'trainer', ownerSlug: 'mira', ownerLabel: 'Mira', actionKind: 'activate',
  actionLabel: 'Activate Re-Breather', timingLabel: 'Standard Action', statusLabel: 'Ready · 60 minutes',
  enabled: true, unavailableReason: null,
} as const
const request = {
  schemaVersion: 1, requestId: 'item-guided:v1:11111111111111111111111111111111', revision: 0,
  status: 'pending', requestKind: 're-breather-activation', canonicalItemId: 'Re-Breather', itemLabel: 'Re-Breather',
  actorLabel: 'Mira', targetLabel: 'Mira', targetKindLabel: 'Trainer', timingLabel: 'Standard Action',
  prompt: 'Confirm activation.', canonicalFacts: ['Grants Gilled for 60 campaign minutes.'], choices: [],
  settlementFacts: ['Activate Gilled.'], reservationLabel: 'Exact equipped Re-Breather reserved',
  boundaryLabel: 'No Capability or equipment-state change occurs until accepted.', canCancel: true, acceptedSummary: null,
} as const
const sheet: TrainerSheet = { slug: 'mira', name: 'Mira', level: 10, revision: 4 }
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

afterEach(() => { resetApiClientForTests(); window.sessionStorage.clear(); vi.restoreAllMocks() })

describe('TrainerGuidedItemPanel', () => {
  it('shows private pending state and declares the exact current Trainer Re-Breather offer without client mechanics', async () => {
    const postJson = vi.fn(async (_path: string, body: any) => ({
      result: { schemaVersion: 1, operationId: body.command.operationId, request, exactReplay: false },
      sheets: [],
    }))
    configureApiClientForTests({
      getJson: vi.fn(async () => ({ schemaVersion: 1, requests: [request], reBreatherOffers: [offer] })),
      postJson,
    })
    const wrapper = mount(TrainerGuidedItemPanel, { props: { sheet, profileId: 'profile_mira0001' } })
    await flush()
    expect(wrapper.text()).toContain('Waiting for bounded GM adjudication')
    expect(wrapper.text()).toContain('Exact equipped Re-Breather reserved')
    expect(wrapper.text()).toContain('Ready · 60 minutes')
    expect(wrapper.text()).not.toContain(request.requestId)
    const declare = wrapper.findAll('button').find(button => button.text().includes('Request GM confirmation'))!
    await declare.trigger('click')
    await flush()
    expect((postJson.mock.calls[0]![1] as any).command).toMatchObject({
      action: 'declare-re-breather', ownerKind: 'trainer', ownerSlug: 'mira', ownerRevision: 4, offerId: offer.offerId,
    })
  })

  it('declares a controlled Pokémon-held offer through the same owner-bound panel', async () => {
    const pokemon: CharacterSheet = { slug: 'bubbles', nickname: 'Bubbles', species: 'Squirtle', level: 8, revision: 2 }
    const pokemonOffer = { ...offer, ownerKind: 'pokemon' as const, ownerSlug: 'bubbles', ownerLabel: 'Bubbles' }
    const postJson = vi.fn(async (_path: string, body: any) => ({
      result: { schemaVersion: 1, operationId: body.command.operationId, request: { ...request, actorLabel: 'Bubbles', targetLabel: 'Bubbles' }, exactReplay: false },
      sheets: [],
    }))
    configureApiClientForTests({
      getJson: vi.fn(async () => ({ schemaVersion: 1, requests: [], reBreatherOffers: [pokemonOffer] })),
      postJson,
    })
    const wrapper = mount(TrainerGuidedItemPanel, {
      props: { sheet: pokemon, ownerKind: 'pokemon', profileId: 'profile_pokemon01' },
    })
    await flush()
    await wrapper.findAll('button').find(button => button.text().includes('Request GM confirmation'))!.trigger('click')
    await flush()
    expect((postJson.mock.calls[0]![1] as any).command).toMatchObject({
      action: 'declare-re-breather', ownerKind: 'pokemon', ownerSlug: 'bubbles', ownerRevision: 2,
    })
  })
})
