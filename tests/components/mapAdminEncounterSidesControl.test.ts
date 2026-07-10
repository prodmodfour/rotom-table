/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapAdminEncounterSidesControl from '~/components/map/MapAdminEncounterSidesControl.vue'
import type { EncounterSide } from '#shared/moveAutomation/encounterState'
import type { SheetPlacement } from '~/types/map'

const sides: EncounterSide[] = [
  { id: 'heroes', label: 'Heroes', color: '#3366cc', status: 'active' },
  { id: 'rivals', label: 'Rivals', color: '#cc3344', status: 'active' },
  { id: 'retired', label: 'Retired', status: 'inactive' },
]

const placements: SheetPlacement[] = [
  { id: 'trainer-a', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 }, sideId: 'heroes' },
  { id: 'pokemon-a', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 1 }, sideId: 'heroes' },
  { id: 'pokemon-b', sheetKind: 'pokemon', sheetSlug: 'eevee', position: { x: 5, y: 0, z: 5 }, sideId: 'retired' },
]

const placementCheckbox = (
  wrapper: ReturnType<typeof mount>,
  placementId: string,
) => wrapper.get(`[data-testid="encounter-side-placement"][data-placement-id="${placementId}"]`)

describe('MapAdminEncounterSidesControl', () => {
  it('creates a side from bounded setup fields', async () => {
    const wrapper = mount(MapAdminEncounterSidesControl, {
      props: { sides: [], placements: [] },
    })

    await wrapper.get('[data-testid="encounter-side-create-label"]').setValue('Wild Pokémon')
    await wrapper.get('[data-testid="encounter-side-create-color"]').setValue('#22aa44')
    await wrapper.get('[data-testid="encounter-side-create"]').trigger('submit')

    expect(wrapper.emitted('clear-error')).toHaveLength(1)
    expect(wrapper.emitted('create-side')).toEqual([[
      { label: 'Wild Pokémon', color: '#22aa44' },
    ]])
  })

  it('renames, recolours, archives, and reactivates side records without changing IDs', async () => {
    const wrapper = mount(MapAdminEncounterSidesControl, {
      props: { sides, placements },
    })
    const heroRow = wrapper.get('[data-side-id="heroes"]')
    const retiredRow = wrapper.get('[data-side-id="retired"]')

    await heroRow.get('[data-testid="encounter-side-label"]').setValue('Player Team')
    await heroRow.get('[data-testid="encounter-side-color"]').setValue('#112233')
    await heroRow.get('[data-testid="encounter-side-status"]').trigger('click')
    await retiredRow.get('[data-testid="encounter-side-status"]').trigger('click')

    expect(wrapper.emitted('update-side')).toEqual([
      ['heroes', { label: 'Player Team' }],
      ['heroes', { color: '#112233' }],
    ])
    expect(wrapper.emitted('set-side-status')).toEqual([
      ['heroes', 'inactive'],
      ['retired', 'active'],
    ])
    expect(heroRow.text()).toContain('heroes')
  })

  it('preselects the map-selected placement and bulk assigns additional placements to an active side', async () => {
    const wrapper = mount(MapAdminEncounterSidesControl, {
      props: {
        sides,
        placements,
        selectedPlacementId: 'trainer-a',
      },
    })

    expect((placementCheckbox(wrapper, 'trainer-a').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('Retired (archived)')

    await placementCheckbox(wrapper, 'pokemon-a').setValue(true)
    await wrapper.get('[data-testid="encounter-side-assignment-target"]').setValue('rivals')
    await wrapper.get('[data-testid="encounter-side-assign"]').trigger('click')

    expect(wrapper.emitted('assign-placements')).toEqual([[
      { placementIds: ['trainer-a', 'pokemon-a'], sideId: 'rivals' },
    ]])
    const options = wrapper.findAll('[data-testid="encounter-side-assignment-target"] option')
      .map(option => option.attributes('value'))
    expect(options).toContain('heroes')
    expect(options).toContain('rivals')
    expect(options).not.toContain('retired')
  })

  it('supports explicitly clearing selected placement allegiance', async () => {
    const wrapper = mount(MapAdminEncounterSidesControl, {
      props: { sides, placements },
    })

    await placementCheckbox(wrapper, 'pokemon-b').setValue(true)
    await wrapper.get('[data-testid="encounter-side-assignment-target"]').setValue('__unaffiliated__')
    await wrapper.get('[data-testid="encounter-side-assign"]').trigger('click')

    expect(wrapper.emitted('assign-placements')).toEqual([[
      { placementIds: ['pokemon-b'], sideId: null },
    ]])
  })

  it('disables all mutations outside Prepare Map mode', async () => {
    const wrapper = mount(MapAdminEncounterSidesControl, {
      props: {
        sides,
        placements,
        selectedPlacementId: 'trainer-a',
        disabled: true,
      },
    })

    expect(wrapper.text()).toContain('Switch to Prepare Map mode')
    expect(wrapper.get('[data-testid="encounter-side-create"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-side-id="heroes"] [data-testid="encounter-side-label"]').attributes('disabled')).toBeDefined()
    expect(placementCheckbox(wrapper, 'trainer-a').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="encounter-side-assign"]').attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="encounter-side-create"]').trigger('click')
    await wrapper.get('[data-side-id="heroes"] [data-testid="encounter-side-status"]').trigger('click')
    await wrapper.get('[data-testid="encounter-side-assign"]').trigger('click')

    expect(wrapper.emitted('create-side')).toBeUndefined()
    expect(wrapper.emitted('set-side-status')).toBeUndefined()
    expect(wrapper.emitted('assign-placements')).toBeUndefined()
  })
})
