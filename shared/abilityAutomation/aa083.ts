export const AA083_POLTERGEIST_FORMS = Object.freeze({
  standard: Object.freeze({ abilityId: 'Levitate', moveId: null }),
  heat: Object.freeze({ abilityId: 'Flash Fire', moveId: 'Overheat' }),
  wash: Object.freeze({ abilityId: 'Water Absorb', moveId: 'Hydro Pump' }),
  frost: Object.freeze({ abilityId: 'Winter’s Kiss', moveId: 'Blizzard' }),
  fan: Object.freeze({ abilityId: 'Windveiled', moveId: 'Hurricane' }),
  mow: Object.freeze({ abilityId: 'Sap Sipper', moveId: 'Leaf Storm' }),
} as const)

export type Aa083PoltergeistForm = keyof typeof AA083_POLTERGEIST_FORMS

export const aa083PoltergeistFormForSpecies = (
  species: string | null | undefined,
): Aa083PoltergeistForm | null => {
  const normalized = species?.trim().toLowerCase().replace(/[^a-z]+/g, ' ').trim() ?? ''
  if (normalized === 'rotom') return 'standard'
  for (const form of ['heat', 'wash', 'frost', 'fan', 'mow'] as const) {
    if (normalized === `rotom ${form}` || normalized === `${form} rotom`) return form
  }
  return null
}
