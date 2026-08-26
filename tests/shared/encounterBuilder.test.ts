import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_BUILDER_SCHEMA_VERSION,
  EncounterBuilderValidationError,
  parseLaunchEncounterBuilderRequest,
} from '#shared/encounterDocuments/builder'
import { ENCOUNTER_RECIPES, encounterRecipe, encounterRecipeScaffold } from '#shared/encounterDocuments/recipes'
import { ENCOUNTER_RECIPE_IDS } from '#shared/encounterDocuments/model'

const validRequest = () => ({
  schemaVersion: ENCOUNTER_BUILDER_SCHEMA_VERSION,
  launchId: 'launch-1', encounterId: 'test-encounter', name: 'Test encounter', recipe: 'boss',
  mapSlug: 'arena', expectedMapRevision: 3, clientId: 'client-1', startInitiative: true,
  presentation: { stage: 'boss', tactical: 'on-demand' },
  handoff: { kind: 'wild-package', documentId: 'wild-package:v1:0123456789abcdef0123456789abcdef', expectedRevision: 0, sceneId: null },
  cast: [{ castId: 'cast-1', sheet: { kind: 'pokemon', slug: 'pikachu', expectedRevision: 0 }, sourceCandidateId: 'candidate-1', sideId: 'foes', role: 'boss', hidden: false }],
  publicStakes: null, gmStakes: 'Escalation at half HP', notes: null,
})

describe('Encounter Builder contracts', () => {
  it('defines every canonical recipe exactly once with bounded authoring defaults', () => {
    expect(ENCOUNTER_RECIPES.map(recipe => recipe.recipeId)).toEqual(ENCOUNTER_RECIPE_IDS)
    expect(encounterRecipe('trainer-duel')).toMatchObject({ defaultRole: 'standard', stage: 'standard' })
    expect(encounterRecipe('ambush')).toMatchObject({ hideNewCast: true })
    expect(encounterRecipe('boss')).toMatchObject({ defaultRole: 'boss', stage: 'boss' })
    expect(encounterRecipe('chase-ready')).toMatchObject({ stage: 'chase', tactical: 'split' })
    expect(encounterRecipeScaffold('trainer-duel', 'duel')).toMatchObject({ objectives: [{ label: 'Win the match' }], clocks: [], phases: [] })
    expect(encounterRecipeScaffold('ambush', 'ambush').objectives[0]?.label).toContain('ambush')
    expect(encounterRecipeScaffold('swarm', 'swarm').objectives[0]?.label).toContain('swarm')
    expect(encounterRecipeScaffold('boss', 'boss')).toMatchObject({
      clocks: [{ clockId: 'clock:boss:escalation', maximum: 6 }],
      phases: [{ phaseId: 'phase:boss:opening', status: 'active' }, { phaseId: 'phase:boss:finale', status: 'upcoming' }],
      activePhaseId: 'phase:boss:opening',
    })
    expect(encounterRecipeScaffold('hunt-capture', 'hunt').clocks).toMatchObject([{ visibility: 'gm' }])
    expect(encounterRecipeScaffold('chase-ready', 'chase')).toMatchObject({
      clocks: [{ clockId: 'clock:chase:escape' }], activePhaseId: 'phase:chase:pursuit',
    })
    expect(encounterRecipeScaffold('blank', 'blank')).toEqual({ objectives: [], clocks: [], phases: [], activePhaseId: null })
  })

  it('parses a closed reviewed-launch payload without mechanics authority', () => {
    expect(parseLaunchEncounterBuilderRequest(validRequest())).toEqual(validRequest())
  })

  it.each([
    ['unknown top-level fields', { ...validRequest(), damage: 99 }],
    ['unknown cast fields', { ...validRequest(), cast: [{ ...validRequest().cast[0], command: 'attack' }] }],
    ['unknown recipe', { ...validRequest(), recipe: 'raid' }],
    ['invalid side identity', { ...validRequest(), cast: [{ ...validRequest().cast[0], sideId: 'bad side' }] }],
    ['duplicate cast identities', { ...validRequest(), cast: [validRequest().cast[0], validRequest().cast[0]] }],
    ['unbounded cast', { ...validRequest(), cast: Array.from({ length: 31 }, (_, index) => ({ ...validRequest().cast[0], castId: `cast-${index}` })) }],
  ])('fails closed for %s', (_label, payload) => {
    expect(() => parseLaunchEncounterBuilderRequest(payload)).toThrow(EncounterBuilderValidationError)
  })
})
