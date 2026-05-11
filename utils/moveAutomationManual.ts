import { formatMoveDamageBase } from '~/utils/moveDamageBase'
import { coerceMoveAccuracy, coerceMoveDamageBase } from '~/utils/moveAutomationCoercion'
import { parseMoveAutomationStageSuggestions } from '~/utils/moveAutomationStages'
import {
  effectThresholdNear,
  normalizeMoveAutomationWhitespace as normalizeWhitespace,
  splitMoveRangeKeywords as splitRangeKeywords,
  textIncludes as has,
} from '~/utils/moveAutomationText'
import { conditionsFromText, normalizeConditionName } from '~/utils/statusConditions'
import type {
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
  MoveAutomationTargetMode,
} from '~/types/moveAutomation'
import type { MoveAutomationMoveLike } from '~/utils/moveAutomation'

const determineTargetMode = (move: MoveAutomationMoveLike): MoveAutomationTargetMode => {
  const range = move.range ?? ''
  const effect = move.effect ?? ''
  const combined = `${range} ${effect}`
  const damaging = coerceMoveDamageBase(move.damage_base) != null
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

  if (/user.s Hit Points (?:are|is) (?:reduced by|set to -?50%)|user loses 1\/2|user loses .*half/i.test(effect)) {
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

export const createManualMoveAutomationScript = (move: MoveAutomationMoveLike): MoveAutomationScript => {
  const effect = move.effect ?? ''
  const range = move.range ?? ''
  const damageBase = coerceMoveDamageBase(move.damage_base)
  const damageClass = move.damage_class ?? null
  const targetMode = determineTargetMode(move)
  const keywords = splitRangeKeywords(range).filter((keyword) => !/^\d+$/.test(keyword) && !/1 Target|Single Target/i.test(keyword))
  const damaging = damageBase != null && damageClass !== 'Status' && damageClass !== 'Static'
  const requiresAccuracy = coerceMoveAccuracy(move.ac) != null && (damaging || targetMode === 'one-target' || targetMode === 'multi-target')
  const conditionSuggestions = parseConditionSuggestions(effect)
  const stageSuggestions = parseMoveAutomationStageSuggestions(effect)
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
    ac: coerceMoveAccuracy(move.ac),
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

export const damageFormulaForManualMove = (move: MoveAutomationMoveLike): string | null => {
  const roll = typeof move.damage_roll === 'string' ? move.damage_roll.trim() : ''
  if (roll) return roll.split('/')[0]?.trim() || null
  const db = coerceMoveDamageBase(move.damage_base)
  if (db == null) return null
  return formatMoveDamageBase(db)
}
