import { createHash } from 'node:crypto'
import abilitiesJson from '../../../data/reference/abilities.json'
import experienceJson from '../../../data/reference/pokemonExperienceChart.json'
import itemsJson from '../../../data/reference/items.json'
import movesJson from '../../../data/reference/moves.json'
import pokedexJson from '../../../data/reference/pokedex.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { PTU_NATURE_CHART, ptuNatureAdjustedDelta } from '#shared/ruleset/natures'
import type { WildGenerationCandidateProjectionV1 } from '#shared/gmToolkit/generation'
import type { CharacterSheet, CharacterSheetAbility, CharacterSheetMove, StatKey } from '~/types/characterSheet'
import { normalizeCharacterSheet } from '~/utils/sheetNormalize'
import { computeMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import { computePokemonLevelUpStatPointBudget } from '~/utils/statPointBudgets'
import type { GmToolkitSeededRng } from './seededRng'

interface PokedexRow {
  readonly species: string
  readonly base_stats: { readonly hp: number; readonly atk: number; readonly def: number; readonly spatk: number; readonly spdef: number; readonly spd: number }
  readonly abilities: { readonly basic?: readonly string[]; readonly advanced?: readonly string[]; readonly high?: readonly string[] }
  readonly genderless?: boolean
  readonly male_pct?: number
  readonly female_pct?: number
  readonly capabilities?: Record<string, unknown> & { readonly other?: readonly string[] }
  readonly skills?: Readonly<Record<string, string>>
  readonly level_up_moves?: readonly { readonly level: number; readonly name: string }[]
  readonly size?: string
  readonly weight?: number
}
interface MoveRow {
  readonly name: string
  readonly type?: string
  readonly frequency?: string
  readonly ac?: number | string | null
  readonly damage_base?: number | null
  readonly damage_roll?: string | null
  readonly damage_class?: string | null
  readonly range?: string | null
  readonly effect?: string | null
  readonly special?: string | null
  readonly contest?: unknown
}
interface AbilityRow { readonly name: string; readonly frequency?: string; readonly trigger?: string; readonly effect?: string }
interface ItemRow { readonly name: string; readonly effects?: readonly string[] }

export interface ConstructWildPokemonInput {
  readonly operationId: string
  readonly candidateId: string
  readonly slot: number
  readonly speciesId: string
  readonly level: number
  readonly shinyChancePercent: number
  readonly heldItemName: string | null
  readonly tableId: string
  readonly tableRevision: number
  readonly rng: GmToolkitSeededRng
}

export interface ConstructedWildPokemon {
  readonly candidateId: string
  readonly slot: number
  readonly document: Omit<CharacterSheet, 'slug' | 'revision' | 'folder' | 'updatedAt'>
  readonly projection: WildGenerationCandidateProjectionV1
  readonly definitionSha256: string
  readonly sourceDefinitionHashes: readonly string[]
}

export class WildPokemonConstructionError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'WildPokemonConstructionError'; this.code = code }
}

const fail = (code: string, message: string): never => { throw new WildPokemonConstructionError(code, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const sourceSha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const pokedex = new Map((pokedexJson as readonly PokedexRow[]).map(row => [row.species, row]))
const moves = movesJson as unknown as Readonly<Record<string, MoveRow>>
const abilities = abilitiesJson as Readonly<Record<string, AbilityRow>>
const items = itemsJson as Readonly<Record<string, ItemRow>>
const experience = new Map((experienceJson as readonly { readonly level: number; readonly expNeeded: number }[]).map(row => [row.level, row.expNeeded]))

export const GM_WILD_GENERATION_SOURCE_DEFINITION_HASHES = Object.freeze([
  sourceSha256(pokedexJson),
  sourceSha256(movesJson),
  sourceSha256(abilitiesJson),
  sourceSha256(itemsJson),
  sourceSha256(experienceJson),
  sourceSha256(PTU_NATURE_CHART),
].sort())

const canonicalMove = (name: string): CharacterSheetMove => {
  const row = moves[name]
  if (!row || row.name !== name) return fail('gm-generation.unknown-move', `Move ${name} is absent from app-owned canonical Moves.`)
  const category = row.damage_class === 'Physical' || row.damage_class === 'Special' || row.damage_class === 'Status'
    ? row.damage_class
    : undefined
  return {
    name,
    ...(row.type === undefined ? {} : { type: row.type }),
    ...(category === undefined ? {} : { category }),
    ...(typeof row.damage_base === 'number' ? { db: row.damage_base } : {}),
    ...(typeof row.damage_roll === 'string' ? { damageRoll: row.damage_roll } : {}),
    ...(row.frequency === undefined ? {} : { frequency: row.frequency }),
    ...(typeof row.ac === 'number' || typeof row.ac === 'string' ? { ac: row.ac } : {}),
    ...(typeof row.range === 'string' ? { range: row.range } : {}),
    ...(typeof row.effect === 'string' ? { effect: row.effect } : {}),
    ...(typeof row.special === 'string' ? { special: row.special } : {}),
  }
}

const canonicalAbility = (name: string): CharacterSheetAbility => {
  const row = abilities[name]
  if (!row || row.name !== name) return fail('gm-generation.unknown-ability', `Ability ${name} is absent from app-owned canonical Abilities.`)
  return {
    name,
    ...(row.frequency === undefined ? {} : { frequency: row.frequency }),
    ...(row.trigger === undefined ? {} : { trigger: row.trigger }),
    ...(row.effect === undefined ? {} : { effect: row.effect }),
    activated: false,
  }
}

const selectedMoves = (species: PokedexRow, level: number): CharacterSheetMove[] => {
  const seen = new Set<string>()
  const selected: CharacterSheetMove[] = []
  let priorLevel = 0
  for (const [index, row] of (species.level_up_moves ?? []).entries()) {
    if (!Number.isSafeInteger(row.level) || row.level < priorLevel || typeof row.name !== 'string' || !row.name) {
      return fail('gm-generation.malformed-level-up-move', `${species.species} level-up Move row ${index + 1} is malformed or out of order.`)
    }
    priorLevel = row.level
    if (row.level <= level && !seen.has(row.name)) {
      seen.add(row.name)
      selected.push(canonicalMove(row.name))
    }
  }
  if (selected.length === 0) return fail('gm-generation.no-legal-move', `${species.species} has no canonical level-up Move at or below Level ${level}.`)
  return selected.slice(-6)
}

const selectedAbilities = (species: PokedexRow, level: number, rng: GmToolkitSeededRng, slot: number): CharacterSheetAbility[] => {
  const tiers: Array<'basic' | 'advanced' | 'high'> = ['basic', ...(level >= 20 ? ['advanced' as const] : []), ...(level >= 40 ? ['high' as const] : [])]
  const selected = new Set<string>()
  return tiers.map((tier) => {
    const pool = (species.abilities?.[tier] ?? []).filter(name => typeof name === 'string' && name.length > 0 && !selected.has(name))
    if (pool.length === 0) return fail('gm-generation.missing-ability-tier', `${species.species} has no unambiguous canonical ${tier} Ability for Level ${level}.`)
    const name = pool[rng.int(0, pool.length - 1, `slot-${slot}.ability.${tier}`)]!
    selected.add(name)
    return canonicalAbility(name)
  })
}

const selectedGender = (species: PokedexRow, rng: GmToolkitSeededRng, slot: number): 'Male' | 'Female' | 'Genderless' => {
  if (species.genderless === true) return 'Genderless'
  const male = Number(species.male_pct)
  const female = Number(species.female_pct)
  if (!Number.isFinite(male) || !Number.isFinite(female) || male < 0 || female < 0 || Math.abs(male + female - 100) > 0.001) {
    return fail('gm-generation.malformed-gender', `${species.species} has an ambiguous canonical gender distribution.`)
  }
  return rng.int(1, 10_000, `slot-${slot}.gender`) <= Math.round(male * 100) ? 'Male' : 'Female'
}

const SKILL_KEYS: Readonly<Record<string, keyof NonNullable<CharacterSheet['skills']>>> = Object.freeze({
  Athletics: 'athletics', Acrobatics: 'acrobatics', Combat: 'combat', Stealth: 'stealth', Perception: 'perception', Focus: 'focus',
  Charm: 'charm', Command: 'command', Guile: 'guile', Intimidate: 'intimidate', Intuition: 'intuition', Survival: 'survival',
  'General Ed': 'generalEd', 'Medicine Ed': 'medicineEd', 'Occult Ed': 'occultEd', 'Poké Ed': 'pokeEd', 'Tech Ed': 'techEd',
})

const initializedSkills = (species: PokedexRow): NonNullable<CharacterSheet['skills']> => {
  const result: NonNullable<CharacterSheet['skills']> = {}
  for (const [label, value] of Object.entries(species.skills ?? {})) {
    const key = SKILL_KEYS[label]
    if (!key || typeof value !== 'string' || !/^\d+d6(?:[+-]\d+)?$/i.test(value)) {
      return fail('gm-generation.malformed-skill', `${species.species} Skill ${label} is not a supported canonical skill die.`)
    }
    result[key] = value
  }
  return result
}

const initializedCapabilities = (species: PokedexRow): NonNullable<CharacterSheet['capabilities']> => {
  const source = species.capabilities ?? {}
  const number = (key: string): number | undefined => typeof source[key] === 'number' && Number.isFinite(source[key]) ? source[key] as number : undefined
  const text = (key: string): string | undefined => typeof source[key] === 'string' ? source[key] as string : undefined
  const other = source.other
  if (other !== undefined && (!Array.isArray(other) || other.some(value => typeof value !== 'string'))) {
    return fail('gm-generation.malformed-capability', `${species.species} has malformed canonical other Capabilities.`)
  }
  return {
    ...(number('overland') === undefined ? {} : { overland: number('overland') }),
    ...(number('sky') === undefined ? {} : { sky: number('sky') }),
    ...(number('swim') === undefined ? {} : { swim: number('swim') }),
    ...(number('levitate') === undefined ? {} : { levitate: number('levitate') }),
    ...(number('burrow') === undefined ? {} : { burrow: number('burrow') }),
    ...(text('jump') === undefined ? {} : { jump: text('jump') }),
    ...(number('power') === undefined ? {} : { power: number('power') }),
    ...(typeof species.weight !== 'number' ? {} : { weight: species.weight }),
    ...(typeof species.size !== 'string' ? {} : { size: species.size }),
    other: [...(other ?? [])],
  }
}

const allocatedStats = (species: PokedexRow, nature: typeof PTU_NATURE_CHART[number], level: number): NonNullable<CharacterSheet['stats']> => {
  const base: Record<StatKey, number> = {
    hp: species.base_stats.hp,
    atk: species.base_stats.atk,
    def: species.base_stats.def,
    satk: species.base_stats.spatk,
    sdef: species.base_stats.spdef,
    spd: species.base_stats.spd,
  }
  if (Object.values(base).some(value => !Number.isSafeInteger(value) || value < 1)) return fail('gm-generation.malformed-base-stats', `${species.species} has malformed canonical Base Stats.`)
  const order = (Object.keys(base) as StatKey[]).sort((left, right) => {
    const leftAdjusted = base[left] + ptuNatureAdjustedDelta(base[left], left, nature.plus, nature.minus)
    const rightAdjusted = base[right] + ptuNatureAdjustedDelta(base[right], right, nature.plus, nature.minus)
    return rightAdjusted - leftAdjusted || left.localeCompare(right)
  })
  const added: Record<StatKey, number> = { hp: 0, atk: 0, def: 0, satk: 0, sdef: 0, spd: 0 }
  const budget = computePokemonLevelUpStatPointBudget(level)
  for (let point = 0; point < budget; point += 1) added[order[point % order.length]!] += 1
  return Object.fromEntries((Object.keys(base) as StatKey[]).map(key => [key, { base: base[key], added: added[key], stage: 0 }])) as NonNullable<CharacterSheet['stats']>
}

const statProjection = (sheet: CharacterSheet): WildGenerationCandidateProjectionV1['statTotals'] => Object.fromEntries(
  resolveStats(sheet).map(row => [row.key, row.total]),
) as WildGenerationCandidateProjectionV1['statTotals']

export const constructWildPokemon = (input: ConstructWildPokemonInput): ConstructedWildPokemon => {
  const species = pokedex.get(input.speciesId)
  if (!species) return fail('gm-generation.unknown-species', `${input.speciesId} is absent from the app-owned canonical Pokédex.`)
  if (!Number.isSafeInteger(input.level) || input.level < 1 || input.level > 100) return fail('gm-generation.invalid-level', 'Generated Level must be from 1 to 100.')
  const totalExp = experience.get(input.level)
  if (!Number.isSafeInteger(totalExp) || Number(totalExp) < 0) return fail('gm-generation.missing-experience', `Level ${input.level} has no exact app-owned Experience threshold.`)
  const item = input.heldItemName === null ? null : items[input.heldItemName]
  if (input.heldItemName !== null && (!item || item.name !== input.heldItemName)) return fail('gm-generation.unknown-item', `${input.heldItemName} is absent from app-owned canonical Items.`)

  const gender = selectedGender(species, input.rng, input.slot)
  const nature = PTU_NATURE_CHART[input.rng.int(1, PTU_NATURE_CHART.length, `slot-${input.slot}.nature`) - 1]!
  const shiny = input.rng.int(1, 10_000, `slot-${input.slot}.shiny`) <= Math.round(input.shinyChancePercent * 100)
  const movelist = selectedMoves(species, input.level)
  const selectedAbilityRows = selectedAbilities(species, input.level, input.rng, input.slot)
  const capabilities = initializedCapabilities(species)
  const stats = allocatedStats(species, nature, input.level)
  const sourceDefinitionHashes = [...GM_WILD_GENERATION_SOURCE_DEFINITION_HASHES]
  const seedCommitment = sha256({ algorithm: input.rng.algorithm, seed: input.rng.seed })

  const draft = normalizeCharacterSheet({
    slug: 'pending-wild-pokemon',
    nickname: species.species,
    species: species.species,
    level: input.level,
    totalExp,
    gender,
    shiny,
    caughtBall: 'Basic Ball',
    player: false,
    nature: nature.name,
    natureMod: { plus: nature.plus, minus: nature.minus },
    stats,
    combat: {
      currentHp: 0,
      injuries: 0,
      injuriesHealedToday: 0,
      evasion: { vsAtkBonus: 0, vsSatkBonus: 0, vsAnyBonus: 0 },
      dr: 0,
      conditions: [],
      statusAfflictions: '',
      notes: '',
      trainingExp: 0,
    },
    vitamins: {
      statBoosts: { hp: 0, atk: 0, def: 0, satk: 0, sdef: 0, spd: 0 },
      statSuppressants: { hp: 0, atk: 0, def: 0, satk: 0, sdef: 0, spd: 0 },
      heartBooster: false,
      ppUp: false,
      ppUpMove: '',
      rareCandies: 0,
      heartScales: 0,
      notes: '',
    },
    combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
    items: {
      ...(item ? { held: item.name, itemDescription: (item.effects ?? []).join(' ') } : {}),
      extraItems: [],
    },
    weapon: { name: '', dbMod: 0, acMod: 0, description: '' },
    tutorPoints: { earned: Math.floor(input.level / 5) + 1, spent: 0 },
    skillBackground: { description: '', raised: [], lowered: [] },
    inheritedMoves: {},
    inheritedRemaining: 0,
    movelist,
    eggMoves: [],
    appliedMoves: [],
    abilities: selectedAbilityRows,
    edges: [],
    capabilities,
    skills: initializedSkills(species),
    scene: { sceneXp: 0, pkmnCount: 0, modifiers: 0, newTotal: 0 },
    gm: { notes: '' },
    serverPrivate: {
      gmGeneration: {
        schemaVersion: 1,
        operationId: input.operationId,
        candidateId: input.candidateId,
        tableId: input.tableId,
        tableRevision: input.tableRevision,
        sourceDefinitionHashes,
        seedCommitment,
      },
    },
  })
  const hp = resolveStats(draft).find(row => row.key === 'hp')
  if (!hp) return fail('gm-generation.invalid-derived-stats', `${species.species} HP could not be resolved.`)
  draft.combat!.currentHp = computeMaxHp(draft, hp.total)
  const { slug: _slug, revision: _revision, folder: _folder, updatedAt: _updatedAt, ...document } = structuredClone(draft)
  const capabilitySummary = [
    `Overland ${capabilities.overland ?? 0}`,
    ...(Number(capabilities.sky ?? 0) > 0 ? [`Sky ${capabilities.sky}`] : []),
    ...(Number(capabilities.swim ?? 0) > 0 ? [`Swim ${capabilities.swim}`] : []),
    ...(capabilities.other ?? []).slice(0, 4),
  ]
  const projection: WildGenerationCandidateProjectionV1 = {
    candidateId: input.candidateId,
    slot: input.slot,
    speciesId: species.species,
    level: input.level,
    gender,
    nature: nature.name,
    shiny,
    heldItemName: item?.name ?? null,
    abilityNames: selectedAbilityRows.map(row => row.name),
    moveNames: movelist.map(row => row.name),
    statTotals: statProjection(draft),
    capabilitySummary,
  }
  return Object.freeze({
    candidateId: input.candidateId,
    slot: input.slot,
    document: Object.freeze(document),
    projection: Object.freeze(projection),
    definitionSha256: sha256(document),
    sourceDefinitionHashes: Object.freeze(sourceDefinitionHashes),
  })
}
