import {
  createEmptyEncounterState,
  type EncounterSide,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'

const side = (id: string, label: string): EncounterSide => ({
  id,
  label,
  status: 'active',
})

/** Fresh, valid two-side state for move-automation relationship fixtures. */
export const redBlueEncounterStateFixture = (): EncounterState => ({
  ...createEmptyEncounterState(),
  sides: {
    red: side('red', 'Red Side'),
    blue: side('blue', 'Blue Side'),
  },
})
