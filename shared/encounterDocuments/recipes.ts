import rawRecipes from '../../data/encounter-workspace/encounter-recipes.json'
import {
  ENCOUNTER_RECIPE_IDS,
  type EncounterDocumentClock,
  type EncounterDocumentObjective,
  type EncounterDocumentPhase,
  type EncounterRecipeId,
} from './model'

type RecipeRole = 'boss' | 'leader' | 'standard' | 'minion' | 'support'
type RecipeStage = 'standard' | 'boss' | 'chase'
type RecipeTactical = 'on-demand' | 'split'
type RecipeVisibility = 'public' | 'gm'

export interface EncounterRecipe {
  readonly recipeId: EncounterRecipeId
  readonly label: string
  readonly description: string
  readonly defaultCount: { readonly minimum: number, readonly maximum: number }
  readonly defaultRole: RecipeRole
  readonly hideNewCast: boolean
  readonly stage: RecipeStage
  readonly tactical: RecipeTactical
  readonly documentDefaults: {
    readonly objective: { readonly label: string, readonly visibility: RecipeVisibility } | null
    readonly clocks: readonly {
      readonly key: string
      readonly label: string
      readonly visibility: RecipeVisibility
      readonly maximum: number
    }[]
    readonly phases: readonly {
      readonly key: string
      readonly label: string
      readonly visibility: RecipeVisibility
      readonly status: 'active' | 'upcoming'
    }[]
    readonly activePhaseKey: string | null
  }
}

export interface EncounterRecipeScaffold {
  readonly objectives: readonly EncounterDocumentObjective[]
  readonly clocks: readonly EncounterDocumentClock[]
  readonly phases: readonly EncounterDocumentPhase[]
  readonly activePhaseId: string | null
}

const fail = (message: string): never => { throw new Error(`Encounter recipes: ${message}`) }
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${path} must be an object`)
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, keys: readonly string[], path: string): void => {
  const expected = new Set(keys)
  if (Object.keys(value).length !== expected.size || Object.keys(value).some(key => !expected.has(key))) fail(`${path} has unsupported or missing fields`)
}
const text = (value: unknown, path: string, maximum = 4_000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return fail(`${path} must be bounded text`)
  return value.trim()
}
const oneOf = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) return fail(`${path} is unknown`)
  return value as T
}
const key = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) return fail(`${path} must be a stable recipe key`)
  return value
}
const rows = (value: unknown, path: string, maximum: number): Record<string, unknown>[] => {
  if (!Array.isArray(value) || value.length > maximum) return fail(`${path} must be a bounded array`)
  return value.map((entry, index) => record(entry, `${path}[${index}]`))
}

const parse = (): readonly EncounterRecipe[] => {
  const source = record(rawRecipes as unknown, 'source')
  exact(source, ['schemaVersion', 'recipes'], 'source')
  if (source.schemaVersion !== 1) fail('unsupported source version')
  const recipeRows = rows(source.recipes, 'recipes', ENCOUNTER_RECIPE_IDS.length)
  const recipes = recipeRows.map((row, index): EncounterRecipe => {
    const path = `recipes[${index}]`
    exact(row, ['recipeId', 'label', 'description', 'defaultCount', 'defaultRole', 'hideNewCast', 'stage', 'tactical', 'documentDefaults'], path)
    const recipeId = oneOf(row.recipeId, ENCOUNTER_RECIPE_IDS, `${path}.recipeId`)
    const count = record(row.defaultCount, `${path}.defaultCount`)
    exact(count, ['minimum', 'maximum'], `${path}.defaultCount`)
    if (!Number.isSafeInteger(count.minimum) || !Number.isSafeInteger(count.maximum)
      || Number(count.minimum) < 1 || Number(count.maximum) > 30 || Number(count.minimum) > Number(count.maximum)) {
      fail(`${path}.defaultCount is invalid`)
    }
    if (typeof row.hideNewCast !== 'boolean') fail(`${path}.hideNewCast must be a boolean`)
    const defaults = record(row.documentDefaults, `${path}.documentDefaults`)
    exact(defaults, ['objective', 'clocks', 'phases', 'activePhaseKey'], `${path}.documentDefaults`)
    let objective: EncounterRecipe['documentDefaults']['objective'] = null
    if (defaults.objective !== null) {
      const input = record(defaults.objective, `${path}.documentDefaults.objective`)
      exact(input, ['label', 'visibility'], `${path}.documentDefaults.objective`)
      objective = Object.freeze({
        label: text(input.label, `${path}.documentDefaults.objective.label`, 200),
        visibility: oneOf(input.visibility, ['public', 'gm'] as const, `${path}.documentDefaults.objective.visibility`),
      })
    }
    const clocks = rows(defaults.clocks, `${path}.documentDefaults.clocks`, 8).map((input, clockIndex) => {
      const clockPath = `${path}.documentDefaults.clocks[${clockIndex}]`
      exact(input, ['key', 'label', 'visibility', 'maximum'], clockPath)
      if (!Number.isSafeInteger(input.maximum) || Number(input.maximum) < 1 || Number(input.maximum) > 100) fail(`${clockPath}.maximum is invalid`)
      return Object.freeze({
        key: key(input.key, `${clockPath}.key`),
        label: text(input.label, `${clockPath}.label`, 200),
        visibility: oneOf(input.visibility, ['public', 'gm'] as const, `${clockPath}.visibility`),
        maximum: Number(input.maximum),
      })
    })
    const phases = rows(defaults.phases, `${path}.documentDefaults.phases`, 8).map((input, phaseIndex) => {
      const phasePath = `${path}.documentDefaults.phases[${phaseIndex}]`
      exact(input, ['key', 'label', 'visibility', 'status'], phasePath)
      return Object.freeze({
        key: key(input.key, `${phasePath}.key`),
        label: text(input.label, `${phasePath}.label`, 200),
        visibility: oneOf(input.visibility, ['public', 'gm'] as const, `${phasePath}.visibility`),
        status: oneOf(input.status, ['active', 'upcoming'] as const, `${phasePath}.status`),
      })
    })
    if (new Set(clocks.map(clock => clock.key)).size !== clocks.length || new Set(phases.map(phase => phase.key)).size !== phases.length) fail(`${path} contains duplicate template keys`)
    const activePhaseKey = defaults.activePhaseKey === null ? null : key(defaults.activePhaseKey, `${path}.documentDefaults.activePhaseKey`)
    if (activePhaseKey && !phases.some(phase => phase.key === activePhaseKey && phase.status === 'active')) fail(`${path}.documentDefaults.activePhaseKey is contradictory`)
    if (!activePhaseKey && phases.some(phase => phase.status === 'active')) fail(`${path}.documentDefaults phases require an activePhaseKey`)
    return Object.freeze({
      recipeId,
      label: text(row.label, `${path}.label`, 200),
      description: text(row.description, `${path}.description`),
      defaultCount: Object.freeze({ minimum: Number(count.minimum), maximum: Number(count.maximum) }),
      defaultRole: oneOf(row.defaultRole, ['boss', 'leader', 'standard', 'minion', 'support'] as const, `${path}.defaultRole`),
      hideNewCast: row.hideNewCast as boolean,
      stage: oneOf(row.stage, ['standard', 'boss', 'chase'] as const, `${path}.stage`),
      tactical: oneOf(row.tactical, ['on-demand', 'split'] as const, `${path}.tactical`),
      documentDefaults: Object.freeze({ objective, clocks: Object.freeze(clocks), phases: Object.freeze(phases), activePhaseKey }),
    })
  })
  if (recipes.length !== ENCOUNTER_RECIPE_IDS.length || new Set(recipes.map(recipe => recipe.recipeId)).size !== recipes.length
    || !ENCOUNTER_RECIPE_IDS.every(id => recipes.some(recipe => recipe.recipeId === id))) fail('must define every recipe exactly once')
  return Object.freeze(recipes)
}

export const ENCOUNTER_RECIPES = parse()
export const encounterRecipe = (recipeId: EncounterRecipeId): EncounterRecipe => (
  ENCOUNTER_RECIPES.find(recipe => recipe.recipeId === recipeId) ?? fail(`missing ${recipeId}`)
)

export const encounterRecipeScaffold = (recipeId: EncounterRecipeId, encounterId: string): EncounterRecipeScaffold => {
  const recipe = encounterRecipe(recipeId)
  const id = (kind: string, key: string): string => `${kind}:${encounterId}:${key}`
  const objectives: EncounterDocumentObjective[] = recipe.documentDefaults.objective ? [{
    objectiveId: id('objective', 'primary'),
    label: recipe.documentDefaults.objective.label,
    visibility: recipe.documentDefaults.objective.visibility,
    status: 'active', progress: null, maximum: null,
  }] : []
  const clocks: EncounterDocumentClock[] = recipe.documentDefaults.clocks.map(clock => ({
    clockId: id('clock', clock.key), label: clock.label, visibility: clock.visibility,
    status: 'active', progress: 0, maximum: clock.maximum,
  }))
  const phases: EncounterDocumentPhase[] = recipe.documentDefaults.phases.map(phase => ({
    phaseId: id('phase', phase.key), label: phase.label, visibility: phase.visibility,
    status: phase.status, summary: null,
  }))
  return Object.freeze({
    objectives: Object.freeze(objectives),
    clocks: Object.freeze(clocks),
    phases: Object.freeze(phases),
    activePhaseId: recipe.documentDefaults.activePhaseKey ? id('phase', recipe.documentDefaults.activePhaseKey) : null,
  })
}
