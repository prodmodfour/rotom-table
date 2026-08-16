import { createHash } from 'node:crypto'
import abilitiesJson from '~~/data/reference/abilities.json'
import movesJson from '~~/data/reference/moves.json'
import pokedexJson from '~~/data/reference/pokedex.json'
import rulesJson from '~~/data/reference/rules.json'
import type { ItemEffectSpec, ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import {
  appendItemMoveLearningApplication,
  parseItemMachineUsageState,
  parseItemMoveLearningState,
  recordItemMachineDailyUse,
  type ItemMachineDailyUseV1,
  type ItemMoveLearningApplicationV1,
} from '#shared/itemAutomation/moveLearning'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PokedexRecord } from '~/types/pokemon'
import type { PtuItemMoveLearningMechanicsV1, PtuMove } from '~/types/ptuReference'
import type {
  CharacterSheet,
  CharacterSheetAppliedMove,
  CharacterSheetMove,
} from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { SheetKind } from '#shared/sheets'
import {
  computePokemonTutorPointsEarnedForSheet,
  syncPokemonTutorPointsForSheet,
} from '~/utils/sheets/pokemonTutorPoints'

export const MACHINE_REPLACEMENT_CHOICE_ID = 'machine-replacement'
export const MACHINE_CONFIRMATION_CHOICE_ID = 'machine-confirmation'

export interface ItemMoveLearningPreviewFact {
  readonly label: string
  readonly value: string
  readonly tone: 'neutral' | 'positive' | 'warning'
}

export interface ItemMoveLearningChoiceOption {
  readonly optionId: string
  readonly label: string
  readonly description: string | null
  readonly previewFacts: readonly ItemMoveLearningPreviewFact[]
}

export interface ItemMoveLearningChoice {
  readonly choiceId: string
  readonly label: string
  readonly presentation: 'radio' | 'confirmation'
  readonly minimum: number
  readonly maximum: number
  readonly options: readonly ItemMoveLearningChoiceOption[]
}

export interface ItemMoveLearningPreview {
  readonly description: string
  readonly previewFacts: readonly ItemMoveLearningPreviewFact[]
  readonly choices: readonly ItemMoveLearningChoice[]
  readonly selectionComplete: boolean
}

export interface ResolvedMachineMoveLearning {
  readonly preview: ItemMoveLearningPreview
  readonly sheet: CharacterSheet
  readonly targetPayload: Readonly<Record<string, unknown>>
  readonly dailyUse: ItemMachineDailyUseV1 | null
}

type MachineMoveEffect = Extract<ItemEffectSpec, { readonly operation: 'learn-machine-move' }>
type AppliedSourceKind = 'natural' | 'tm' | 'tutor' | 'unknown'

interface CurrentMoveRow {
  readonly index: number
  readonly row: CharacterSheetMove
  readonly canonical: PtuMove
  readonly sourceKind: AppliedSourceKind
  readonly countsTowardMachineTutorLimit: boolean
}

interface CurrentMoveAuthority {
  readonly species: PokedexRecord
  readonly speciesRecordSha256: string
  readonly move: PtuMove
  readonly moveRecordSha256: string
  readonly moveRows: readonly CurrentMoveRow[]
  readonly appliedRows: readonly CharacterSheetAppliedMove[]
  readonly activeMaximum: number
  readonly machineTutorCount: number
  readonly tutorPointsEarned: number
  readonly tutorPointsSpent: number
}

interface InternalReplacementOption extends ItemMoveLearningChoiceOption {
  readonly replacementKind: 'add' | 'replace'
  readonly replacedMoveId: string | null
  readonly moveListIndex: number
  readonly replacedSourceKind: AppliedSourceKind | null
  readonly tutorPointCost: 0 | 1
  readonly resultingMoveCount: number
  readonly resultingMachineTutorCount: number
}

const canonicalMoves = movesJson as unknown as Record<string, PtuMove>
const canonicalPokedex = pokedexJson as unknown as readonly PokedexRecord[]
const canonicalAbilities = abilitiesJson as unknown as Record<string, { readonly name?: unknown, readonly frequency?: unknown, readonly effect?: unknown }>
const rule = (rulesJson as unknown as Record<string, {
  readonly itemMoveLearningMechanics?: PtuItemMoveLearningMechanicsV1
}>)['TMs and HMs']?.itemMoveLearningMechanics

if (!rule || rule.schemaVersion !== 1 || rule.actorKind !== 'trainer'
  || rule.targetKind !== 'owned-pokemon' || rule.learningMinutes !== 60
  || rule.activeMoveMaximum !== 6 || rule.clusterMindAdditionalSlots !== 2
  || rule.machineTutorMoveMaximum !== 3 || rule.tutorPointCost !== 1
  || rule.replacementOfCountedMachineTutorMoveCost !== 0
  || rule.tm.reusable !== false || rule.tm.consumptionQuantity !== 1
  || rule.tm.consumptionPhase !== 'extended-action-completion'
  || rule.hm.reusable !== true || rule.hm.usesPerCampaignDay !== 1
  || rule.hm.consumptionQuantity !== 0
  || rule.naturalization !== 'current-level-up-opportunity-does-not-count'
  || canonicalAbilities['Cluster Mind']?.name !== 'Cluster Mind'
  || canonicalAbilities['Cluster Mind']?.frequency !== 'Static'
  || canonicalAbilities['Cluster Mind']?.effect !== 'The user’s Move Pool limit is increased by +2.') {
  throw new Error('Canonical machine Move-learning rule authority is unavailable or stale.')
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const clone = <T>(value: T): T => structuredClone(value)
const lower = (value: string): string => value.trim().toLocaleLowerCase('en-US')
const boundedCount = (value: unknown, label: string): number => {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 256) {
    throw new Error(`${label} must be a bounded non-negative integer.`)
  }
  return Number(value)
}

const machineEffect = (definition: ItemRuntimeDefinition): MachineMoveEffect => {
  const effects = definition.spec.effects.filter((effect): effect is MachineMoveEffect => effect.operation === 'learn-machine-move')
  if (effects.length !== 1 || definition.spec.effects.length !== 1) {
    throw new Error('Machine Move learning requires one reviewed effect.')
  }
  return effects[0]!
}

const uniqueSpecies = (speciesId: string): PokedexRecord => {
  const rows = canonicalPokedex.filter(record => record.species === speciesId)
  if (rows.length !== 1) throw new Error('The Pokémon species does not resolve one exact canonical compatibility record.')
  return rows[0]!
}

const canonicalMove = (moveId: string): PtuMove => {
  const move = canonicalMoves[moveId]
  if (!move || move.name !== moveId) throw new Error(`Canonical Move ${moveId} is unavailable.`)
  return move
}

const isNaturalMove = (sheet: CharacterSheet, species: PokedexRecord, moveId: string): boolean => {
  const level = Number.isSafeInteger(sheet.level) ? sheet.level : 0
  return (species.level_up_moves ?? []).some(move => move.name === moveId
    && Number.isSafeInteger(move.level) && move.level <= level)
    || (species.tutor_moves ?? []).some(move => move.name === moveId && move.heart_scale === true)
}

const canonicalSheetMove = (move: PtuMove): CharacterSheetMove => {
  const category = move.damage_class === 'Physical' || move.damage_class === 'Special' || move.damage_class === 'Status'
    ? move.damage_class
    : undefined
  return {
    name: move.name,
    type: move.type,
    ...(category ? { category } : {}),
    ...(move.damage_base == null ? {} : { db: move.damage_base }),
    ...(move.damage_roll == null ? {} : { damageRoll: move.damage_roll }),
    ...(move.frequency === undefined ? {} : { frequency: move.frequency }),
    ...(move.ac == null ? {} : { ac: move.ac }),
    ...(move.range === undefined ? {} : { range: move.range }),
    ...(move.effect === undefined ? {} : { effect: move.effect }),
    ...(move.special === undefined ? {} : { special: move.special }),
    itemMoveLearningLocked: true,
  }
}

const canonicalAppliedMove = (move: PtuMove): CharacterSheetAppliedMove => ({
  ...canonicalSheetMove(move),
  source: 'tm',
})

const assertImmutableStateMatchesRows = (
  sheet: CharacterSheet,
  moveRows: readonly CharacterSheetMove[],
  appliedRows: readonly CharacterSheetAppliedMove[],
): void => {
  const state = parseItemMoveLearningState(sheet.serverPrivate?.itemMoveLearning)
  const activeApplications = new Map<string, ItemMoveLearningApplicationV1>()
  for (const application of state.applications) {
    const sourceMove = canonicalMoves[application.moveId]
    const sourceSpecies = canonicalPokedex.filter(row => row.species === application.speciesId)
    if (!sourceMove || sourceMove.name !== application.moveId
      || sha256(stableJsonStringify(sourceMove)) !== application.moveRecordSha256
      || sourceSpecies.length !== 1
      || sha256(stableJsonStringify(sourceSpecies[0])) !== application.speciesRecordSha256) {
      throw new Error('Item-controlled Move rows no longer match immutable accepted Move-learning provenance.')
    }
    if (application.replacementKind === 'replace' && application.replacedMoveId !== null) {
      activeApplications.delete(application.replacedMoveId)
    }
    if (activeApplications.has(application.moveId)) {
      throw new Error('Item-controlled Move rows no longer match immutable accepted Move-learning provenance.')
    }
    activeApplications.set(application.moveId, application)
  }
  const lockedMoves = moveRows.filter(row => row.itemMoveLearningLocked === true)
  const lockedApplied = appliedRows.filter(row => row.itemMoveLearningLocked === true)
  const exactNames = (rows: readonly { readonly name: string }[]): Set<string> => new Set(rows.map(row => row.name))
  const moveNames = exactNames(lockedMoves)
  const appliedNames = exactNames(lockedApplied)
  const canonicalRowsMatch = [...activeApplications].every(([name]) => {
    const move = canonicalMoves[name]
    const active = lockedMoves.find(row => row.name === name)
    const applied = lockedApplied.find(row => row.name === name)
    return Boolean(move && active && applied
      && stableJsonStringify(active) === stableJsonStringify(canonicalSheetMove(move))
      && stableJsonStringify(applied) === stableJsonStringify(canonicalAppliedMove(move)))
  })
  if (moveNames.size !== lockedMoves.length || appliedNames.size !== lockedApplied.length
    || moveNames.size !== activeApplications.size || appliedNames.size !== activeApplications.size
    || [...activeApplications.keys()].some(name => !moveNames.has(name) || !appliedNames.has(name))
    || !canonicalRowsMatch) {
    throw new Error('Item-controlled Move rows no longer match immutable accepted Move-learning provenance.')
  }
}

export const assertCurrentItemMoveLearningAuthority = (sheet: CharacterSheet): void => {
  const moveRows = sheet.movelist ?? []
  const appliedRows = sheet.appliedMoves ?? []
  if (!Array.isArray(moveRows) || !Array.isArray(appliedRows)) {
    throw new Error('Machine Move learning requires valid Pokémon Move arrays.')
  }
  assertImmutableStateMatchesRows(sheet, moveRows, appliedRows)
}

const currentAuthority = (input: {
  readonly effect: MachineMoveEffect
  readonly sheet: CharacterSheet
  readonly allowEffectMoveAlreadyLearned?: boolean
}): CurrentMoveAuthority => {
  const sheet = input.sheet
  if (!Number.isSafeInteger(sheet.level) || sheet.level < 1 || sheet.level > 100) {
    throw new Error('Machine Move learning requires a valid Pokémon Level.')
  }
  const species = uniqueSpecies(sheet.species)
  const compatibility = (species.tm_hm_moves ?? []).filter(entry => (
    entry.kind === input.effect.machineKind
    && entry.number === input.effect.machineNumber
    && entry.name === input.effect.moveId
  ))
  if (compatibility.length !== 1) {
    throw new Error(`${species.species} is not canonically compatible with this ${input.effect.machineKind}.`)
  }
  const move = canonicalMove(input.effect.moveId)
  const moveRows = sheet.movelist ?? []
  const appliedRows = sheet.appliedMoves ?? []
  if (!Array.isArray(moveRows) || !Array.isArray(appliedRows)) {
    throw new Error('Machine Move learning requires valid Pokémon Move arrays.')
  }
  const clusterMind = (sheet.abilities ?? []).some(ability => ability?.name === 'Cluster Mind')
  const activeMaximum = input.effect.activeMoveMaximum + (clusterMind ? rule.clusterMindAdditionalSlots : 0)
  if (moveRows.length > activeMaximum) {
    throw new Error(`This Pokémon exceeds its ${activeMaximum}-Move active limit.`)
  }
  const activeNames = moveRows.map(row => row?.name)
  if (activeNames.some(name => typeof name !== 'string' || !name.trim())
    || new Set(activeNames.map(name => lower(String(name)))).size !== activeNames.length) {
    throw new Error('The Pokémon active Move list is malformed or duplicated.')
  }
  if (appliedRows.some(row => !row || typeof row.name !== 'string' || !row.name.trim()
    || (row.source !== 'tm' && row.source !== 'tutor'))
    || new Set(appliedRows.map(row => lower(row.name))).size !== appliedRows.length) {
    throw new Error('The Pokémon applied TM/Tutor Move records are malformed or duplicated.')
  }
  for (const row of [...moveRows, ...appliedRows]) canonicalMove(row.name)
  assertImmutableStateMatchesRows(sheet, moveRows, appliedRows)
  if (input.allowEffectMoveAlreadyLearned !== true && (moveRows.some(row => row.name === move.name)
    || appliedRows.some(row => row.name === move.name)
    || isNaturalMove(sheet, species, move.name))) {
    throw new Error(`This Pokémon already knows or can currently select ${move.name} as a Natural Move.`)
  }
  const appliedByName = new Map(appliedRows.map(row => [row.name, row]))
  const currentRows: CurrentMoveRow[] = moveRows.map((row, index) => {
    const canonical = canonicalMove(row.name)
    const applied = appliedByName.get(canonical.name)
    const natural = isNaturalMove(sheet, species, canonical.name)
    const sourceKind: AppliedSourceKind = natural ? 'natural' : applied?.source ?? 'unknown'
    return {
      index,
      row,
      canonical,
      sourceKind,
      countsTowardMachineTutorLimit: !natural,
    }
  })
  const machineTutorNames = new Set<string>([
    ...currentRows.filter(row => row.countsTowardMachineTutorLimit).map(row => row.canonical.name),
    ...appliedRows.filter(row => !isNaturalMove(sheet, species, row.name)).map(row => row.name),
  ])
  const machineTutorCount = machineTutorNames.size
  if (machineTutorCount > input.effect.machineTutorMoveMaximum) {
    throw new Error(`This Pokémon exceeds the ${input.effect.machineTutorMoveMaximum}-Move TM/Tutor limit.`)
  }
  const tutorPointsEarned = computePokemonTutorPointsEarnedForSheet(sheet)
  const tutorPointsSpent = boundedCount(sheet.tutorPoints?.spent, 'tutorPoints.spent')
  if (tutorPointsSpent > tutorPointsEarned) {
    throw new Error('The Pokémon has more spent Tutor Points than it has earned.')
  }
  parseItemMoveLearningState(sheet.serverPrivate?.itemMoveLearning)
  return {
    species,
    speciesRecordSha256: sha256(stableJsonStringify(species)),
    move,
    moveRecordSha256: sha256(stableJsonStringify(move)),
    moveRows: currentRows,
    appliedRows,
    activeMaximum,
    machineTutorCount,
    tutorPointsEarned,
    tutorPointsSpent,
  }
}

const assertHmAvailable = (input: {
  readonly effect: MachineMoveEffect
  readonly actorKind: SheetKind
  readonly actorSheet: TrainerSheet
  readonly sourceInstanceId: string
  readonly campaignMinute: number
}): void => {
  if (input.effect.machineKind !== 'HM') return
  if (input.actorKind !== 'trainer') throw new Error('HM use requires a Trainer actor.')
  const currentDay = Math.floor(input.campaignMinute / 1_440)
  const usage = parseItemMachineUsageState(input.actorSheet.serverPrivate?.itemMachineUsage)
    .latestUses.find(value => value.sourceInstanceId === input.sourceInstanceId)
  if (usage?.campaignDayIndex === currentDay) {
    throw new Error('This HM source was already used during the current campaign day.')
  }
  if (usage && usage.campaignDayIndex > currentDay) {
    throw new Error('HM usage authority is ahead of the current campaign day.')
  }
}

const optionId = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sheet: CharacterSheet
  readonly authority: CurrentMoveAuthority
  readonly replacementKind: 'add' | 'replace'
  readonly moveListIndex: number
  readonly replacedMoveId: string | null
  readonly replacedSourceKind: AppliedSourceKind | null
  readonly tutorPointCost: 0 | 1
}): string => `machine-choice:v1:${sha256(stableJsonStringify({
  canonicalItemId: input.definition.canonicalId,
  canonicalDefinitionSha256: input.definition.definitionSha256,
  sheetSlug: input.sheet.slug,
  sheetRevision: input.sheet.revision ?? 0,
  speciesId: input.authority.species.species,
  moveId: input.authority.move.name,
  replacementKind: input.replacementKind,
  moveListIndex: input.moveListIndex,
  replacedMoveId: input.replacedMoveId,
  replacedSourceKind: input.replacedSourceKind,
  tutorPointCost: input.tutorPointCost,
  tutorPointsSpent: input.authority.tutorPointsSpent,
  moveCount: input.authority.moveRows.length,
  machineTutorCount: input.authority.machineTutorCount,
})).slice(0, 32)}`

const replacementOptions = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sheet: CharacterSheet
  readonly authority: CurrentMoveAuthority
}): readonly InternalReplacementOption[] => {
  const { authority } = input
  const options: InternalReplacementOption[] = []
  const hasTutorPoint = authority.tutorPointsSpent < authority.tutorPointsEarned
  if (authority.moveRows.length < authority.activeMaximum
    && authority.machineTutorCount < rule.machineTutorMoveMaximum && hasTutorPoint) {
    const tutorPointCost = 1 as const
    options.push({
      optionId: optionId({
        ...input, replacementKind: 'add', moveListIndex: authority.moveRows.length,
        replacedMoveId: null, replacedSourceKind: null, tutorPointCost,
      }),
      replacementKind: 'add',
      replacedMoveId: null,
      moveListIndex: authority.moveRows.length,
      replacedSourceKind: null,
      tutorPointCost,
      resultingMoveCount: authority.moveRows.length + 1,
      resultingMachineTutorCount: authority.machineTutorCount + 1,
      label: 'Keep current Moves',
      description: `Add ${authority.move.name} in an open slot · spend 1 Tutor Point`,
      previewFacts: Object.freeze([
        { label: 'Active Move', value: `Open slot → ${authority.move.name}`, tone: 'positive' as const },
        { label: 'Tutor Points', value: `${authority.tutorPointsEarned - authority.tutorPointsSpent} → ${authority.tutorPointsEarned - authority.tutorPointsSpent - 1} available`, tone: 'warning' as const },
      ]),
    })
  }
  for (const row of authority.moveRows) {
    const tutorPointCost = row.countsTowardMachineTutorLimit ? 0 as const : 1 as const
    const resultingMachineTutorCount = authority.machineTutorCount
      - (row.countsTowardMachineTutorLimit ? 1 : 0) + 1
    if (resultingMachineTutorCount > rule.machineTutorMoveMaximum
      || (tutorPointCost === 1 && !hasTutorPoint)) continue
    const sourceLabel = row.countsTowardMachineTutorLimit
      ? `${row.sourceKind === 'tm' ? 'TM/HM' : row.sourceKind === 'tutor' ? 'Tutor' : 'TM/Tutor'} slot`
      : 'Natural Move'
    options.push({
      optionId: optionId({
        ...input, replacementKind: 'replace', moveListIndex: row.index,
        replacedMoveId: row.canonical.name, replacedSourceKind: row.sourceKind, tutorPointCost,
      }),
      replacementKind: 'replace',
      replacedMoveId: row.canonical.name,
      moveListIndex: row.index,
      replacedSourceKind: row.sourceKind,
      tutorPointCost,
      resultingMoveCount: authority.moveRows.length,
      resultingMachineTutorCount,
      label: row.canonical.name,
      description: `${sourceLabel} · ${tutorPointCost === 0 ? '0 additional Tutor Points' : 'spend 1 Tutor Point'}`,
      previewFacts: Object.freeze([
        { label: 'Active Move', value: `${row.canonical.name} → ${authority.move.name}`, tone: 'positive' as const },
        {
          label: 'Tutor Points',
          value: tutorPointCost === 0
            ? `${authority.tutorPointsEarned - authority.tutorPointsSpent} available · no additional point`
            : `${authority.tutorPointsEarned - authority.tutorPointsSpent} → ${authority.tutorPointsEarned - authority.tutorPointsSpent - 1} available`,
          tone: (tutorPointCost === 0 ? 'neutral' : 'warning') as ItemMoveLearningPreviewFact['tone'],
        },
      ]),
    })
  }
  return Object.freeze(options)
}

const selected = (
  selections: ReadonlyMap<string, readonly string[]>,
  choiceId: string,
): readonly string[] => selections.get(choiceId) ?? []

const previewWithAuthority = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sheet: CharacterSheet
  readonly actorKind: SheetKind
  readonly actorSheet: TrainerSheet
  readonly sourceInstanceId: string
  readonly campaignMinute: number
  readonly selectedChoices?: ReadonlyMap<string, readonly string[]>
}): { readonly preview: ItemMoveLearningPreview, readonly authority: CurrentMoveAuthority, readonly options: readonly InternalReplacementOption[] } => {
  if (!Number.isSafeInteger(input.campaignMinute) || input.campaignMinute < 0) {
    throw new Error('Machine Move learning requires an authoritative campaign minute.')
  }
  if (!input.sourceInstanceId.trim()) throw new Error('Machine Move learning requires exact source identity.')
  const effect = machineEffect(input.definition)
  const authority = currentAuthority({ effect, sheet: input.sheet })
  assertHmAvailable({ ...input, effect })
  const options = replacementOptions({ definition: input.definition, sheet: input.sheet, authority })
  if (options.length === 0) {
    throw new Error('No legal Move change satisfies the active-Move, TM/Tutor, and available Tutor Point limits.')
  }
  const selections = input.selectedChoices ?? new Map<string, readonly string[]>()
  const replacementSelection = selected(selections, MACHINE_REPLACEMENT_CHOICE_ID)
  const confirmationSelection = selected(selections, MACHINE_CONFIRMATION_CHOICE_ID)
  const replacement = replacementSelection.length === 1
    ? options.find(option => option.optionId === replacementSelection[0]) ?? null
    : null
  const confirmed = confirmationSelection.length === 1 && confirmationSelection[0] === 'confirmed'
  const moveCountResult = replacement?.resultingMoveCount ?? authority.moveRows.length
  const machineCountResult = replacement?.resultingMachineTutorCount ?? authority.machineTutorCount
  const choice: ItemMoveLearningChoice = Object.freeze({
    choiceId: MACHINE_REPLACEMENT_CHOICE_ID,
    label: options.some(option => option.replacementKind === 'add')
      ? 'Choose how to add the Move'
      : 'Choose a Move to replace',
    presentation: 'radio',
    minimum: 1,
    maximum: 1,
    options,
  })
  const confirmation: ItemMoveLearningChoice = Object.freeze({
    choiceId: MACHINE_CONFIRMATION_CHOICE_ID,
    label: 'Confirm Move training',
    presentation: 'confirmation',
    minimum: 1,
    maximum: 1,
    options: Object.freeze([{
      optionId: 'confirmed',
      label: replacement?.replacementKind === 'replace'
        ? `Teach ${authority.move.name} and replace ${replacement.replacedMoveId}.`
        : `Teach ${authority.move.name} in an open Move slot.`,
      description: 'The selected target, Move change, Tutor Point consequence, and source are revalidated at completion.',
      previewFacts: Object.freeze([{ label: 'Confirmation', value: 'Accepted for this exact choice', tone: 'positive' as const }]),
    }]),
  })
  const previewFacts: ItemMoveLearningPreviewFact[] = [
    ...(replacement?.previewFacts ?? [{ label: 'Move to learn', value: authority.move.name, tone: 'positive' as const }]),
    {
      label: 'Active Move limit',
      value: `${authority.moveRows.length} / ${authority.activeMaximum} → ${moveCountResult} / ${authority.activeMaximum}`,
      tone: moveCountResult === authority.activeMaximum ? 'warning' : 'neutral',
    },
    {
      label: 'TM/Tutor limit',
      value: `${authority.machineTutorCount} / ${rule.machineTutorMoveMaximum} → ${machineCountResult} / ${rule.machineTutorMoveMaximum}`,
      tone: machineCountResult === rule.machineTutorMoveMaximum ? 'warning' : 'neutral',
    },
    { label: 'Training time', value: 'About 1 hour · Extended Action', tone: 'neutral' },
    {
      label: input.definition.spec.consumption.reusable ? 'HM source' : 'Inventory',
      value: input.definition.spec.consumption.reusable
        ? 'Reusable · once per campaign day'
        : 'Consume 1 TM at completion',
      tone: input.definition.spec.consumption.reusable ? 'neutral' : 'warning',
    },
  ]
  return Object.freeze({
    authority,
    options,
    preview: Object.freeze({
      description: `Teach ${authority.move.name} after validating species compatibility, Move limits, and Tutor Points.`,
      previewFacts: Object.freeze(previewFacts),
      choices: Object.freeze([choice, confirmation]),
      selectionComplete: replacement !== null && confirmed,
    }),
  })
}

export const previewMachineMoveLearning = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sheetKind: SheetKind
  readonly sheet: unknown
  readonly actorKind: SheetKind
  readonly actorSheet: unknown
  readonly sourceInstanceId: string
  readonly campaignMinute: number
  readonly selectedChoices?: ReadonlyMap<string, readonly string[]>
}): ItemMoveLearningPreview => {
  if (input.sheetKind !== 'pokemon' || input.actorKind !== 'trainer') {
    throw new Error('Machine Move learning requires a Trainer and one owned Pokémon target.')
  }
  return previewWithAuthority({
    ...input,
    sheet: input.sheet as CharacterSheet,
    actorSheet: input.actorSheet as TrainerSheet,
  }).preview
}

const applyOption = (input: {
  readonly sheet: CharacterSheet
  readonly authority: CurrentMoveAuthority
  readonly option: InternalReplacementOption
  readonly application: ItemMoveLearningApplicationV1
}): CharacterSheet => {
  const next = clone(input.sheet)
  next.movelist = [...(next.movelist ?? [])]
  next.appliedMoves = [...(next.appliedMoves ?? [])]
  if (input.option.replacementKind === 'replace') {
    const current = next.movelist[input.option.moveListIndex]
    if (!current || current.name !== input.option.replacedMoveId) {
      throw new Error('The selected replacement Move changed before settlement.')
    }
    next.movelist[input.option.moveListIndex] = canonicalSheetMove(input.authority.move)
    const appliedIndexes = next.appliedMoves.flatMap((row, index) => row.name === input.option.replacedMoveId ? [index] : [])
    if (appliedIndexes.length > 1) throw new Error('The selected replacement has ambiguous applied-Move records.')
    if (appliedIndexes.length === 1) next.appliedMoves.splice(appliedIndexes[0]!, 1)
  }
  else next.movelist.push(canonicalSheetMove(input.authority.move))
  if (next.appliedMoves.some(row => row.name === input.authority.move.name)) {
    throw new Error('The learned Move already has an applied-Move record.')
  }
  next.appliedMoves.push(canonicalAppliedMove(input.authority.move))
  next.tutorPoints = {
    ...(next.tutorPoints ?? {}),
    spent: input.application.resultingTutorPointsSpent,
  }
  syncPokemonTutorPointsForSheet(next)
  next.serverPrivate = { ...(next.serverPrivate ?? {}) }
  next.serverPrivate.itemMoveLearning = appendItemMoveLearningApplication({
    current: next.serverPrivate.itemMoveLearning,
    application: input.application,
  })
  const result = currentAuthority({
    effect: machineEffectForValidation(input.application),
    sheet: next,
    allowEffectMoveAlreadyLearned: true,
  })
  if (result.moveRows.length !== input.application.resultingMoveCount
    || result.machineTutorCount !== input.application.resultingMachineTutorCount
    || result.tutorPointsSpent !== input.application.resultingTutorPointsSpent) {
    throw new Error('The resulting machine Move-learning sheet does not match its deterministic preview.')
  }
  return next
}

/** Minimal effect adapter used only to revalidate the resulting sheet against the accepted application. */
const machineEffectForValidation = (application: ItemMoveLearningApplicationV1): MachineMoveEffect => ({
  effectId: 'move-learning-validation',
  operation: 'learn-machine-move',
  machineKind: application.machineKind,
  machineNumber: application.machineNumber,
  moveId: application.moveId,
  tutorPointCost: 1,
  learningMinutes: 60,
  activeMoveMaximum: 6,
  machineTutorMoveMaximum: 3,
  dailyUseLimit: application.machineKind === 'HM' ? 1 : null,
})

export const resolveMachineMoveLearning = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly sheetKind: SheetKind
  readonly sheet: unknown
  readonly actorKind: SheetKind
  readonly actorSheet: unknown
  readonly sourceInstanceId: string
  readonly campaignMinute: number
  readonly selectedChoices: ReadonlyMap<string, readonly string[]>
  readonly operationId: string
  readonly appliedAt: number
}): ResolvedMachineMoveLearning => {
  if (input.sheetKind !== 'pokemon' || input.actorKind !== 'trainer') {
    throw new Error('Machine Move learning requires a Trainer and one owned Pokémon target.')
  }
  if (!Number.isSafeInteger(input.appliedAt) || input.appliedAt < 0) {
    throw new Error('Machine Move learning requires a server-owned application timestamp.')
  }
  const sheet = input.sheet as CharacterSheet
  const actorSheet = input.actorSheet as TrainerSheet
  const resolved = previewWithAuthority({ ...input, sheet, actorSheet })
  if (!resolved.preview.selectionComplete) throw new Error('Machine Move-learning choices are incomplete.')
  const optionIdentity = selected(input.selectedChoices, MACHINE_REPLACEMENT_CHOICE_ID)[0]
  const option = resolved.options.find(value => value.optionId === optionIdentity)
    ?? (() => { throw new Error('The selected Move replacement is no longer legal.') })()
  if (selected(input.selectedChoices, MACHINE_CONFIRMATION_CHOICE_ID)[0] !== 'confirmed') {
    throw new Error('Machine Move learning requires explicit confirmation.')
  }
  const effect = machineEffect(input.definition)
  const application: ItemMoveLearningApplicationV1 = {
    sourceOperationId: input.operationId,
    sourceInstanceId: input.sourceInstanceId,
    canonicalItemId: input.definition.canonicalId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    machineKind: effect.machineKind,
    machineNumber: effect.machineNumber,
    moveId: effect.moveId,
    replacementKind: option.replacementKind,
    replacedMoveId: option.replacedMoveId,
    moveListIndex: option.moveListIndex,
    tutorPointCost: option.tutorPointCost,
    previousTutorPointsSpent: resolved.authority.tutorPointsSpent,
    resultingTutorPointsSpent: resolved.authority.tutorPointsSpent + option.tutorPointCost,
    previousMoveCount: resolved.authority.moveRows.length,
    resultingMoveCount: option.resultingMoveCount,
    previousMachineTutorCount: resolved.authority.machineTutorCount,
    resultingMachineTutorCount: option.resultingMachineTutorCount,
    speciesId: resolved.authority.species.species,
    speciesRecordSha256: resolved.authority.speciesRecordSha256,
    moveRecordSha256: resolved.authority.moveRecordSha256,
    campaignMinute: input.campaignMinute,
    appliedAt: input.appliedAt,
  }
  const dailyUse: ItemMachineDailyUseV1 | null = effect.machineKind === 'HM' ? {
    sourceInstanceId: input.sourceInstanceId,
    sourceOperationId: input.operationId,
    canonicalItemId: input.definition.canonicalId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    campaignDayIndex: Math.floor(input.campaignMinute / 1_440),
    campaignMinute: input.campaignMinute,
  } : null
  const resultingSheet = applyOption({ sheet, authority: resolved.authority, option, application })
  const selectedChoices = Object.freeze([...input.selectedChoices]
    .filter(([choiceId]) => input.definition.spec.choices.some(choice => choice.choiceId === choiceId))
    .map(([choiceId, optionIds]) => Object.freeze({ choiceId, optionIds: Object.freeze([...optionIds]) }))
    .sort((left, right) => left.choiceId.localeCompare(right.choiceId)))
  const targetPayload = Object.freeze({
    action: 'learn-machine-move',
    canonicalItemId: input.definition.canonicalId,
    canonicalDefinitionSha256: input.definition.definitionSha256,
    sourceOperationId: input.operationId,
    sourceInstanceId: input.sourceInstanceId,
    appliedAt: input.appliedAt,
    campaignMinute: input.campaignMinute,
    selectedChoices,
    application: Object.freeze({ ...application }),
    dailyUse: dailyUse ? Object.freeze({ ...dailyUse }) : null,
    previewFacts: Object.freeze(resolved.preview.previewFacts.map(fact => Object.freeze({ ...fact }))),
  })
  return Object.freeze({ preview: resolved.preview, sheet: resultingSheet, targetPayload, dailyUse })
}

export const applyItemMachineDailyUsage = (input: {
  readonly sheet: TrainerSheet
  readonly use: ItemMachineDailyUseV1
}): TrainerSheet => {
  const next = clone(input.sheet)
  next.serverPrivate = { ...(next.serverPrivate ?? {}) }
  next.serverPrivate.itemMachineUsage = recordItemMachineDailyUse({
    current: next.serverPrivate.itemMachineUsage,
    use: input.use,
  })
  return next
}
