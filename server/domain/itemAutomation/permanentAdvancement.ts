import { createHash } from 'node:crypto'
import movesJson from '~~/data/reference/moves.json'
import rulesJson from '~~/data/reference/rules.json'
import type {
  ItemEffectSpec,
  ItemPermanentBaseStat,
  ItemRuntimeDefinition,
} from '#shared/itemAutomation/spec'
import {
  appendItemPermanentAdvancementApplication,
  parseItemPermanentAdvancementState,
  type ItemPermanentAdvancementApplicationKind,
  type ItemPermanentAdvancementApplicationV1,
  type ItemPermanentAdvancementStat,
} from '#shared/itemAutomation/permanentAdvancement'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PtuItemAdvancementMechanicsV1, PtuMove } from '~/types/ptuReference'
import type { CharacterSheet, CharacterSheetMove, StatKey } from '~/types/characterSheet'
import type { SheetKind } from '#shared/sheets'
import {
  pokemonAddedStatPointBudget,
  resolveStats,
  validateBaseRelations,
} from '~/utils/sheets/pokemonDerived'
import {
  calculatePokemonLevelFromExperience,
  pokemonExperienceNeededForLevel,
} from '~/utils/sheets/pokemonExperience'
import {
  computePokemonTutorPointsEarnedForSheet,
  syncPokemonTutorPointsForSheet,
} from '~/utils/sheets/pokemonTutorPoints'
import { resolvePokemonVitaminSummary } from '~/utils/sheets/pokemonVitamins'

export const PERMANENT_ADVANCEMENT_MOVE_CHOICE_ID = 'permanent-move'
export const PERMANENT_ADVANCEMENT_STAT_CHOICE_ID = 'permanent-stat'
export const PERMANENT_ADVANCEMENT_CONSENT_CHOICE_ID = 'trainer-consent'

export interface ItemPermanentAdvancementPreviewFact {
  readonly label: string
  readonly value: string
  readonly tone: 'neutral' | 'positive' | 'warning'
}

export interface ItemPermanentAdvancementChoiceOption {
  readonly optionId: string
  readonly label: string
  readonly description: string | null
  readonly previewFacts: readonly ItemPermanentAdvancementPreviewFact[]
}

export interface ItemPermanentAdvancementChoice {
  readonly choiceId: string
  readonly label: string
  readonly presentation: 'radio' | 'confirmation'
  readonly minimum: number
  readonly maximum: number
  readonly options: readonly ItemPermanentAdvancementChoiceOption[]
}

export interface ItemPermanentAdvancementPreview {
  readonly kind: ItemPermanentAdvancementApplicationKind
  readonly description: string
  readonly previewFacts: readonly ItemPermanentAdvancementPreviewFact[]
  readonly choices: readonly ItemPermanentAdvancementChoice[]
  readonly selectionComplete: boolean
}

export interface ResolvedPermanentAdvancementApplication {
  readonly preview: ItemPermanentAdvancementPreview
  readonly sheet: CharacterSheet
  readonly payload: Record<string, unknown>
}

type PermanentAdvancementEffect = Extract<ItemEffectSpec, {
  readonly operation:
    | 'modify-base-stat'
    | 'grant-tutor-points'
    | 'increase-move-frequency'
    | 'gain-next-level-experience'
}>

interface TrackingSnapshot {
  readonly statBoosts: Record<StatKey, number>
  readonly statSuppressants: Record<StatKey, number>
  readonly heartBooster: boolean
  readonly ppUp: boolean
  readonly rareCandies: number
}

interface MoveFrequencyOption extends ItemPermanentAdvancementChoiceOption {
  readonly moveIndex: number
  readonly moveName: string
  readonly previousFrequency: string
  readonly resultingFrequency: string
}

const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const STAT_LABELS: Readonly<Record<StatKey, string>> = Object.freeze({
  hp: 'HP', atk: 'Attack', def: 'Defense', satk: 'Special Attack', sdef: 'Special Defense', spd: 'Speed',
})
const canonicalMoves = movesJson as unknown as Record<string, PtuMove>
const advancementRule = (rulesJson as unknown as Record<string, {
  readonly itemAdvancementMechanics?: PtuItemAdvancementMechanicsV1
}>)['Vitamins and Related Items']?.itemAdvancementMechanics

if (!advancementRule
  || advancementRule.schemaVersion !== 1
  || advancementRule.vitaminLifetimeLimit !== 5
  || advancementRule.heartBooster.lifetimeLimit !== 1
  || advancementRule.heartBooster.tutorPoints !== 2
  || advancementRule.ppUp.lifetimeLimit !== 1
  || advancementRule.ppUp.atWillPolicy !== 'ineligible'
  || advancementRule.ppUp.eotResult !== 'At-Will'
  || advancementRule.ppUp.repeatableFrequencies.join(',') !== 'Scene,Daily'
  || advancementRule.ppUp.additionalUses !== 1
  || advancementRule.rareCandy.lifetimeLimit !== 5
  || advancementRule.rareCandy.maximumLevel !== 100
  || advancementRule.rareCandy.experienceResult !== 'minimum-for-next-level'
  || advancementRule.statSuppressants.baseStatDelta !== -1
  || advancementRule.statSuppressants.minimumBaseStat !== 1
  || advancementRule.statSuppressants.consent !== 'owning-trainer-explicit') {
  throw new Error('Canonical permanent advancement rule authority is unavailable or stale.')
}

const clone = <T>(value: T): T => structuredClone(value)
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const count = (value: unknown, label: string): number => {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 256) {
    throw new Error(`${label} must be a bounded non-negative integer.`)
  }
  return Number(value)
}

const trackingSnapshot = (sheet: CharacterSheet): TrackingSnapshot => {
  const vitamins = sheet.vitamins
  const statBoosts = Object.fromEntries(STAT_KEYS.map(stat => [
    stat,
    count(vitamins?.statBoosts?.[stat], `vitamins.statBoosts.${stat}`),
  ])) as Record<StatKey, number>
  const statSuppressants = Object.fromEntries(STAT_KEYS.map(stat => [
    stat,
    count(vitamins?.statSuppressants?.[stat], `vitamins.statSuppressants.${stat}`),
  ])) as Record<StatKey, number>
  if (vitamins?.heartBooster !== undefined && typeof vitamins.heartBooster !== 'boolean') {
    throw new Error('vitamins.heartBooster must be boolean.')
  }
  if (vitamins?.ppUp !== undefined && typeof vitamins.ppUp !== 'boolean') {
    throw new Error('vitamins.ppUp must be boolean.')
  }
  return {
    statBoosts,
    statSuppressants,
    heartBooster: vitamins?.heartBooster === true,
    ppUp: vitamins?.ppUp === true,
    rareCandies: count(vitamins?.rareCandies, 'vitamins.rareCandies'),
  }
}

const validateProvenanceFloor = (sheet: CharacterSheet, tracking: TrackingSnapshot): void => {
  const provenance = parseItemPermanentAdvancementState(
    sheet.serverPrivate?.itemPermanentAdvancement,
  )
  const recordedStatBoosts = Object.fromEntries(STAT_KEYS.map(stat => [stat, 0])) as Record<StatKey, number>
  const recordedSuppressants = Object.fromEntries(STAT_KEYS.map(stat => [stat, 0])) as Record<StatKey, number>
  let heartBooster = 0
  let ppUp = 0
  let rareCandy = 0
  for (const application of provenance.applications) {
    if (application.kind === 'stat-vitamin') recordedStatBoosts[application.stat!] += 1
    else if (application.kind === 'stat-suppressant') recordedSuppressants[application.stat!] += 1
    else if (application.kind === 'heart-booster') heartBooster += 1
    else if (application.kind === 'pp-up') ppUp += 1
    else rareCandy += 1
  }
  if (heartBooster > advancementRule.heartBooster.lifetimeLimit
    || ppUp > advancementRule.ppUp.lifetimeLimit
    || rareCandy > advancementRule.rareCandy.lifetimeLimit
    || heartBooster > (tracking.heartBooster ? 1 : 0)
    || ppUp > (tracking.ppUp ? 1 : 0)
    || rareCandy > tracking.rareCandies
    || STAT_KEYS.some(stat => recordedStatBoosts[stat] > tracking.statBoosts[stat]
      || recordedSuppressants[stat] > tracking.statSuppressants[stat])) {
    throw new Error('Permanent item tracking no longer matches its immutable accepted provenance.')
  }
}

const ensureTrackingObjects = (sheet: CharacterSheet): void => {
  sheet.vitamins = { ...(sheet.vitamins ?? {}) }
  sheet.vitamins.statBoosts = { ...(sheet.vitamins.statBoosts ?? {}) }
  sheet.vitamins.statSuppressants = { ...(sheet.vitamins.statSuppressants ?? {}) }
  sheet.tutorPoints = { ...(sheet.tutorPoints ?? {}) }
  sheet.serverPrivate = { ...(sheet.serverPrivate ?? {}) }
}

const validateSheetAfterAdvancement = (sheet: CharacterSheet): void => {
  if (!Number.isSafeInteger(sheet.level) || sheet.level < 1 || sheet.level > advancementRule.rareCandy.maximumLevel) {
    throw new Error('Permanent advancement requires a Pokémon Level from 1 through 100.')
  }
  const tracking = trackingSnapshot(sheet)
  const vitaminCount = STAT_KEYS.reduce((sum, stat) => sum + tracking.statBoosts[stat], 0)
    + (tracking.heartBooster ? 1 : 0) + (tracking.ppUp ? 1 : 0)
  if (vitaminCount > advancementRule.vitaminLifetimeLimit) {
    throw new Error('This Pokémon would exceed the five-Vitamin lifetime limit.')
  }
  if (tracking.rareCandies > advancementRule.rareCandy.lifetimeLimit) {
    throw new Error('This Pokémon would exceed the five-Rare-Candy lifetime limit.')
  }
  const stats = resolveStats(sheet)
  const added = stats.map(stat => stat.added)
  if (added.some(value => !Number.isSafeInteger(value) || value < 0)
    || added.reduce((sum, value) => sum + value, 0) > pokemonAddedStatPointBudget(sheet)) {
    throw new Error('The resulting Pokémon would exceed its legal added Stat Point budget.')
  }
  if (validateBaseRelations(stats).length > 0) {
    throw new Error('The resulting Pokémon would violate Base Relations.')
  }
  const spentTutorPoints = count(sheet.tutorPoints?.spent, 'tutorPoints.spent')
  if (spentTutorPoints > computePokemonTutorPointsEarnedForSheet(sheet)) {
    throw new Error('The resulting Pokémon would have more spent Tutor Points than it has earned.')
  }
  if (sheet.totalExp !== undefined) {
    if (!Number.isSafeInteger(sheet.totalExp) || sheet.totalExp < 0
      || calculatePokemonLevelFromExperience(sheet.totalExp) !== sheet.level) {
      throw new Error('The Pokémon’s Level and total Experience are inconsistent.')
    }
  }
  validateProvenanceFloor(sheet, tracking)
}

const permanentEffect = (definition: ItemRuntimeDefinition): PermanentAdvancementEffect => {
  const effects = definition.spec.effects.filter((effect): effect is PermanentAdvancementEffect => [
    'modify-base-stat', 'grant-tutor-points', 'increase-move-frequency', 'gain-next-level-experience',
  ].includes(effect.operation))
  if (effects.length !== 1) throw new Error('Permanent advancement requires one reviewed effect.')
  return effects[0]!
}

const selected = (
  selections: ReadonlyMap<string, readonly string[]>,
  choiceId: string,
): readonly string[] => selections.get(choiceId) ?? []

const vitaminFact = (before: number, after: number): ItemPermanentAdvancementPreviewFact => ({
  label: 'Vitamin limit',
  value: `${before} / ${advancementRule.vitaminLifetimeLimit} → ${after} / ${advancementRule.vitaminLifetimeLimit}`,
  tone: after === advancementRule.vitaminLifetimeLimit ? 'warning' : 'neutral',
})

const assertCurrentTracking = (sheet: CharacterSheet): TrackingSnapshot => {
  const tracking = trackingSnapshot(sheet)
  validateProvenanceFloor(sheet, tracking)
  const summary = resolvePokemonVitaminSummary(sheet)
  if (summary.exceedsVitaminLimit || summary.vitaminSlotsUsed < 0
    || summary.vitaminSlotsUsed > advancementRule.vitaminLifetimeLimit) {
    throw new Error('The Pokémon’s current Vitamin tracking exceeds the canonical lifetime limit.')
  }
  if (tracking.rareCandies > advancementRule.rareCandy.lifetimeLimit) {
    throw new Error('The Pokémon’s current Rare Candy tracking exceeds the canonical lifetime limit.')
  }
  return tracking
}

const statAfter = (sheet: CharacterSheet, stat: StatKey, kind: 'boost' | 'suppress'): CharacterSheet => {
  const next = clone(sheet)
  ensureTrackingObjects(next)
  const values = kind === 'boost' ? next.vitamins!.statBoosts! : next.vitamins!.statSuppressants!
  values[stat] = count(values[stat], `vitamins.${kind}.${stat}`) + 1
  syncPokemonTutorPointsForSheet(next)
  return next
}

const resolveStatOption = (input: {
  readonly sheet: CharacterSheet
  readonly stat: StatKey
  readonly kind: 'boost' | 'suppress'
}): { readonly sheet: CharacterSheet, readonly before: number, readonly after: number } => {
  const before = resolveStats(input.sheet).find(stat => stat.key === input.stat)?.base
  if (!Number.isSafeInteger(before)) throw new Error(`Current ${STAT_LABELS[input.stat]} Base Stat is unavailable.`)
  const sheet = statAfter(input.sheet, input.stat, input.kind)
  const after = resolveStats(sheet).find(stat => stat.key === input.stat)?.base
  const expectedDelta = input.kind === 'boost' ? 1 : -1
  if (after !== before! + expectedDelta || after! < advancementRule.statSuppressants.minimumBaseStat) {
    throw new Error(`${STAT_LABELS[input.stat]} cannot be changed by this item.`)
  }
  validateSheetAfterAdvancement(sheet)
  return { sheet, before: before!, after: after! }
}

const currentMoveFrequency = (move: CharacterSheetMove): string | null => {
  const name = move.name?.trim()
  if (!name) return null
  const canonical = canonicalMoves[name]
  if (!canonical || canonical.name !== name) return null
  const frequency = move.frequency?.trim() || canonical.frequency?.trim()
  return frequency || null
}

export const nextPpUpFrequency = (frequency: string): string | null => {
  if (frequency === 'At-Will') return null
  if (frequency === 'EOT') return advancementRule.ppUp.eotResult
  const match = /^(Scene|Daily)(?: x([1-9][0-9]*))?$/.exec(frequency)
  if (!match || !advancementRule.ppUp.repeatableFrequencies.includes(match[1] as 'Scene' | 'Daily')) return null
  const currentUses = match[2] ? Number(match[2]) : 1
  if (!Number.isSafeInteger(currentUses) || currentUses >= 99) return null
  return `${match[1]} x${currentUses + advancementRule.ppUp.additionalUses}`
}

const moveOptions = (sheet: CharacterSheet): readonly MoveFrequencyOption[] => {
  const moves = sheet.movelist ?? []
  const names = moves.map(move => move.name?.trim().toLocaleLowerCase('en-US') ?? '')
  if (names.some(name => !name) || new Set(names).size !== names.length) {
    throw new Error('PP Up requires a valid, unambiguous Pokémon Move list.')
  }
  return Object.freeze(moves.flatMap((move, moveIndex): MoveFrequencyOption[] => {
    const previousFrequency = currentMoveFrequency(move)
    const resultingFrequency = previousFrequency ? nextPpUpFrequency(previousFrequency) : null
    if (!previousFrequency || !resultingFrequency) return []
    const optionId = `move-choice:v1:${sha256(stableJsonStringify({
      sheetSlug: sheet.slug,
      moveIndex,
      moveName: move.name,
      previousFrequency,
    })).slice(0, 32)}`
    return [{
      optionId,
      moveIndex,
      moveName: move.name,
      previousFrequency,
      resultingFrequency,
      label: move.name,
      description: `${previousFrequency} → ${resultingFrequency}`,
      previewFacts: Object.freeze([{
        label: move.name,
        value: `${previousFrequency} → ${resultingFrequency}`,
        tone: 'positive' as const,
      }]),
    }]
  }))
}

const baseApplication = (input: {
  readonly operationId: string
  readonly definition: ItemRuntimeDefinition
  readonly kind: ItemPermanentAdvancementApplicationKind
  readonly appliedAt: number
}): Omit<ItemPermanentAdvancementApplicationV1,
  'stat' | 'moveName' | 'moveListIndex' | 'previousFrequency' | 'resultingFrequency' | 'previousLevel' | 'resultingLevel'> => {
  if (!Number.isSafeInteger(input.appliedAt) || input.appliedAt < 0) {
    throw new Error('Permanent advancement requires a server-owned application timestamp.')
  }
  return {
    sourceOperationId: input.operationId,
    canonicalItemId: input.definition.canonicalId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    kind: input.kind,
    appliedAt: input.appliedAt,
  }
}

const finishApplication = (input: {
  readonly sheet: CharacterSheet
  readonly application: ItemPermanentAdvancementApplicationV1
}): CharacterSheet => {
  const sheet = clone(input.sheet)
  ensureTrackingObjects(sheet)
  sheet.serverPrivate!.itemPermanentAdvancement = appendItemPermanentAdvancementApplication({
    current: sheet.serverPrivate!.itemPermanentAdvancement,
    application: input.application,
  })
  validateSheetAfterAdvancement(sheet)
  return sheet
}

export const previewPermanentItemAdvancement = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sheetKind: SheetKind
  readonly sheet: unknown
  readonly selectedChoices?: ReadonlyMap<string, readonly string[]>
}): ItemPermanentAdvancementPreview => {
  if (input.sheetKind !== 'pokemon') throw new Error('Permanent advancement items target Pokémon only.')
  const sheet = input.sheet as CharacterSheet
  const tracking = assertCurrentTracking(sheet)
  const effect = permanentEffect(input.definition)
  const selections = input.selectedChoices ?? new Map<string, readonly string[]>()
  const vitaminBefore = resolvePokemonVitaminSummary(sheet).vitaminSlotsUsed
  if ('countsAsVitamin' in effect && effect.countsAsVitamin
    && vitaminBefore >= advancementRule.vitaminLifetimeLimit) {
    throw new Error('This Pokémon has already reached the five-Vitamin lifetime limit.')
  }

  if (effect.operation === 'modify-base-stat' && effect.amount === 1 && effect.stat !== 'selected') {
    const result = resolveStatOption({ sheet, stat: effect.stat, kind: 'boost' })
    return Object.freeze({
      kind: 'stat-vitamin',
      description: `Permanently raise ${STAT_LABELS[effect.stat]} Base Stat by 1.`,
      previewFacts: Object.freeze([
        { label: `${STAT_LABELS[effect.stat]} Base Stat`, value: `${result.before} → ${result.after}`, tone: 'positive' as const },
        vitaminFact(vitaminBefore, vitaminBefore + 1),
      ]),
      choices: Object.freeze([]),
      selectionComplete: true,
    })
  }

  if (effect.operation === 'grant-tutor-points') {
    if (tracking.heartBooster) throw new Error('This Pokémon has already benefited from a Heart Booster.')
    const next = clone(sheet)
    ensureTrackingObjects(next)
    next.vitamins!.heartBooster = true
    syncPokemonTutorPointsForSheet(next)
    validateSheetAfterAdvancement(next)
    return Object.freeze({
      kind: 'heart-booster',
      description: 'Permanently gain 2 Tutor Points.',
      previewFacts: Object.freeze([
        {
          label: 'Tutor Points earned',
          value: `${computePokemonTutorPointsEarnedForSheet(sheet)} → ${computePokemonTutorPointsEarnedForSheet(next)}`,
          tone: 'positive' as const,
        },
        vitaminFact(vitaminBefore, vitaminBefore + 1),
      ]),
      choices: Object.freeze([]),
      selectionComplete: true,
    })
  }

  if (effect.operation === 'increase-move-frequency') {
    if (tracking.ppUp) throw new Error('This Pokémon has already benefited from PP Up.')
    const options = moveOptions(sheet)
    if (options.length === 0) throw new Error('This Pokémon has no Move with an eligible Frequency for PP Up.')
    const choice: ItemPermanentAdvancementChoice = Object.freeze({
      choiceId: PERMANENT_ADVANCEMENT_MOVE_CHOICE_ID,
      label: 'Choose a move',
      presentation: 'radio',
      minimum: 1,
      maximum: 1,
      options,
    })
    const chosen = selected(selections, choice.choiceId)
    const selectedOption = chosen.length === 1
      ? options.find(option => option.optionId === chosen[0]) ?? null
      : null
    return Object.freeze({
      kind: 'pp-up',
      description: 'Permanently raise one eligible Move’s Frequency one level.',
      previewFacts: Object.freeze([
        vitaminFact(vitaminBefore, vitaminBefore + 1),
        ...(selectedOption ? selectedOption.previewFacts : [{
          label: 'Eligible Moves', value: String(options.length), tone: 'neutral' as const,
        }]),
      ]),
      choices: Object.freeze([choice]),
      selectionComplete: selectedOption !== null && chosen.length === 1,
    })
  }

  if (effect.operation === 'gain-next-level-experience') {
    if (tracking.rareCandies >= advancementRule.rareCandy.lifetimeLimit) {
      throw new Error('This Pokémon has already benefited from five Rare Candies.')
    }
    if (!Number.isSafeInteger(sheet.level) || sheet.level < 1 || sheet.level >= advancementRule.rareCandy.maximumLevel) {
      throw new Error('A Level 100 Pokémon cannot benefit from Rare Candy.')
    }
    const currentMinimum = pokemonExperienceNeededForLevel(sheet.level)
    const currentExperience = sheet.totalExp ?? currentMinimum
    if (!Number.isSafeInteger(currentExperience) || currentExperience! < 0
      || calculatePokemonLevelFromExperience(currentExperience!) !== sheet.level) {
      throw new Error('Rare Candy requires consistent current Level and Experience authority.')
    }
    const nextLevel = sheet.level + 1
    const nextExperience = pokemonExperienceNeededForLevel(nextLevel)
    if (!Number.isSafeInteger(nextExperience) || nextExperience! <= currentExperience!) {
      throw new Error('The next Pokémon Experience threshold is unavailable.')
    }
    const next = clone(sheet)
    ensureTrackingObjects(next)
    next.level = nextLevel
    next.totalExp = nextExperience
    next.vitamins!.rareCandies = tracking.rareCandies + 1
    syncPokemonTutorPointsForSheet(next)
    validateSheetAfterAdvancement(next)
    return Object.freeze({
      kind: 'rare-candy',
      description: 'Gain exactly enough total Experience to reach the next Level.',
      previewFacts: Object.freeze([
        { label: 'Level', value: `${sheet.level} → ${nextLevel}`, tone: 'positive' as const },
        { label: 'Total Experience', value: `${currentExperience} → ${nextExperience}`, tone: 'positive' as const },
        {
          label: 'Rare Candy lifetime use',
          value: `${tracking.rareCandies} / ${advancementRule.rareCandy.lifetimeLimit} → ${tracking.rareCandies + 1} / ${advancementRule.rareCandy.lifetimeLimit}`,
          tone: (tracking.rareCandies + 1 === advancementRule.rareCandy.lifetimeLimit
            ? 'warning' : 'neutral') as ItemPermanentAdvancementPreviewFact['tone'],
        },
      ]),
      choices: Object.freeze([]),
      selectionComplete: true,
    })
  }

  if (effect.operation !== 'modify-base-stat' || effect.amount !== -1 || effect.stat !== 'selected') {
    throw new Error('Permanent advancement effect is unsupported.')
  }
  const options = STAT_KEYS.flatMap((stat): ItemPermanentAdvancementChoiceOption[] => {
    try {
      const result = resolveStatOption({ sheet, stat, kind: 'suppress' })
      return [{
        optionId: stat,
        label: STAT_LABELS[stat],
        description: `${STAT_LABELS[stat]} Base Stat ${result.before} → ${result.after}`,
        previewFacts: Object.freeze([{
          label: `${STAT_LABELS[stat]} Base Stat`,
          value: `${result.before} → ${result.after}`,
          tone: 'warning' as const,
        }]),
      }]
    }
    catch { return [] }
  })
  if (options.length === 0) throw new Error('No Base Stat can be suppressed without making this Pokémon’s sheet invalid.')
  const statChoice: ItemPermanentAdvancementChoice = Object.freeze({
    choiceId: PERMANENT_ADVANCEMENT_STAT_CHOICE_ID,
    label: 'Choose a Base Stat',
    presentation: 'radio',
    minimum: 1,
    maximum: 1,
    options: Object.freeze(options),
  })
  const consentChoice: ItemPermanentAdvancementChoice = Object.freeze({
    choiceId: PERMANENT_ADVANCEMENT_CONSENT_CHOICE_ID,
    label: 'Trainer consent',
    presentation: 'confirmation',
    minimum: 1,
    maximum: 1,
    options: Object.freeze([{
      optionId: 'confirmed',
      label: 'The Pokémon’s Trainer consents',
      description: 'Required before this permanent Base Stat reduction can be accepted.',
      previewFacts: Object.freeze([{
        label: 'Trainer consent', value: 'Confirmed', tone: 'positive' as const,
      }]),
    }]),
  })
  const chosenStat = selected(selections, statChoice.choiceId)
  const chosenConsent = selected(selections, consentChoice.choiceId)
  const statOption = chosenStat.length === 1
    ? options.find(option => option.optionId === chosenStat[0]) ?? null
    : null
  const consentConfirmed = chosenConsent.length === 1 && chosenConsent[0] === 'confirmed'
  return Object.freeze({
    kind: 'stat-suppressant',
    description: 'Permanently lower one legal Base Stat by 1 with explicit Trainer consent.',
    previewFacts: Object.freeze([
      ...(statOption?.previewFacts ?? [{ label: 'Legal Base Stats', value: String(options.length), tone: 'neutral' as const }]),
      {
        label: 'Trainer consent',
        value: consentConfirmed ? 'Confirmed' : 'Required',
        tone: (consentConfirmed ? 'positive' : 'warning') as ItemPermanentAdvancementPreviewFact['tone'],
      },
    ]),
    choices: Object.freeze([statChoice, consentChoice]),
    selectionComplete: statOption !== null && consentConfirmed,
  })
}

export const resolvePermanentItemAdvancement = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sheetKind: SheetKind
  readonly sheet: unknown
  readonly selectedChoices: ReadonlyMap<string, readonly string[]>
  readonly operationId: string
  readonly appliedAt: number
}): ResolvedPermanentAdvancementApplication => {
  const preview = previewPermanentItemAdvancement(input)
  if (!preview.selectionComplete) throw new Error('Permanent advancement choices are incomplete.')
  const sheet = clone(input.sheet as CharacterSheet)
  const effect = permanentEffect(input.definition)
  const common = baseApplication({
    operationId: input.operationId,
    definition: input.definition,
    kind: preview.kind,
    appliedAt: input.appliedAt,
  })
  let changed: CharacterSheet
  let application: ItemPermanentAdvancementApplicationV1

  if (effect.operation === 'modify-base-stat' && effect.amount === 1 && effect.stat !== 'selected') {
    changed = resolveStatOption({ sheet, stat: effect.stat, kind: 'boost' }).sheet
    application = {
      ...common, stat: effect.stat, moveName: null, moveListIndex: null,
      previousFrequency: null, resultingFrequency: null, previousLevel: null, resultingLevel: null,
    }
  }
  else if (effect.operation === 'grant-tutor-points') {
    changed = clone(sheet)
    ensureTrackingObjects(changed)
    changed.vitamins!.heartBooster = true
    syncPokemonTutorPointsForSheet(changed)
    application = {
      ...common, stat: null, moveName: null, moveListIndex: null,
      previousFrequency: null, resultingFrequency: null, previousLevel: null, resultingLevel: null,
    }
  }
  else if (effect.operation === 'increase-move-frequency') {
    const optionId = selected(input.selectedChoices, PERMANENT_ADVANCEMENT_MOVE_CHOICE_ID)[0]
    const option = moveOptions(sheet).find(value => value.optionId === optionId)
      ?? (() => { throw new Error('The selected PP Up Move is no longer eligible.') })()
    changed = clone(sheet)
    ensureTrackingObjects(changed)
    changed.movelist = [...(changed.movelist ?? [])]
    changed.movelist[option.moveIndex] = {
      ...changed.movelist[option.moveIndex]!,
      frequency: option.resultingFrequency,
    }
    changed.vitamins!.ppUp = true
    changed.vitamins!.ppUpMove = option.moveName
    syncPokemonTutorPointsForSheet(changed)
    application = {
      ...common, stat: null, moveName: option.moveName, moveListIndex: option.moveIndex,
      previousFrequency: option.previousFrequency, resultingFrequency: option.resultingFrequency,
      previousLevel: null, resultingLevel: null,
    }
  }
  else if (effect.operation === 'gain-next-level-experience') {
    const previousLevel = sheet.level
    const resultingLevel = previousLevel + 1
    const resultingExperience = pokemonExperienceNeededForLevel(resultingLevel)
    if (!Number.isSafeInteger(resultingExperience)) throw new Error('Rare Candy next-Level Experience is unavailable.')
    changed = clone(sheet)
    ensureTrackingObjects(changed)
    changed.level = resultingLevel
    changed.totalExp = resultingExperience
    changed.vitamins!.rareCandies = trackingSnapshot(sheet).rareCandies + 1
    syncPokemonTutorPointsForSheet(changed)
    application = {
      ...common, stat: null, moveName: null, moveListIndex: null,
      previousFrequency: null, resultingFrequency: null, previousLevel, resultingLevel,
    }
  }
  else if (effect.operation === 'modify-base-stat' && effect.amount === -1 && effect.stat === 'selected') {
    if (selected(input.selectedChoices, PERMANENT_ADVANCEMENT_CONSENT_CHOICE_ID)[0] !== 'confirmed') {
      throw new Error('Stat Suppressant requires explicit Trainer consent.')
    }
    const stat = selected(input.selectedChoices, PERMANENT_ADVANCEMENT_STAT_CHOICE_ID)[0] as ItemPermanentBaseStat | undefined
    if (!stat || !STAT_KEYS.includes(stat)) throw new Error('Stat Suppressant requires one legal Base Stat choice.')
    changed = resolveStatOption({ sheet, stat, kind: 'suppress' }).sheet
    application = {
      ...common, stat: stat as ItemPermanentAdvancementStat, moveName: null, moveListIndex: null,
      previousFrequency: null, resultingFrequency: null, previousLevel: null, resultingLevel: null,
    }
  }
  else throw new Error('Permanent advancement effect is unsupported.')

  const finalSheet = finishApplication({ sheet: changed, application })
  const payload = Object.freeze({
    action: 'apply-permanent-advancement',
    advancementKind: application.kind,
    canonicalItemId: input.definition.canonicalId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    sourceOperationId: input.operationId,
    appliedAt: input.appliedAt,
    selectedChoices: Object.freeze([...input.selectedChoices]
      .filter(([choiceId]) => input.definition.spec.choices.some(choice => choice.choiceId === choiceId))
      .map(([choiceId, optionIds]) => Object.freeze({ choiceId, optionIds: Object.freeze([...optionIds]) }))
      .sort((left, right) => left.choiceId.localeCompare(right.choiceId))),
    application: Object.freeze({ ...application }),
    previewFacts: Object.freeze(preview.previewFacts.map(fact => Object.freeze({ ...fact }))),
  })
  return Object.freeze({ preview, sheet: finalSheet, payload })
}
