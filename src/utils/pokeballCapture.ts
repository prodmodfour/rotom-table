import pokedexData from '~~/data/reference/pokedex.json'
import { findItem, toSlug } from '~~/data/ptuReference'
import { moveAutomationTargetsInRange } from '~/utils/moveAutomationRange'
import {
  moveAutomationHitChanceTone,
  moveAutomationTargetHitChance,
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import {
  randomD20,
  resolveMoveAutomationAccuracyRoll,
} from '~/utils/moveAutomationResolution'
import { resolveTrainerCapabilities } from '~/utils/sheets/trainerDerived'
import {
  conditionBaseName,
  conditionByName,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MoveAutomationScript, MoveAutomationTargetHitChance } from '~/types/moveAutomation'
import type { PokedexRecord, SpawnedPokemon } from '~/types/pokemon'
import type { InventoryEntry, TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import type { PtuItem } from '~/types/ptuReference'

export const POKEBALL_THROW_AC = 6
export const POKEBALL_THROW_MOVE_NAME = 'Throw Poké Ball'
export const POKEBALL_THROW_SCRIPT_VERSION = 1
export const CAPTURE_RATE_NATURAL_TWENTY_BONUS = -10
export const TRAINER_TEAM_LIMIT_FOR_CAPTURE = 6

const pokedexBySpecies = new Map<string, PokedexRecord>(
  (pokedexData as PokedexRecord[]).map((entry) => [entry.species, entry]),
)

export interface TokenPokeballOption {
  name: string
  quantity: number
  rollModifier: number
  modifierLabel: string
  description: string
  item: PtuItem | null
}

export interface PokeballCaptureBreakdownLine {
  label: string
  value: number
  detail?: string
}

export interface PokeballCaptureBreakdown {
  captureRate: number
  captureRateLines: PokeballCaptureBreakdownLine[]
  rollModifier: number
  rollModifierLines: PokeballCaptureBreakdownLine[]
  hitChance: MoveAutomationTargetHitChance
  captureChance: number
  captureChanceLabel: string
  naturalTwentyCaptureChance: number
  naturalTwentyCaptureChanceLabel: string
  combinedChance: number
  combinedChanceLabel: string
  capturable: boolean
  uncatchableReason: string | null
  notes: string[]
}

export interface PokeballCaptureAttemptResult {
  id: string
  trainerId: string
  trainerName: string
  targetId: string
  targetName: string
  targetSpecies: string
  targetSpriteUrl: string | null
  pokeballName: string
  success: boolean
  hit: boolean
  shakeCount: number
  accuracyRoll: number
  modifiedAccuracyRoll: number
  accuracyCheck: number | null
  userAccuracy: number
  targetEvasion: number
  targetEvasionLabel: string
  captureRoll: number | null
  adjustedCaptureRoll: number | null
  captureRate: number
  naturalTwentyCaptureBonus: number
  naturalCaptureSuccess: boolean
  failureReason: string | null
  breakdown: PokeballCaptureBreakdown
}

export interface PokeballCaptureOutcomeApplyResult {
  consumed: boolean
  roster: 'team' | 'box' | 'already' | null
}

export interface PokeballCaptureOutcomeEvent {
  trainerId: string
  targetId: string
  targetSlug: string
  pokeballName: string
  result: PokeballCaptureAttemptResult
}

export interface PokeballCaptureLogEntry {
  at: number
  userId: string
  userName: string
  actionName: string
  pokeballName: string
  targetId: string
  targetName: string
  success: boolean
  hit: boolean
  lines: string[]
}

export const DEFAULT_POKEBALL_CAPTURE_LOG_ENTRIES = 100

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value))

const shakeLabel = (count: number): string => `${count} shake${count === 1 ? '' : 's'}`

const captureAccuracyLogLine = (result: PokeballCaptureAttemptResult): string => {
  const check = result.accuracyCheck ?? POKEBALL_THROW_AC
  const modified = result.modifiedAccuracyRoll === result.accuracyRoll
    ? ''
    : ` → ${result.modifiedAccuracyRoll}`
  return `Accuracy: d20 ${result.accuracyRoll}${modified} vs AC ${check} (${result.hit ? 'hit' : 'miss'}).`
}

const captureRollLogLine = (result: PokeballCaptureAttemptResult): string | null => {
  if (result.captureRoll === null || result.adjustedCaptureRoll === null) return null
  const modifiers = [
    result.breakdown.rollModifier ? `${signed(result.breakdown.rollModifier)} modifier` : null,
    result.naturalTwentyCaptureBonus ? `${signed(result.naturalTwentyCaptureBonus)} natural 20 bonus` : null,
  ].filter((line): line is string => Boolean(line))
  const modifierText = modifiers.length ? ` ${modifiers.join(' ')}` : ''
  return `Capture: d100 ${result.captureRoll}${modifierText} = ${result.adjustedCaptureRoll} vs rate ${result.captureRate}.`
}

const captureResultLogLine = (result: PokeballCaptureAttemptResult): string => {
  if (result.success) return `Result: ${result.targetName} was captured!`

  const reason = result.failureReason ?? (result.hit ? 'The Pokémon broke free.' : 'The Poké Ball missed.')
  if (result.hit && result.shakeCount > 0) return `Result: ${reason} (${shakeLabel(result.shakeCount)}).`
  return `Result: ${reason}`
}

export const buildPokeballCaptureLogLines = (event: PokeballCaptureOutcomeEvent): string[] => {
  const { result } = event
  const captureLine = captureRollLogLine(result)
  return [
    `${result.trainerName} threw ${result.pokeballName} at ${result.targetName}.`,
    captureAccuracyLogLine(result),
    ...(captureLine ? [captureLine] : []),
    ...(result.naturalCaptureSuccess ? ['Natural 100: automatic capture.'] : []),
    captureResultLogLine(result),
  ]
}

export const appendPokeballCaptureLogEntry = (
  metadata: Record<string, unknown> | undefined,
  event: PokeballCaptureOutcomeEvent,
  options: { now?: () => number; maxLogEntries?: number } = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.captureLog) ? next.captureLog : []
  const entry: PokeballCaptureLogEntry = {
    at: options.now?.() ?? Date.now(),
    userId: event.trainerId,
    userName: event.result.trainerName,
    actionName: `Throw ${event.pokeballName}`,
    pokeballName: event.pokeballName,
    targetId: event.targetId,
    targetName: event.result.targetName,
    success: event.result.success,
    hit: event.result.hit,
    lines: buildPokeballCaptureLogLines(event),
  }
  next.captureLog = [...previous, entry].slice(-(options.maxLogEntries ?? DEFAULT_POKEBALL_CAPTURE_LOG_ENTRIES))
  return next
}

const ballKey = (name: string): string => toSlug(name)

const POKEBALL_INVENTORY_SECTION_ORDER = [
  'pokeBalls',
  'keyItems',
  'pokemonItems',
  'medicalKit',
  'foodStuff',
  'equipment',
] as const satisfies readonly (keyof TrainerInventory)[]

const finiteNumber = (value: unknown): number | null => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const parseIntegerModifier = (value: unknown): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const match = String(value).match(/[+-]?\d+/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

const parseCaptureModifierFromText = (value: string | null | undefined): number | null => {
  if (!value) return null
  const match = value.match(/Capture Modifier\s*([+-]\d+)/i)
  if (!match) return null
  return parseIntegerModifier(match[1])
}

const parseCaptureModifier = (entry: InventoryEntry, item: PtuItem | null): number => (
  parseIntegerModifier(entry.mod)
  ?? parseCaptureModifierFromText(entry.description)
  ?? parseCaptureModifierFromText(item?.effects.join(' '))
  ?? 0
)

const itemSearchText = (item: PtuItem | null): string => [
  item?.name,
  ...(item?.categories ?? []),
  ...(item?.effects ?? []),
  ...(item?.sections ?? []),
  ...(item?.aliases ?? []),
].filter(Boolean).join(' ')

const isPokeballInventoryEntry = (entry: InventoryEntry, item: PtuItem | null): boolean => {
  if (item?.categories.some((category) => /pok[eé]\s*ball/i.test(category))) return true
  if (/Capture Modifier/i.test(itemSearchText(item))) return true
  if (/Capture Modifier/i.test(entry.description ?? '')) return true
  if (/ball/i.test(entry.name) && entry.mod != null) return true
  return false
}

const normalizeQuantity = (value: unknown): number => {
  const numeric = finiteNumber(value)
  if (numeric == null) return 0
  return Math.max(0, Math.floor(numeric))
}

const pokeballItemNameCandidates = (name: string): string[] => {
  const candidates = new Set<string>([name])
  const singularBall = name.replace(/\bBalls\b/gi, 'Ball').trim()
  if (singularBall) candidates.add(singularBall)

  const compact = name.replace(/[\s-]+/g, '').toLowerCase()
  if (/^pok[eé]?balls?$/.test(compact)) candidates.add('Poké Ball')

  return [...candidates]
}

export const resolvePokeballItem = (name: string | null | undefined): PtuItem | null => {
  const trimmed = name?.trim()
  if (!trimmed) return null
  for (const candidate of pokeballItemNameCandidates(trimmed)) {
    const item = findItem(candidate)
    if (item) return item
  }
  return null
}

const trainerInventoryEntriesForPokeballs = (sheet: TrainerSheet | null | undefined): InventoryEntry[] => {
  const inventory = sheet?.inventory
  if (!inventory) return []
  return POKEBALL_INVENTORY_SECTION_ORDER.flatMap((section) => inventory[section] ?? [])
}

export const buildTrainerPokeballOptions = (sheet: TrainerSheet | null | undefined): TokenPokeballOption[] => {
  const entries = trainerInventoryEntriesForPokeballs(sheet)
  const merged = new Map<string, TokenPokeballOption>()

  for (const entry of entries) {
    const name = entry.name?.trim()
    if (!name) continue
    const quantity = normalizeQuantity(entry.qty)
    if (quantity <= 0) continue

    const item = resolvePokeballItem(name)
    if (!isPokeballInventoryEntry(entry, item)) continue

    const rollModifier = parseCaptureModifier(entry, item)
    const optionName = item?.name ?? name
    const key = ballKey(optionName)
    const previous = merged.get(key)
    if (previous) {
      previous.quantity += quantity
      continue
    }

    const description = entry.description?.trim() || item?.effects.join(' ') || ''
    merged.set(key, {
      name: optionName,
      quantity,
      rollModifier,
      modifierLabel: signed(rollModifier),
      description,
      item,
    })
  }

  return [...merged.values()]
}

export const createPokeballThrowScript = (rangeMeters: number): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: POKEBALL_THROW_MOVE_NAME,
  version: POKEBALL_THROW_SCRIPT_VERSION,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: false,
  requiresAccuracy: true,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: POKEBALL_THROW_AC,
  range: `${rangeMeters}`,
  effect: 'AC6 Status Attack. On hit, roll capture against an unowned Pokémon.',
  keywords: [],
  criticalRange: null,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

export const trainerThrowingRangeMeters = (sheet: TrainerSheet | null | undefined): number => {
  if (!sheet) return 4
  const row = resolveTrainerCapabilities(sheet).rows.find((entry) => /^Throwing Range$/i.test(entry.label))
  const value = finiteNumber(row?.value)
  return value == null ? 4 : Math.max(0, Math.floor(value))
}

export const linkedPokemonSlugSet = (trainers: Iterable<TrainerSheet>): Set<string> => {
  const out = new Set<string>()
  for (const trainer of trainers) {
    for (const slug of [...(trainer.currentTeam ?? []), ...(trainer.boxedPokemon ?? [])]) {
      const normalized = slug.trim()
      if (normalized) out.add(normalized)
    }
  }
  return out
}

export const unlinkedPokemonTargetsInPokeballRange = (options: {
  user: SpawnedPokemon
  tokens: readonly SpawnedPokemon[]
  rangeMeters: number
  linkedSlugs: ReadonlySet<string>
}): SpawnedPokemon[] => moveAutomationTargetsInRange({
  user: options.user,
  tokens: options.tokens,
  rangeMeters: options.rangeMeters,
}).filter((token) => token.sheetKind === 'pokemon' && !options.linkedSlugs.has(token.sheetSlug))

const pokemonDisplayName = (target: SpawnedPokemon, sheet: CharacterSheet | null | undefined): string => (
  sheet?.nickname?.trim() || target.species
)

const getPokedexEntry = (species: string | null | undefined): PokedexRecord | null => (
  species ? pokedexBySpecies.get(species) ?? null : null
)

const targetWeightClass = (target: SpawnedPokemon, sheet: CharacterSheet | null | undefined): number | null => {
  const sheetWeight = finiteNumber(sheet?.capabilities?.weight)
  if (sheetWeight != null) return sheetWeight
  const dexWeight = finiteNumber(getPokedexEntry(sheet?.species ?? target.species)?.weight)
  return dexWeight
}

const maxMovementCapability = (target: SpawnedPokemon): number => {
  const values = Object.values(target.movementCapabilities ?? {})
    .map((value) => finiteNumber(value))
    .filter((value): value is number => value != null)
  return values.length ? Math.max(...values) : 0
}

const trainerOwnsSpecies = (options: {
  trainer: TrainerSheet
  targetSpecies: string
  pokemonBySlug?: ReadonlyMap<string, CharacterSheet>
}): boolean => {
  const species = options.targetSpecies.trim().toLocaleLowerCase()
  if (!species || !options.pokemonBySlug) return false
  for (const slug of [...(options.trainer.currentTeam ?? []), ...(options.trainer.boxedPokemon ?? [])]) {
    const sheet = options.pokemonBySlug.get(slug.trim())
    if (sheet?.species?.trim().toLocaleLowerCase() === species) return true
  }
  return false
}

const automatedConditionalBallModifiers = (options: {
  pokeballName: string
  trainer: TrainerSheet
  target: SpawnedPokemon
  targetSheet: CharacterSheet | null | undefined
  pokemonBySlug?: ReadonlyMap<string, CharacterSheet>
  currentRound?: number | null
}): PokeballCaptureBreakdownLine[] => {
  const key = ballKey(options.pokeballName)
  const lines: PokeballCaptureBreakdownLine[] = []

  if (key === 'nest-ball' && options.target.level < 10) {
    lines.push({ label: 'Nest Ball target below Level 10', value: -20 })
  }

  if (key === 'net-ball' && options.target.defenderTypes.some((type) => /^(Water|Bug)$/i.test(type))) {
    lines.push({ label: 'Net Ball Water/Bug target', value: -20 })
  }

  if (key === 'heavy-ball') {
    const weight = targetWeightClass(options.target, options.targetSheet)
    if (weight != null && weight > 1) {
      lines.push({ label: `Heavy Ball Weight Class ${weight}`, value: -5 * Math.floor(weight - 1) })
    }
  }

  if (key === 'fast-ball' && maxMovementCapability(options.target) > 7) {
    lines.push({ label: 'Fast Ball target has Movement > 7', value: -20 })
  }

  if (key === 'repeat-ball' && trainerOwnsSpecies({
    trainer: options.trainer,
    targetSpecies: options.targetSheet?.species ?? options.target.species,
    pokemonBySlug: options.pokemonBySlug,
  })) {
    lines.push({ label: 'Repeat Ball owned species', value: -20 })
  }

  if (key === 'timer-ball') {
    const round = Math.max(1, Math.floor(options.currentRound ?? 1))
    const penalty = round >= 4 ? 20 : round >= 3 ? 10 : round >= 2 ? 5 : 0
    if (penalty) lines.push({ label: `Timer Ball round ${round} penalty`, value: penalty })
  }

  if (key === 'quick-ball') {
    const round = Math.max(1, Math.floor(options.currentRound ?? 1))
    const modifier = Math.max(-20, 5 - ((round - 1) * 5))
    // The +5 base modifier is present in item data; add only the round-to-round delta here.
    const base = 5
    const delta = modifier - base
    if (delta) lines.push({ label: `Quick Ball round ${round} adjustment`, value: delta })
  }

  return lines
}

const conditionalBallNotes = (pokeballName: string): string[] => {
  const key = ballKey(pokeballName)
  const manual: Record<string, string> = {
    'level-ball': 'Level Ball’s active-Pokémon level condition is not inferred automatically.',
    'lure-ball': 'Lure Ball’s bait condition is not inferred automatically.',
    'moon-ball': 'Moon Ball’s Evolution Stone condition is not inferred automatically.',
    'love-ball': 'Love Ball’s same evolutionary line/opposite gender condition is not inferred automatically.',
    'dusk-ball': 'Dusk Ball’s darkness condition is not inferred automatically.',
    'dive-ball': 'Dive Ball’s underwater/underground condition is not inferred automatically.',
  }
  return manual[key] ? [manual[key]] : []
}

const hpCaptureRateLine = (target: SpawnedPokemon): PokeballCaptureBreakdownLine => {
  if (target.currentHp <= 0) return { label: 'HP at 0 or lower', value: 0, detail: 'Cannot be captured.' }
  if (target.currentHp === 1) return { label: 'Exactly 1 HP', value: 30 }

  const maxHp = Math.max(1, target.maxHp)
  const ratio = target.currentHp / maxHp
  if (ratio > 0.75) return { label: 'Above 75% HP', value: -30 }
  if (ratio > 0.5) return { label: 'At or below 75% HP', value: -15 }
  if (ratio > 0.25) return { label: 'At or below 50% HP', value: 0 }
  return { label: 'At or below 25% HP', value: 15 }
}

const evolutionCaptureRateLine = (target: SpawnedPokemon, sheet: CharacterSheet | null | undefined): PokeballCaptureBreakdownLine => {
  const remaining = getPokedexEntry(sheet?.species ?? target.species)?.evolutions_remaining
  if (remaining === 2) return { label: 'Two evolutions remaining', value: 10 }
  if (remaining === 1) return { label: 'One evolution remaining', value: 0 }
  if (remaining === 0) return { label: 'No evolutions remaining', value: -10 }
  return { label: 'Evolution stage unknown', value: 0 }
}

const conditionCaptureRateLines = (target: SpawnedPokemon): PokeballCaptureBreakdownLine[] => {
  const lines: PokeballCaptureBreakdownLine[] = []
  for (const condition of normalizeConditionNames(target.conditions)) {
    const base = conditionBaseName(condition) ?? condition
    const definition = conditionByName.get(base)
    if (definition?.category === 'Persistent Affliction') {
      lines.push({ label: `${base} persistent condition`, value: 10 })
    } else if (definition?.category === 'Volatile Affliction') {
      lines.push({ label: `${base} volatile condition`, value: 5 })
    }

    if (base === 'Stuck') lines.push({ label: 'Stuck', value: 10 })
    if (base === 'Slowed') lines.push({ label: 'Slowed', value: 5 })
  }
  return lines
}

const captureSuccessCount = (options: {
  captureRate: number
  rollModifier: number
  capturable: boolean
}): number => {
  if (!options.capturable) return 0
  let successes = 0
  for (let roll = 1; roll <= 100; roll += 1) {
    if (roll === 100 || roll + options.rollModifier <= options.captureRate) successes += 1
  }
  return successes
}

const roundPercent = (chance: number): number => Math.round(chance * 1000) / 10

export const formatCaptureChancePercent = (percent: number): string => (
  `${Number.isInteger(percent) ? percent.toString() : percent.toFixed(1)}%`
)

const captureSuccessPercent = (options: {
  captureRate: number
  rollModifier: number
  capturable: boolean
}): number => roundPercent(captureSuccessCount(options) / 100)

const combinedHitAndCapturePercent = (options: {
  script: MoveAutomationScript
  user: SpawnedPokemon
  target: SpawnedPokemon
  captureRate: number
  rollModifier: number
  capturable: boolean
}): number => {
  if (!options.capturable) return 0

  const userAccuracy = moveAutomationUserAccuracy(options.user)
  const targetEvasion = resolveMoveAutomationTargetEvasion(options.script, options.target, { attacker: options.user }).value
  let successes = 0
  for (let roll = 1; roll <= 20; roll += 1) {
    const accuracy = resolveMoveAutomationAccuracyRoll(options.script, roll, { userAccuracy, targetEvasion })
    if (!accuracy.hit) continue
    const captureModifier = options.rollModifier + (roll === 20 ? CAPTURE_RATE_NATURAL_TWENTY_BONUS : 0)
    successes += captureSuccessCount({
      captureRate: options.captureRate,
      rollModifier: captureModifier,
      capturable: options.capturable,
    })
  }
  return roundPercent(successes / 2000)
}

export const buildPokeballCaptureBreakdown = (options: {
  trainer: TrainerSheet
  user: SpawnedPokemon
  target: SpawnedPokemon
  targetSheet?: CharacterSheet | null
  pokeball: TokenPokeballOption
  pokemonBySlug?: ReadonlyMap<string, CharacterSheet>
  currentRound?: number | null
}): PokeballCaptureBreakdown => {
  const targetSheet = options.targetSheet ?? null
  const captureRateLines: PokeballCaptureBreakdownLine[] = [
    { label: 'Base', value: 100 },
    { label: `Target Level ${options.target.level} × 2`, value: -2 * options.target.level },
    hpCaptureRateLine(options.target),
    evolutionCaptureRateLine(options.target, targetSheet),
  ]

  if (targetSheet?.shiny) captureRateLines.push({ label: 'Shiny rarity', value: -10 })

  const injuries = Math.max(0, Math.floor(options.target.injuries ?? 0))
  if (injuries) captureRateLines.push({ label: `${injuries} Injuries`, value: injuries * 5 })
  captureRateLines.push(...conditionCaptureRateLines(options.target))

  const captureRate = captureRateLines.reduce((sum, line) => sum + line.value, 0)
  const capturable = options.target.currentHp > 0
  const uncatchableReason = capturable ? null : 'Pokémon at 0 HP or lower cannot be captured.'

  const ballConditionalLines = automatedConditionalBallModifiers({
    pokeballName: options.pokeball.name,
    trainer: options.trainer,
    target: options.target,
    targetSheet,
    pokemonBySlug: options.pokemonBySlug,
    currentRound: options.currentRound,
  })
  const rollModifierLines: PokeballCaptureBreakdownLine[] = [
    { label: `Trainer Level ${options.trainer.level}`, value: -Math.max(0, Math.floor(options.trainer.level ?? 0)) },
    { label: `${options.pokeball.name} modifier`, value: options.pokeball.rollModifier },
    ...ballConditionalLines,
  ]
  const rollModifier = rollModifierLines.reduce((sum, line) => sum + line.value, 0)

  const rangeMeters = trainerThrowingRangeMeters(options.trainer)
  const script = createPokeballThrowScript(rangeMeters)
  const baseHitChance = moveAutomationTargetHitChance(script, options.user, options.target)
  const captureChance = captureSuccessPercent({ captureRate, rollModifier, capturable })
  const naturalTwentyCaptureChance = captureSuccessPercent({
    captureRate,
    rollModifier: rollModifier + CAPTURE_RATE_NATURAL_TWENTY_BONUS,
    capturable,
  })
  const combinedChance = combinedHitAndCapturePercent({
    script,
    user: options.user,
    target: options.target,
    captureRate,
    rollModifier,
    capturable,
  })
  const combinedChanceLabel = formatCaptureChancePercent(combinedChance)

  return {
    captureRate,
    captureRateLines,
    rollModifier,
    rollModifierLines,
    hitChance: {
      targetId: options.target.id,
      percent: combinedChance,
      label: combinedChanceLabel,
      tone: moveAutomationHitChanceTone(combinedChance),
      title: `${combinedChanceLabel} to hit and capture. ${baseHitChance.label} to hit; ${formatCaptureChancePercent(captureChance)} capture after a normal hit; ${formatCaptureChancePercent(naturalTwentyCaptureChance)} after a natural 20 hit.`,
    },
    captureChance,
    captureChanceLabel: formatCaptureChancePercent(captureChance),
    naturalTwentyCaptureChance,
    naturalTwentyCaptureChanceLabel: formatCaptureChancePercent(naturalTwentyCaptureChance),
    combinedChance,
    combinedChanceLabel,
    capturable,
    uncatchableReason,
    notes: conditionalBallNotes(options.pokeball.name),
  }
}

const randomD100 = (random: () => number = Math.random): number => 1 + Math.floor(random() * 100)

export const resolvePokeballCaptureAttempt = (options: {
  trainer: TrainerSheet
  user: SpawnedPokemon
  target: SpawnedPokemon
  targetSheet?: CharacterSheet | null
  pokeball: TokenPokeballOption
  pokemonBySlug?: ReadonlyMap<string, CharacterSheet>
  currentRound?: number | null
  random?: () => number
  now?: () => number
}): PokeballCaptureAttemptResult => {
  const breakdown = buildPokeballCaptureBreakdown(options)
  const rangeMeters = trainerThrowingRangeMeters(options.trainer)
  const script = createPokeballThrowScript(rangeMeters)
  const userAccuracy = moveAutomationUserAccuracy(options.user)
  const targetEvasion = resolveMoveAutomationTargetEvasion(script, options.target, { attacker: options.user })
  const accuracyRoll = randomD20(options.random)
  const accuracy = resolveMoveAutomationAccuracyRoll(script, accuracyRoll, {
    userAccuracy,
    targetEvasion: targetEvasion.value,
  })

  let captureRoll: number | null = null
  let adjustedCaptureRoll: number | null = null
  let naturalTwentyCaptureBonus = 0
  let success = false
  let naturalCaptureSuccess = false
  let shakeCount = 0
  let failureReason: string | null = null

  if (!accuracy.hit) {
    failureReason = 'The Poké Ball missed.'
  } else if (!breakdown.capturable) {
    failureReason = breakdown.uncatchableReason
  } else {
    captureRoll = randomD100(options.random)
    naturalTwentyCaptureBonus = accuracyRoll === 20 ? CAPTURE_RATE_NATURAL_TWENTY_BONUS : 0
    adjustedCaptureRoll = captureRoll + breakdown.rollModifier + naturalTwentyCaptureBonus
    naturalCaptureSuccess = captureRoll === 100
    success = naturalCaptureSuccess || adjustedCaptureRoll <= breakdown.captureRate
    if (success) {
      shakeCount = 3
    } else {
      shakeCount = adjustedCaptureRoll <= breakdown.captureRate + 20 ? 2 : 1
      failureReason = 'The Pokémon broke free.'
    }
  }

  const targetName = pokemonDisplayName(options.target, options.targetSheet)
  return {
    id: `capture-${options.user.id}-${options.target.id}-${options.now?.() ?? Date.now()}`,
    trainerId: options.user.id,
    trainerName: options.trainer.name || options.user.species,
    targetId: options.target.id,
    targetName,
    targetSpecies: options.targetSheet?.species ?? options.target.species,
    targetSpriteUrl: options.target.profileSpriteUrl ?? options.target.spriteUrl ?? null,
    pokeballName: options.pokeball.name,
    success,
    hit: accuracy.hit,
    shakeCount,
    accuracyRoll,
    modifiedAccuracyRoll: accuracy.modifiedRoll ?? accuracyRoll,
    accuracyCheck: accuracy.accuracyCheck ?? null,
    userAccuracy,
    targetEvasion: targetEvasion.value,
    targetEvasionLabel: targetEvasion.label,
    captureRoll,
    adjustedCaptureRoll,
    captureRate: breakdown.captureRate,
    naturalTwentyCaptureBonus,
    naturalCaptureSuccess,
    failureReason,
    breakdown,
  }
}

const entryMatchesPokeballName = (entry: InventoryEntry, pokeballName: string): boolean => {
  const key = ballKey(pokeballName)
  if (ballKey(entry.name) === key) return true
  const item = resolvePokeballItem(entry.name)
  return Boolean(item && (ballKey(item.name) === key || item.aliases.some((alias) => ballKey(alias) === key)))
}

export const applyPokeballCaptureOutcomeToTrainerSheet = (
  sheet: TrainerSheet,
  event: Pick<PokeballCaptureOutcomeEvent, 'pokeballName' | 'targetSlug' | 'result'>,
): PokeballCaptureOutcomeApplyResult => {
  const entries = trainerInventoryEntriesForPokeballs(sheet)
  const entry = entries.find((candidate) => entryMatchesPokeballName(candidate, event.pokeballName) && normalizeQuantity(candidate.qty) > 0)
  let consumed = false
  if (entry) {
    const quantity = normalizeQuantity(entry.qty)
    if (quantity > 0) {
      entry.qty = quantity - 1
      consumed = true
    }
  }

  let roster: PokeballCaptureOutcomeApplyResult['roster'] = null
  const targetSlug = event.targetSlug.trim()
  if (event.result.success && targetSlug) {
    sheet.currentTeam = Array.isArray(sheet.currentTeam) ? sheet.currentTeam.map((slug) => slug.trim()).filter(Boolean) : []
    sheet.boxedPokemon = Array.isArray(sheet.boxedPokemon) ? sheet.boxedPokemon.map((slug) => slug.trim()).filter(Boolean) : []
    const alreadyTeam = sheet.currentTeam.some((slug) => slug === targetSlug)
    const alreadyBox = sheet.boxedPokemon.some((slug) => slug === targetSlug)
    if (alreadyTeam || alreadyBox) {
      roster = 'already'
    } else if (sheet.currentTeam.length < TRAINER_TEAM_LIMIT_FOR_CAPTURE) {
      sheet.currentTeam.push(targetSlug)
      roster = 'team'
    } else {
      sheet.boxedPokemon.push(targetSlug)
      roster = 'box'
    }
  }

  return { consumed, roster }
}
