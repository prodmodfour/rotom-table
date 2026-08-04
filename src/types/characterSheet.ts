import type { AbilityInstanceData } from '#shared/abilityAutomation/parameters'
import type { AbilityDailyUsageLedger } from '#shared/abilityAutomation/resources'
import type { CapabilityUsageLedger } from '#shared/capabilityAutomation/state'
import type { CapabilityCampaignState } from '#shared/capabilityAutomation/campaignState'
import type { PokeEdgeInstanceData } from '#shared/edgeAutomation/instances'
import type { EdgeUsageLedger } from '#shared/edgeAutomation/state'
import type { PermanentMoveListEntryProvenance } from '#shared/moveAutomation/permanentMoveLists'
import type { CombatStageKey } from '~/types/combatStages'
import type { SheetMoveUsageState } from '~/types/moveUsage'

/**
 * Schema for a Pokémon character sheet, modelled on the PTU pokesheet
 * spreadsheet (`pokesheet.pdf`).
 *
 * Almost everything is optional: the renderer pulls species defaults from
 * `data/reference/pokedex.json` (types, base stats, capabilities, skills…) and
 * lets a sheet author override or layer on top of those defaults.
 */

export type StatKey = 'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd'
export type PokemonTrainedStatKey = Exclude<StatKey, 'hp'>

export interface CharacterSheetStat {
  /** Legacy/manual Base override. Used as a fallback only when species reference Base Stats are unavailable. */
  base?: number
  /** Stat points added on level-up. */
  added?: number
  /** Current combat stage (-6 .. +6). */
  stage?: number
}

export interface CharacterSheetMove {
  name: string
  type?: string
  category?: 'Physical' | 'Special' | 'Status'
  /** Damage Base. */
  db?: number
  /** Optional pre-rolled damage expression, e.g. ``"1d8+6"``. */
  damageRoll?: string
  damageRollMod?: number
  frequency?: string
  ac?: number | string
  range?: string
  effect?: string
  special?: string
  contestStats?: string
  /** Server-authored origin for a move learned through permanent move automation. */
  permanentMoveSource?: PermanentMoveListEntryProvenance
}

export type CharacterSheetAppliedMoveSource = 'tm' | 'tutor'

export interface CharacterSheetAppliedMove extends CharacterSheetMove {
  /** How this move was applied to the Pokémon outside level-up or egg inheritance. */
  source: CharacterSheetAppliedMoveSource
}

export interface CharacterSheetAbility {
  name: string
  frequency?: string
  trigger?: string
  effect?: string
  /** True when an ability's sheet-level toggle is active (for example, Sand Veil in a Sandstorm or Snow Cloak in Hail). */
  activated?: boolean
  /** Stable canonical instance identity and reviewed parameter choices. */
  automation?: AbilityInstanceData
}

export interface CharacterSheetEdge {
  name: string
  cost?: number | string
  effect?: string
  /** Setup-editor compatibility storage; accepted rows normalize into automation choices. */
  choices?: Record<string, string>
  /** Stable canonical Poké Edge identity and typed lasting choices. */
  automation?: PokeEdgeInstanceData
}

export interface CharacterSheetWeapon {
  name?: string
  dbMod?: number
  acMod?: number
  description?: string
}

export interface CharacterSheetEvasion {
  /** Legacy/manual total fields. Kept for old JSON; renderer now derives totals from stats. */
  vsAtk?: number
  vsSatk?: number
  vsAny?: number
  /** Editable modifier stacked on top of stat-derived evasion. */
  vsAtkBonus?: number
  vsSatkBonus?: number
  vsAnyBonus?: number
}

export interface CharacterSheetCombat {
  /** Legacy/manual Max HP. Renderer ignores this and derives Max HP from PTU formulas. */
  maxHp?: number
  currentHp?: number
  injuries?: number
  /** Injuries restored during the current campaign day; capped by PTU's daily Injury-healing limit. */
  injuriesHealedToday?: number
  /** Legacy/manual injured HP. Renderer derives the injury-adjusted Max HP. */
  injuredHp?: number
  /** Legacy/manual Tick. Renderer derives Tick from formula Max HP. */
  tick?: number
  evasion?: CharacterSheetEvasion
  dr?: number
  /** PTU condition entries (for example, "Burned", "Tripped", or "Disabled: Tackle"). */
  conditions?: string[]
  /** Legacy/free-form status notes that do not map to a canonical condition. */
  statusAfflictions?: string
  /** Legacy free-form Vitamins notes. Normalization migrates this to CharacterSheet.vitamins.notes. */
  vitamins?: string
  notes?: string
  trainingExp?: number
}

export interface CharacterSheetVitaminTracking {
  /** HP Up / Protein / Iron / Calcium / Zinc / Carbos uses, keyed by affected stat. */
  statBoosts?: Partial<Record<StatKey, number>>
  /** Stat Suppressant / Suppressant Berry uses, keyed by lowered Base Stat. */
  statSuppressants?: Partial<Record<StatKey, number>>
  /** Heart Booster vitamin consumed; grants +2 Tutor Points and may only be used once per Pokémon. */
  heartBooster?: boolean
  /** PP Up vitamin consumed; target move is tracked in ppUpMove and may only be used once per Pokémon. */
  ppUp?: boolean
  ppUpMove?: string
  /** Rare Candies consumed in this Pokémon's lifetime; tracked separately from the five-vitamin limit. */
  rareCandies?: number
  /** Related Heart Scale inventory/count tracked for Heart Booster crafting. */
  heartScales?: number
  notes?: string
}

export interface CharacterSheetItems {
  held?: string
  itemDescription?: string
  /** Legacy single-slot digestion buff. New Gluttony-aware writes use digestionFoods. */
  digestionFood?: string
  digestionFoods?: string[]
  /** Honey Paws' separate Leftovers-equivalent buff; does not consume a normal slot. */
  honeyPawsFood?: string
  extraItems?: string[]
  pointsLeft?: number
}

export interface CharacterSheetTutorPoints {
  /** Legacy/cache field derived from Level; the sheet UI does not edit this manually. */
  earned?: number
  /** Manually tracked Tutor Points already spent on TMs, Features, or Poké Edges. */
  spent?: number
}

export interface CharacterSheetSkillBackground {
  description?: string
  raised?: string[]
  lowered?: string[]
}

export interface CharacterSheetGm {
  /** Private GM-only notes. Player sheet APIs and realtime streams redact this section. */
  notes?: string
}

/** Server-authored evidence that must never be accepted from or projected to a client. */
export interface CharacterSheetServerPrivate {
  abilityItemEvidence?: Array<{
    stateId: string
    canonicalItemId: string
    consumptionId: string
    sourceOperationId: string
    sceneName: string
    sceneStartedAt: number
  }>
}

export interface CharacterSheetCapabilities {
  overland?: number
  sky?: number
  swim?: number
  levitate?: number
  burrow?: number
  jump?: string
  power?: number
  weight?: number
  size?: string
  naturewalk?: string
  other?: string[]
}

export interface CharacterSheetSkills {
  acrobatics?: string
  athletics?: string
  charm?: string
  combat?: string
  command?: string
  generalEd?: string
  medicineEd?: string
  occultEd?: string
  pokeEd?: string
  techEd?: string
  focus?: string
  guile?: string
  intimidate?: string
  intuition?: string
  perception?: string
  stealth?: string
  survival?: string
}

export interface CharacterSheet {
  /** Server-owned document revision used for command conflict control. */
  revision?: number
  /** Durable server-only mechanic evidence; stripped from every player projection and preserved across sheet saves. */
  serverPrivate?: CharacterSheetServerPrivate
  /** URL slug for the sheet's subpage (``/sheets/<slug>``). */
  slug: string
  /** Logical SQLite library folder label for grouping on the sheets index. */
  folder?: string
  nickname: string
  /** Matches a `species` value in `data/reference/pokedex.json`; blank means no species selected yet. */
  species: string
  /** Current level. When edited in the sheet UI, totalExp is synced to this level's PTU threshold. */
  level: number
  /** Editable total experience. When edited in the sheet UI, level is synced from the PTU experience chart. */
  totalExp?: number
  /** Legacy/manual cache. The sheet UI derives this from totalExp and the PTU experience chart. */
  toNextLevel?: number
  gender?: 'Male' | 'Female' | 'Genderless' | string
  /** PTU Loyalty rank, normally tracked by the GM, from 0 to 6. */
  loyalty?: number
  shiny?: boolean
  /** Poké Ball used to capture this Pokémon. Legacy sheets omit this and display as Basic Ball. */
  caughtBall?: string
  /** Marks this sheet as broadly visible to players. */
  player?: boolean
  /** Private GM-only Pokémon metadata. Never expose this section to player clients. */
  gm?: CharacterSheetGm
  /** Runtime API marker: this private sheet is linked to the selected player profile. */
  playerProfileAccessible?: boolean
  /** Runtime API marker: this private sheet is visible through a legacy session grant. */
  sessionPlayerAccessible?: boolean

  /** PTU nature name, e.g. ``"Hardy"``, ``"Modest"``. */
  nature?: string
  /** Canonical Marsupial/Baby Template lifecycle marker. */
  babyTemplate?: boolean
  /** Irreversible Letter Press membership; combined sheets cannot act or spawn independently. */
  letterPressCombinedInto?: {
    ownerSheetSlug: string
    sourceOperationId: string
  }
  /** Irreversible Cube disassembly marker; this former construct cannot deploy or act as a Pokémon. */
  zygardeDisassembledIntoCells?: {
    trainerSlug: string
    cellCount: 10 | 50
    sourceOperationId: string
  }
  /** Cached/legacy Nature stat choices from the PTU Nature Chart. The renderer
   *  derives Nat +/- from `nature`, so these are not manually edited. */
  natureMod?: { plus?: StatKey; minus?: StatKey }

  /** Optional override of types and egg groups. Defaults come from species. */
  types?: string[]
  eggGroups?: string[]

  stats?: Partial<Record<StatKey, CharacterSheetStat>>
  /** Vitamins, stat suppressants, and related Pokémon nutrition/permanent stat items. */
  vitamins?: CharacterSheetVitaminTracking
  /** Non-stat stage-like modifiers, such as Accuracy. Stat stages live in `stats.*.stage`. */
  combatStages?: Partial<Record<CombatStageKey, number>>

  combat?: CharacterSheetCombat
  /** Active [Training] Feature currently applied to this Pokémon, such as Agility Training or Inspired Training. */
  activeTrainingFeature?: string
  /** Ace Trainer's current Trained Stat. The selected non-HP stat defaults to at least +1 Combat Stage until Extended Rest. */
  trainedStat?: PokemonTrainedStatKey
  items?: CharacterSheetItems
  weapon?: CharacterSheetWeapon

  tutorPoints?: CharacterSheetTutorPoints
  skillBackground?: CharacterSheetSkillBackground

  /** Dictionary keyed by level (``"20"``\u2026``"90"``) of inherited move names. */
  inheritedMoves?: Record<string, string>
  inheritedRemaining?: number

  movelist?: CharacterSheetMove[]
  /** Egg Moves this Pokémon has inherited or otherwise has available to learn. */
  eggMoves?: CharacterSheetMove[]
  /** TM/HM or Tutor moves manually recorded as applied to this Pokémon. */
  appliedMoves?: CharacterSheetAppliedMove[]
  /** Persistent Daily move frequency usage. EOT/Scene and per-Scene Daily locks are map-scoped. */
  moveUsage?: SheetMoveUsageState
  /** Lasting server-owned Daily ability usage for the current campaign day. */
  abilityUsage?: AbilityDailyUsageLedger
  /** Server-owned Daily/Weekly/hourly Capability resources. */
  capabilityUsage?: CapabilityUsageLedger
  /** Server-owned Poké Edge scene/day/target resources. */
  edgeUsage?: EdgeUsageLedger
  /** Durable Capability-owned shell/planter state advanced only by the authoritative campaign clock. */
  capabilityCampaignState?: CapabilityCampaignState
  /** Extended-Rest-bound Berry Storage digestion buffs. */
  berryStorage?: {
    schemaVersion: 1
    entries: Array<{
      id: string
      canonicalItemId: string
      canonicalItemName: string
      quantity: number
      lastTradedSceneId: string | null
    }>
  }

  /** Override capabilities. Defaults pull from species. */
  capabilities?: CharacterSheetCapabilities

  abilities?: CharacterSheetAbility[]
  edges?: CharacterSheetEdge[]

  /** Override skills. Defaults pull from species (mapped to skill keys). */
  skills?: CharacterSheetSkills

  /** Free-form party-context fields from the top of the spreadsheet. */
  scene?: { sceneXp?: number; pkmnCount?: number; modifiers?: number; newTotal?: number }
}
