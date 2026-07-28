import { effectThresholdNear, normalizeMoveAutomationWhitespace } from '~/utils/moveAutomationText'
import type { CombatStageKey } from '~/types/combatStages'
import type { MoveAutomationStageSuggestion } from '~/types/moveAutomation'

export const moveAutomationStatNameToKey = (raw: string): CombatStageKey | null => {
  const key = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (key === 'attack' || key === 'atk') return 'atk'
  if (key === 'defense' || key === 'defence' || key === 'def') return 'def'
  if (key === 'specialattack' || key === 'spattack' || key === 'spatk' || key === 'satk') return 'satk'
  if (key === 'specialdefense' || key === 'specialdefence' || key === 'spdefense' || key === 'spdef' || key === 'sdef') return 'sdef'
  if (key === 'speed' || key === 'spd') return 'spd'
  if (key === 'accuracy' || key === 'acc') return 'acc'
  return null
}

export const moveAutomationStageKeyLabel = (key: CombatStageKey): string => {
  switch (key) {
    case 'atk': return 'Attack'
    case 'def': return 'Defense'
    case 'satk': return 'Special Attack'
    case 'sdef': return 'Special Defense'
    case 'spd': return 'Speed'
    case 'acc': return 'Accuracy'
  }
}

export const parseMoveAutomationStatsList = (raw: string): CombatStageKey[] => {
  const normalized = raw
    .replace(/both\s+/i, '')
    .replace(/each of (?:its|their|the user.s) stats/gi, 'Attack, Defense, Special Attack, Special Defense, Speed')
    .replace(/all (?:its |their )?stats/gi, 'Attack, Defense, Special Attack, Special Defense, Speed')
    .replace(/Special Attack/gi, 'SpecialAttack')
    .replace(/Special Defense/gi, 'SpecialDefense')
  const seen = new Set<CombatStageKey>()
  const out: CombatStageKey[] = []
  for (const part of normalized.split(/,| and | & |\//i)) {
    const key = moveAutomationStatNameToKey(part.replace(/SpecialAttack/gi, 'Special Attack').replace(/SpecialDefense/gi, 'Special Defense'))
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export const parseMoveAutomationStageSuggestions = (effect: string): MoveAutomationStageSuggestion[] => {
  const out: MoveAutomationStageSuggestion[] = []
  const push = (recipient: 'user' | 'target', keys: CombatStageKey[], delta: number, label: string, index: number) => {
    const threshold = effectThresholdNear(effect, index)
    for (const key of keys) {
      out.push({
        recipient,
        key,
        delta,
        label: `${label}: ${delta > 0 ? '+' : ''}${delta} ${moveAutomationStageKeyLabel(key)} CS`,
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
      const keys = parseMoveAutomationStatsList(match[1] ?? '')
      if (!keys.length) continue
      const delta = Number(match[2]) * pattern.sign
      const label = normalizeMoveAutomationWhitespace(match[0])
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
