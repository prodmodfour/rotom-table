/**
 * @vitest-environment happy-dom
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PokedexEntryDetail from '~/components/pokedex/PokedexEntryDetail.vue'
import PokedexProfileColumn from '~/components/pokedex/PokedexProfileColumn.vue'
import PokedexProfileSpriteFrame from '~/components/pokedex/PokedexProfileSpriteFrame.vue'
import type { SpriteVisualBounds } from '~/types/pokemon'
import type { PokedexEntryDetail as PokedexEntryDetailRecord } from '~/utils/pokedex/entryIndex'

const hoverBounds: SpriteVisualBounds = {
  canvasWidth: 96,
  canvasHeight: 96,
  left: 24,
  top: 8,
  width: 48,
  height: 48,
  floating: true,
}

const groundedBounds: SpriteVisualBounds = {
  ...hoverBounds,
  top: 36,
  height: 60,
  floating: false,
}

const makeEntry = (overrides: Partial<PokedexEntryDetailRecord> = {}): PokedexEntryDetailRecord => ({
  id: '93-haunter',
  slug: 'haunter',
  species: 'Haunter',
  nationalDexNumber: 93,
  spriteUrl: '/sprites/haunter.png',
  profileSpriteUrl: null,
  base_stats: {},
  hatch_rate: null,
  ...overrides,
}) as unknown as PokedexEntryDetailRecord

const readCssPercent = (wrapper: VueWrapper, variableName: string): number => {
  const rawValue = wrapper.element.style.getPropertyValue(variableName)
  return Number.parseFloat(rawValue)
}

describe('PokedexProfileSpriteFrame', () => {
  it('exposes CSS translation variables for floating visual bounds', () => {
    const wrapper = mount(PokedexProfileSpriteFrame, {
      props: {
        species: 'Haunter',
        spriteUrl: '/sprites/haunter.png',
        visualBounds: hoverBounds,
      },
    })

    expect(wrapper.get('img').attributes('alt')).toBe('Haunter')
    expect(readCssPercent(wrapper, '--sprite-visual-translate-x')).toBe(0)
    expect(readCssPercent(wrapper, '--sprite-visual-translate-y')).toBeCloseTo(100 / 6)
  })

  it('keeps grounded or missing visual bounds neutral', async () => {
    const wrapper = mount(PokedexProfileSpriteFrame, {
      props: {
        species: 'Bulbasaur',
        spriteUrl: '/sprites/bulbasaur.png',
        visualBounds: groundedBounds,
      },
    })

    expect(readCssPercent(wrapper, '--sprite-visual-translate-x')).toBe(0)
    expect(readCssPercent(wrapper, '--sprite-visual-translate-y')).toBe(0)

    await wrapper.setProps({ visualBounds: undefined })

    expect(readCssPercent(wrapper, '--sprite-visual-translate-x')).toBe(0)
    expect(readCssPercent(wrapper, '--sprite-visual-translate-y')).toBe(0)
  })

  it('keeps the missing-sprite fallback in place', () => {
    const wrapper = mount(PokedexProfileSpriteFrame, {
      props: {
        species: 'Missingno',
        spriteUrl: null,
        visualBounds: hoverBounds,
      },
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('no sprite')
  })
})

describe('Pokédex visual-bounds plumbing', () => {
  it('passes detail visual bounds through to the profile column', () => {
    const wrapper = mount(PokedexEntryDetail, {
      props: {
        capabilityTokens: [],
        dietSummary: null,
        displayedEvolutions: [],
        eggGroupSummary: null,
        eggMoveTokens: [],
        entry: makeEntry(),
        genderSummary: null,
        habitatSummary: null,
        heightLabel: null,
        isPlacementOnly: false,
        pageNumber: null,
        requestedPokemonName: null,
        skillPhrase: '',
        spriteUrl: '/sprites/haunter.png',
        spriteVisualBounds: hoverBounds,
        tmHmTokens: [],
        tutorMoveTokens: [],
        typeMatchupGroups: [],
        weightLabel: null,
      },
      global: {
        stubs: {
          PokedexEntryHeader: true,
          PokedexProfileColumn: {
            props: ['spriteVisualBounds'],
            template: `<div class="profile-column-stub" :data-floating="spriteVisualBounds && spriteVisualBounds.floating ? 'true' : 'false'" />`,
          },
          PokedexCapabilitiesSkillsPanel: true,
          PokedexTypeMatchupsPanel: true,
          PokedexMoveListPanel: true,
          PokedexEntryEmptyState: true,
        },
      },
    })

    expect(wrapper.get('.profile-column-stub').attributes('data-floating')).toBe('true')
  })

  it('passes profile-column visual bounds through to the sprite frame', () => {
    const wrapper = mount(PokedexProfileColumn, {
      props: {
        dietSummary: null,
        displayedEvolutions: [],
        eggGroupSummary: null,
        entry: makeEntry(),
        genderSummary: null,
        habitatSummary: null,
        heightLabel: null,
        spriteUrl: '/sprites/haunter.png',
        spriteVisualBounds: hoverBounds,
        weightLabel: null,
      },
      global: {
        stubs: {
          PokedexProfileSpriteFrame: {
            props: ['species', 'spriteUrl', 'visualBounds'],
            template: `<div class="sprite-frame-stub" :data-species="species" :data-sprite-url="spriteUrl" :data-floating="visualBounds && visualBounds.floating ? 'true' : 'false'" />`,
          },
          PokedexBaseStatsPanel: true,
          PokedexBasicInfoPanel: true,
          PokedexEvolutionPanel: true,
          PokedexBiologyPanel: true,
        },
      },
    })

    const frame = wrapper.get('.sprite-frame-stub')
    expect(frame.attributes('data-species')).toBe('Haunter')
    expect(frame.attributes('data-sprite-url')).toBe('/sprites/haunter.png')
    expect(frame.attributes('data-floating')).toBe('true')
  })
})
