import { moves } from '~/data/ptuReference'
import { conditionsFromText, normalizeConditionName } from '~/utils/statusConditions'
import type { CombatStageKey } from '~/types/combatStages'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type {
  MapFieldEffects,
  MapHazardKind,
  MapRoomKind,
  MapTerrainKind,
  MapWeatherKind,
} from '~/types/map'
import type {
  MoveAutomationConditionSuggestion,
  MoveAutomationFieldSuggestion,
  MoveAutomationHazardSuggestion,
  MoveAutomationHpSuggestion,
  MoveAutomationScript,
  MoveAutomationStageSuggestion,
  MoveAutomationTargetMode,
} from '~/types/moveAutomation'
import type { TrainerMove } from '~/types/trainerSheet'

export interface MoveAutomationMoveLike {
  name: string
  type?: string
  frequency?: string
  ac?: number | string | null
  damage_base?: number | null
  damage_roll?: string | null
  damage_class?: string | null
  range?: string
  effect?: string
}

export interface DamageRollResult {
  formula: string
  count: number
  sides: number
  mod: number
  rolls: number[]
  total: number
}

interface DamageBaseDef {
  db: number
  count: number
  sides: number
  mod: number
}

// PTU 1.05 damage-base table. Kept here (instead of the map component) so move
// scripts, the wizard, and future tests all resolve the same dice.
export const DAMAGE_BASE_TABLE: readonly DamageBaseDef[] = [
  { db: 1, count: 1, sides: 6, mod: 1 },
  { db: 2, count: 1, sides: 6, mod: 3 },
  { db: 3, count: 1, sides: 6, mod: 5 },
  { db: 4, count: 1, sides: 8, mod: 6 },
  { db: 5, count: 1, sides: 8, mod: 8 },
  { db: 6, count: 2, sides: 6, mod: 8 },
  { db: 7, count: 2, sides: 6, mod: 10 },
  { db: 8, count: 2, sides: 8, mod: 10 },
  { db: 9, count: 2, sides: 10, mod: 10 },
  { db: 10, count: 3, sides: 8, mod: 10 },
  { db: 11, count: 3, sides: 10, mod: 10 },
  { db: 12, count: 3, sides: 12, mod: 10 },
  { db: 13, count: 4, sides: 10, mod: 10 },
  { db: 14, count: 4, sides: 10, mod: 15 },
  { db: 15, count: 4, sides: 10, mod: 20 },
  { db: 16, count: 5, sides: 10, mod: 20 },
  { db: 17, count: 5, sides: 12, mod: 25 },
  { db: 18, count: 6, sides: 12, mod: 25 },
  { db: 19, count: 6, sides: 12, mod: 30 },
  { db: 20, count: 6, sides: 12, mod: 35 },
  { db: 21, count: 6, sides: 12, mod: 40 },
  { db: 22, count: 6, sides: 12, mod: 45 },
  { db: 23, count: 6, sides: 12, mod: 50 },
  { db: 24, count: 7, sides: 12, mod: 50 },
  { db: 25, count: 8, sides: 12, mod: 50 },
  { db: 26, count: 8, sides: 12, mod: 55 },
  { db: 27, count: 8, sides: 12, mod: 60 },
  { db: 28, count: 8, sides: 12, mod: 65 },
]

export const formatDamageBase = (db: number): string => {
  const def = DAMAGE_BASE_TABLE.find((entry) => entry.db === db)
  return def ? `${def.count}d${def.sides}+${def.mod}` : `DB ${db}`
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const asNumericAc = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || value === '--') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

const asDamageBase = (value: unknown): number | null => {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

export const sheetMoveToMoveLike = (move: CharacterSheetMove | TrainerMove): MoveAutomationMoveLike => ({
  name: move.name,
  type: move.type,
  frequency: move.frequency,
  ac: move.ac,
  damage_base: move.db ?? null,
  damage_roll: move.damageRoll ?? null,
  damage_class: move.category ?? null,
  range: move.range,
  effect: move.effect,
})

export const damageFormulaForMove = (move: MoveAutomationMoveLike): string | null => {
  const roll = typeof move.damage_roll === 'string' ? move.damage_roll.trim() : ''
  if (roll) return roll.split('/')[0]?.trim() || null
  const db = asDamageBase(move.damage_base)
  if (db == null) return null
  return formatDamageBase(db)
}

export const rollDamageFormula = (formula: string): DamageRollResult | null => {
  const match = formula.trim().match(/^(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i)
  if (!match) return null
  const count = Number(match[1])
  const sides = Number(match[2])
  const mod = match[3] ? Number(match[3].replace(/\s+/g, '')) : 0
  if (!Number.isInteger(count) || !Number.isInteger(sides) || count <= 0 || sides <= 0) return null
  const rolls: number[] = []
  for (let i = 0; i < count; i += 1) rolls.push(1 + Math.floor(Math.random() * sides))
  return {
    formula: `${count}d${sides}${mod >= 0 ? '+' : ''}${mod}`,
    count,
    sides,
    mod,
    rolls,
    total: rolls.reduce((sum, roll) => sum + roll, 0) + mod,
  }
}

const has = (haystack: string, needle: string | RegExp): boolean =>
  typeof needle === 'string' ? haystack.toLowerCase().includes(needle.toLowerCase()) : needle.test(haystack)

const splitRangeKeywords = (range: string): string[] =>
  range
    .split(/[,;]/g)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)

const determineTargetMode = (move: MoveAutomationMoveLike): MoveAutomationTargetMode => {
  const range = move.range ?? ''
  const effect = move.effect ?? ''
  const combined = `${range} ${effect}`
  const damaging = asDamageBase(move.damage_base) != null
  if (has(range, /\bHazard\b/i) || /Spikes|Sticky Web|Stealth Rock/.test(move.name)) return 'hazard'
  if (has(range, /\bField\b/i) || has(range, /\bWeather\b/i)) return 'field'
  if (has(range, /\bSelf\b/i) && !has(range, /\bTarget\b/i) && !has(range, /Burst|Cone|Line|Blast/i)) return 'self'
  if (has(range, /Burst|Cone|Line|Blast|all adjacent|all legal targets|all targets|\b[235]\s+Targets\b/i)) return 'multi-target'
  if (has(range, /\b1\s*Target\b|\bSingle Target\b|\bTarget\b|\bMelee\b|^\s*\d+\b/i)) return 'one-target'
  if (damaging) return 'one-target'
  if (has(combined, /target/i)) return 'one-target'
  return 'none'
}

const determineTargetCount = (move: MoveAutomationMoveLike, mode: MoveAutomationTargetMode): number | null => {
  if (mode === 'self' || mode === 'none' || mode === 'field' || mode === 'hazard') return mode === 'self' ? 1 : null
  const range = move.range ?? ''
  const countMatch = range.match(/\b([235])\s+Targets\b/i)
  if (countMatch) return Number(countMatch[1])
  if (/Double Strike/i.test(range)) return 1
  return mode === 'one-target' ? 1 : null
}

const statNameToKey = (raw: string): CombatStageKey | null => {
  const key = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (key === 'attack' || key === 'atk') return 'atk'
  if (key === 'defense' || key === 'defence' || key === 'def') return 'def'
  if (key === 'specialattack' || key === 'spattack' || key === 'spatk' || key === 'satk') return 'satk'
  if (key === 'specialdefense' || key === 'specialdefence' || key === 'spdefense' || key === 'spdef' || key === 'sdef') return 'sdef'
  if (key === 'speed' || key === 'spd') return 'spd'
  if (key === 'accuracy' || key === 'acc') return 'acc'
  return null
}

const stageKeyLabel = (key: CombatStageKey): string => {
  switch (key) {
    case 'atk': return 'Attack'
    case 'def': return 'Defense'
    case 'satk': return 'Special Attack'
    case 'sdef': return 'Special Defense'
    case 'spd': return 'Speed'
    case 'acc': return 'Accuracy'
  }
}

const parseStatsList = (raw: string): CombatStageKey[] => {
  const normalized = raw
    .replace(/both\s+/i, '')
    .replace(/each of (?:its|their|the user.s) stats/gi, 'Attack, Defense, Special Attack, Special Defense, Speed')
    .replace(/all (?:its |their )?stats/gi, 'Attack, Defense, Special Attack, Special Defense, Speed')
    .replace(/Special Attack/gi, 'SpecialAttack')
    .replace(/Special Defense/gi, 'SpecialDefense')
  const seen = new Set<CombatStageKey>()
  const out: CombatStageKey[] = []
  for (const part of normalized.split(/,| and | & |\//i)) {
    const key = statNameToKey(part.replace(/SpecialAttack/gi, 'Special Attack').replace(/SpecialDefense/gi, 'Special Defense'))
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

const effectThresholdNear = (text: string, index: number): string | undefined => {
  const nearby = text.slice(Math.max(0, index - 40), Math.min(text.length, index + 80))
  const numbered = nearby.match(/(?:on|On|roll of|rolled|Accuracy Check)\s+(?:a\s+)?(\d{1,2}\+|\d{1,2}-\d{1,2})/)
  if (numbered) return numbered[1]
  if (/Even-?Numbered/i.test(nearby)) return 'even roll'
  return undefined
}

const parseStageSuggestions = (effect: string): MoveAutomationStageSuggestion[] => {
  const out: MoveAutomationStageSuggestion[] = []
  const push = (recipient: 'user' | 'target', keys: CombatStageKey[], delta: number, label: string, index: number) => {
    const threshold = effectThresholdNear(effect, index)
    for (const key of keys) {
      out.push({
        recipient,
        key,
        delta,
        label: `${label}: ${delta > 0 ? '+' : ''}${delta} ${stageKeyLabel(key)} CS`,
        optional: Boolean(threshold) || /may|choose|can/i.test(label),
        threshold,
      })
    }
  }

  const patterns: Array<{
    regex: RegExp
    recipient: 'user' | 'target'
    sign: 1 | -1
  }> = [
    { regex: /(?:Raise|Raises|raised|gains?|receive)\s+(?:the\s+)?(?:user.s\s+|their\s+|its\s+)?([A-Za-z ,/&]+?)\s+(?:by\s+)?\+?(\d+)\s+(?:Combat Stages?|CS)/gi, recipient: 'user', sign: 1 },
    { regex: /(?:Lower|Lowers|lowered|lose|loses|receive)\s+(?:the\s+)?(?:user.s\s+|their\s+|its\s+)?([A-Za-z ,/&]+?)\s+(?:by\s+)?-?(\d+)\s+(?:Combat Stages?|CS)/gi, recipient: 'user', sign: -1 },
    { regex: /(?:target.s|targets.|foe.s|foes.|Legal Targets.|All Legal Targets.)\s+([A-Za-z ,/&]+?)\s+(?:is |are |have |has |stat is |stats are )?(?:lowered|lose|reduced)\s+(?:by\s+)?-?(\d+)\s+(?:Combat Stages?|CS)/gi, recipient: 'target', sign: -1 },
    { regex: /(?:target.s|targets.|foe.s|foes.|Legal Targets.|All Legal Targets.)\s+([A-Za-z ,/&]+?)\s+(?:is |are |have |has |stat is |stats are )?(?:raised|gain|gains|increased)\s+(?:by\s+)?\+?(\d+)\s+(?:Combat Stages?|CS)/gi, recipient: 'target', sign: 1 },
    { regex: /([A-Za-z ,/&]+?)\s+(?:is |are )?(?:lowered|reduced)\s+by\s+(\d+)\s+(?:Combat Stages?|CS)/gi, recipient: 'target', sign: -1 },
    { regex: /([A-Za-z ,/&]+?)\s+(?:is |are )?(?:raised|increased)\s+by\s+(\d+)\s+(?:Combat Stages?|CS)/gi, recipient: 'user', sign: 1 },
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.regex.exec(effect)) != null) {
      const keys = parseStatsList(match[1])
      if (!keys.length) continue
      const delta = Number(match[2]) * pattern.sign
      const label = normalizeWhitespace(match[0])
      const recipient = /target|foe|Legal Targets/i.test(match[0]) ? 'target' : pattern.recipient
      push(recipient, keys, delta, label, match.index)
    }
  }

  if (/each of its stats raised by \+?1 Combat Stage/i.test(effect) || /\+1 CS in all its stats/i.test(effect)) {
    push('user', ['atk', 'def', 'satk', 'sdef', 'spd'], 1, 'All stats raised', effect.search(/each of its stats|all its stats/i))
  }
  if (/Attack and Defense by \+1 Combat Stage each/i.test(effect)) {
    push('user', ['atk', 'def'], 1, 'Attack and Defense raised', effect.search(/Attack and Defense/i))
  }

  const key = (item: MoveAutomationStageSuggestion) => `${item.recipient}:${item.key}:${item.delta}:${item.threshold ?? ''}`
  return Array.from(new Map(out.map((item) => [key(item), item])).values())
}

const parseConditionSuggestions = (effect: string): MoveAutomationConditionSuggestion[] => {
  const conditions = conditionsFromText(effect)
  const out: MoveAutomationConditionSuggestion[] = []
  if (/cures? (?:all of )?(?:its|the user.s|the target.s|their)?\s*(?:Persistent or Volatile )?Status|cured of (?:all |any |a )?Status|cured of all Permanent and Volatile Statuses|All targets are cured of any Persistent Status/i.test(effect)) {
    const recipient = /target|All targets/i.test(effect) && !/user and any allies/i.test(effect) ? 'target' : 'user'
    out.push({
      recipient,
      condition: '*',
      action: 'clear',
      label: recipient === 'user' ? 'Clear user conditions' : 'Clear target conditions',
      optional: /choice|one status|may/i.test(effect),
    })
  }
  for (const condition of conditions) {
    const canonical = normalizeConditionName(condition) ?? condition
    const index = effect.toLowerCase().indexOf(canonical.toLowerCase().split(' ')[0])
    const threshold = index >= 0 ? effectThresholdNear(effect, index) : undefined
    const before = index >= 0 ? effect.slice(Math.max(0, index - 80), index) : ''
    const after = index >= 0 ? effect.slice(index, Math.min(effect.length, index + 100)) : ''
    const window = index >= 0 ? effect.slice(Math.max(0, index - 90), Math.min(effect.length, index + 120)) : effect
    const userish = /user|itself|the user/i.test(before) && !/target|foe/i.test(before.slice(-40))
    const recipient = /Rest/i.test(effect) && canonical === 'Sleep' ? 'user' : userish && /falls|becomes|is|cured/i.test(after) ? 'user' : 'target'
    const action = /cures?|cured|removes?/i.test(window) ? 'remove' : 'add'
    const contextualMention = /\bif\b|\bwhile\b|already|has been|have been|afflicted with|affected by|immune to|cannot Sleep|ignore the first turn/i.test(window)
    out.push({
      recipient,
      condition: canonical,
      action,
      label: threshold ? `${canonical} on ${threshold}` : canonical,
      threshold,
      optional: Boolean(threshold) || contextualMention || /may choose|may|can choose/i.test(window),
    })
  }
  return out
}

const parseHpSuggestions = (move: MoveAutomationMoveLike): MoveAutomationHpSuggestion[] => {
  const effect = move.effect ?? ''
  const range = move.range ?? ''
  const out: MoveAutomationHpSuggestion[] = []
  const name = move.name

  const add = (item: MoveAutomationHpSuggestion) => out.push(item)

  if (/user.s Hit Points (?:are|is) (?:reduced by|set to -?50%)/i.test(effect) || /user loses 1\/2|user loses .*half/i.test(effect)) {
    add({ recipient: 'user', mode: 'lose-percent-max', percent: 50, label: 'User loses 50% of Max HP' })
  }
  if (/user loses 1\/3rd|user loses 1\/3|loses 1\/3rd of their Max Hit Points/i.test(effect)) {
    add({ recipient: 'user', mode: 'lose-percent-max', percent: 33.333, label: 'User loses 1/3 Max HP' })
  }
  if (/loses Hit Points equal to [¼1\/4].*Max Hit Points|loses 1\/4 of their maximum Hit Points|loses 1\/4th of their Max Hit Points/i.test(effect)) {
    add({ recipient: 'user', mode: 'lose-percent-max', percent: 25, label: 'User loses 1/4 Max HP' })
  }
  if (/immediately Faints|lowers? (?:the )?user to 0 Hit Points|lowering its HP to 0/i.test(effect)) {
    add({ recipient: 'user', mode: 'set-zero', label: 'User HP becomes 0' })
  }

  const recoil = range.match(/Recoil\s+1\/(\d+)/i)
  if (recoil) {
    const denominator = Number(recoil[1])
    if (denominator > 0) add({ recipient: 'user', mode: 'lose-percent-max', percent: 100 / denominator, label: `Recoil ${recoil[0]}`, optional: true })
  }

  if (/target loses 1\/2 of their current Hit Points/i.test(effect)) {
    add({ recipient: 'target', mode: 'lose-percent-current', percent: 50, label: 'Target loses half current HP' })
  }
  if (/target loses Hit Points equal to the level/i.test(effect) || /target loses 15 Hit Points/i.test(effect) || /causes the target to lose 15 Hit Points/i.test(effect)) {
    const amount = /15 Hit Points/i.test(effect) ? 15 : undefined
    add({ recipient: 'target', mode: 'fixed-loss', amount, label: amount ? `Target loses ${amount} HP` : 'Target loses fixed HP (enter amount)' })
  }

  const selfHealHalf = /user regains Hit Points equal to half|user regains hit points equal to 50%|user is set to their full Hit Point value|user regains Hit Points equal to half of its full/i.test(effect)
  if (selfHealHalf || ['Recover', 'Heal Order', 'Slack Off', 'Roost', 'Moonlight', 'Morning Sun', 'Synthesis', 'Shore Up', 'Rest'].includes(name)) {
    add({ recipient: 'user', mode: 'heal-percent-max', percent: /full Hit Point value|full Hit Points/.test(effect) && /Rest/.test(name) ? 100 : 50, label: name === 'Rest' ? 'User heals to full HP' : 'User heals 50% Max HP', optional: /Sunny|Rainy|Sand|Hail|Grassy Terrain/i.test(effect) })
  }
  if (/target regains Hit Points equal to half|Restores 50% of the target.s max Hit Points|target recovers 50%/i.test(effect)) {
    add({ recipient: 'target', mode: 'heal-percent-max', percent: 50, label: 'Target heals 50% Max HP', optional: /may|instead|Grassy Terrain/i.test(effect) })
  }
  if (/regain Hit Points equal to 1\/4|regain hit points equal to 1\/4|recover a Tick/i.test(effect)) {
    add({ recipient: /target|allies|all allies/i.test(effect) ? 'target' : 'user', mode: 'heal-percent-max', percent: 25, label: 'Heal 1/4 Max HP', optional: true })
  }

  const seen = new Set<string>()
  return out.filter((item) => {
    const key = `${item.recipient}:${item.mode}:${item.percent ?? ''}:${item.amount ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const fieldSuggestion = (
  kind: 'weather' | 'terrain' | 'room',
  value: MapWeatherKind | MapTerrainKind | MapRoomKind,
  label: string,
  optional = false,
): MoveAutomationFieldSuggestion => ({ kind, value, label, optional })

const parseFieldSuggestions = (move: MoveAutomationMoveLike): MoveAutomationFieldSuggestion[] => {
  const name = move.name
  const effect = move.effect ?? ''
  const out: MoveAutomationFieldSuggestion[] = []
  if (name === 'Sunny Day') out.push(fieldSuggestion('weather', 'sunny', 'Set Sunny weather'))
  if (name === 'Rain Dance') out.push(fieldSuggestion('weather', 'rainy', 'Set Rainy weather'))
  if (name === 'Hail') out.push(fieldSuggestion('weather', 'hail', 'Set Hail weather'))
  if (name === 'Sandstorm') out.push(fieldSuggestion('weather', 'sandstorm', 'Set Sandstorm weather'))
  if (name === 'Electric Terrain' || /create Electric Terrain/i.test(effect)) out.push(fieldSuggestion('terrain', 'electric', 'Apply Electric Terrain', name !== 'Electric Terrain'))
  if (name === 'Grassy Terrain' || /create Grassy Terrain/i.test(effect)) out.push(fieldSuggestion('terrain', 'grassy', 'Apply Grassy Terrain', name !== 'Grassy Terrain'))
  if (name === 'Misty Terrain' || /Misty Terrain/i.test(effect) && /create|becomes|area becomes/i.test(effect)) out.push(fieldSuggestion('terrain', 'misty', 'Apply Misty Terrain', name !== 'Misty Terrain'))
  if (name === 'Psychic Terrain' || /create Psychic Terrain/i.test(effect)) out.push(fieldSuggestion('terrain', 'psychic', 'Apply Psychic Terrain', name !== 'Psychic Terrain'))
  if (name === 'Magic Room') out.push(fieldSuggestion('room', 'magic', 'Apply Magic Room'))
  if (name === 'Trick Room') out.push(fieldSuggestion('room', 'trick', 'Apply Trick Room'))
  if (name === 'Wonder Room') out.push(fieldSuggestion('room', 'wonder', 'Apply Wonder Room'))
  return out
}

const parseHazardSuggestions = (move: MoveAutomationMoveLike): MoveAutomationHazardSuggestion[] => {
  const name = move.name
  const out: MoveAutomationHazardSuggestion[] = []
  const push = (kind: MapHazardKind, squares: number, label: string) => out.push({ kind, squares, label })
  if (name === 'Spikes') push('spikes', 8, 'Place 8 Spikes squares')
  if (name === 'Toxic Spikes') push('toxic-spikes', 8, 'Place 8 Toxic Spikes squares')
  if (name === 'Sticky Web') push('sticky-web', 8, 'Place 8 Sticky Web squares')
  if (name === 'Stealth Rock') push('stealth-rock', 4, 'Place 4 Stealth Rock squares')
  if (name === 'Fire Pledge') out.push({ kind: 'fire', squares: 4, label: 'Optional Fire Pledge fire hazard squares', optional: true })
  return out
}

const parseCriticalRange = (effect: string): number | null => {
  const match = effect.match(/Critical Hit on (?:a )?(\d{1,2})\+/i)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

export const buildManualMoveResolution = (move: MoveAutomationMoveLike): MoveAutomationScript => {
  const effect = move.effect ?? ''
  const range = move.range ?? ''
  const damageBase = asDamageBase(move.damage_base)
  const damageClass = move.damage_class ?? null
  const targetMode = determineTargetMode(move)
  const keywords = splitRangeKeywords(range).filter((keyword) => !/^\d+$/.test(keyword) && !/1 Target|Single Target/i.test(keyword))
  const damaging = damageBase != null && damageClass !== 'Status' && damageClass !== 'Static'
  const requiresAccuracy = asNumericAc(move.ac) != null && (damaging || targetMode === 'one-target' || targetMode === 'multi-target')
  const conditionSuggestions = parseConditionSuggestions(effect)
  const stageSuggestions = parseStageSuggestions(effect)
  const hpSuggestions = parseHpSuggestions(move)
  const fieldSuggestions = parseFieldSuggestions(move)
  const hazardSuggestions = parseHazardSuggestions(move)
  const automationNotes: string[] = []

  if (!effect || /^None\.?$/i.test(effect.trim())) automationNotes.push('No secondary effect text in moves.json; resolve range keywords normally.')
  if (/may|choose|instead|Once (?:a|per) Scene|if |If |roll 1d|random|last Move|Move List|copy|Transform|switch|recalled|Grapple|Weight Class|Loyalty|Injury|Stockpiled|Trump|Perish|Substitute|Illusory|Barrier|Smokescreen|Court Change|Defog|Gravity|Tailwind|Haze|Wondered|Warped/i.test(effect)) {
    automationNotes.push('This move has conditional or unique text. The wizard exposes manual toggles; verify before applying.')
  }
  if (/Set-Up|Set Up|Execute|Priority|Interrupt|Reaction|Trigger|Shield|Full Action|Swift Action|Free Action|Exhaust/i.test(range)) {
    automationNotes.push('Timing/action keyword present; confirm this move is being resolved at the correct timing window.')
  }
  if (/Five Strike|Double Strike/i.test(range)) automationNotes.push('Multi-strike keyword present; enter the final damage after resolving strike count if needed.')
  if (/Blessing|Coat|Vortex|Leech Seed|Aqua Ring|Ingrain/i.test(effect)) automationNotes.push('Persistent non-sheet effect may need manual tracking after this transaction.')

  return {
    kind: 'manual-fallback',
    moveName: move.name,
    version: 1,
    targetMode,
    targetCount: determineTargetCount(move, targetMode),
    damaging,
    requiresAccuracy,
    damageBase,
    damageClass,
    type: move.type ?? 'Normal',
    ac: asNumericAc(move.ac),
    range,
    effect,
    keywords,
    criticalRange: parseCriticalRange(effect),
    conditionSuggestions,
    stageSuggestions,
    hpSuggestions,
    fieldSuggestions,
    hazardSuggestions,
    automationNotes,
  }
}

const defineExplicitMoveScript = (script: Omit<MoveAutomationScript, 'kind'>): MoveAutomationScript => ({
  ...script,
  kind: 'explicit',
})

/**
 * Human-authored move automation scripts. This registry is intentionally not
 * populated from moves.json. A move only counts as automated when an explicit
 * entry is added here (or moved into per-move modules later) and reviewed.
 */
export const EXPLICIT_MOVE_AUTOMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map<string, MoveAutomationScript>([
  // Example shape for future scripts:
  // ['Tackle', defineExplicitMoveScript({ ...buildManualMoveResolution(findMove('Tackle')!), ...move-specific steps })],
])

// Keep the helper referenced so TypeScript warns if its signature drifts while
// the explicit registry is still empty.
void defineExplicitMoveScript

export const moveAutomationCoverage = {
  canonicalMoveCount: moves.length,
  explicitScriptCount: EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size,
  missing: moves
    .filter((move) => !EXPLICIT_MOVE_AUTOMATION_SCRIPTS.has(move.name))
    .map((move) => move.name),
}

export const explicitScriptForMove = (moveName: string): MoveAutomationScript | null =>
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(moveName) ?? null

export const fieldEffectDamageBonus = (attackType: string, fieldEffects: MapFieldEffects | null | undefined): number => {
  let bonus = 0
  const weather = fieldEffects?.weather ?? []
  if (weather.some((effect) => effect.kind === 'sunny')) {
    if (attackType === 'Fire') bonus += 5
    if (attackType === 'Water') bonus -= 5
  }
  if (weather.some((effect) => effect.kind === 'rainy')) {
    if (attackType === 'Water') bonus += 5
    if (attackType === 'Fire') bonus -= 5
  }
  const terrains = fieldEffects?.terrains ?? []
  if (terrains.some((effect) => effect.kind === 'electric') && attackType === 'Electric') bonus += 10
  if (terrains.some((effect) => effect.kind === 'grassy') && attackType === 'Grass') bonus += 10
  if (terrains.some((effect) => effect.kind === 'psychic') && attackType === 'Psychic') bonus += 10
  if (terrains.some((effect) => effect.kind === 'misty') && attackType === 'Dragon') bonus -= 10
  return bonus
}
