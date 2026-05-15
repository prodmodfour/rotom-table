import { formatCombatStage } from '~/utils/combatStageStats'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import type { RefTooltipDetail, RefTooltipMeta, RefTooltipSection } from '~/utils/refLinks'

const hasTooltipValue = (value: string | number | null | undefined): value is string | number =>
  value !== null && value !== undefined && value !== ''

const addMeta = (
  meta: RefTooltipMeta[],
  label: string,
  value: string | number | null | undefined,
  badge?: RefTooltipMeta['badge'],
) => {
  if (!hasTooltipValue(value)) return
  meta.push(badge ? { label, value, badge } : { label, value })
}

const formatStageAdjustedStat = (
  label: string | null,
  base: number | null,
  stage: number | null,
  current: number | null,
): string | null => {
  if (stage == null || base == null || current == null) return null
  const statLabel = label ? `${label} ` : ''
  if (stage === 0) return `${statLabel}${current}`
  return `${statLabel}${base} @ ${formatCombatStage(stage)} CS → ${current}`
}

export const formatTokenMoveAttackStat = (move: TokenMoveMenuOption): string | null => {
  const normalCurrent = move.attackStat == null
    ? null
    : move.attackStatAbility ? move.attackStat - (move.additionalAttackStat ?? 0) : move.attackStat
  const normal = formatStageAdjustedStat(move.attackStatLabel, move.baseAttackStat, move.attackStage, normalCurrent)
  if (!normal || !move.attackStatAbility) return normal

  const additional = formatStageAdjustedStat(
    move.additionalAttackStatLabel,
    move.additionalBaseAttackStat,
    move.additionalAttackStage,
    move.additionalAttackStat,
  )
  return additional ? `${normal} + ${additional} (${move.attackStatAbility}) → ${move.attackStat}` : `${normal} (${move.attackStatAbility})`
}

const buildSheetSpecificLines = (move: TokenMoveMenuOption): string[] => {
  const lines: string[] = []
  if (move.damageFormula) lines.push(`Damage: ${move.damageFormula}`)
  const attackStat = formatTokenMoveAttackStat(move)
  if (attackStat) lines.push(`Attack Stat: ${attackStat}`)
  if (move.hasStab) lines.push('STAB: +2 DB included')
  if (move.automatic) lines.push('Source: Automatic Struggle Attack')
  return lines
}

const buildTooltipSections = (move: TokenMoveMenuOption): RefTooltipSection[] => {
  const sheetLines = buildSheetSpecificLines(move)
  return [
    ...(sheetLines.length ? [{ heading: 'Sheet', body: sheetLines.join('\n') }] : []),
    ...(move.effect ? [{ heading: 'Effect', body: move.effect }] : []),
    ...(move.special ? [{ heading: 'Special', body: move.special }] : []),
  ]
}

export const buildTokenMoveTooltipDetail = (move: TokenMoveMenuOption): RefTooltipDetail => {
  const meta: RefTooltipMeta[] = []
  addMeta(meta, 'Type', move.type, 'type')
  addMeta(meta, 'Class', move.damageClass, 'damage-class')
  addMeta(meta, 'Freq', move.frequency)
  addMeta(meta, 'DB', move.damageBase)
  addMeta(meta, 'AC', move.ac)
  addMeta(meta, 'Range', move.range)

  return {
    kind: 'move',
    name: move.name,
    meta,
    sections: buildTooltipSections(move),
  }
}
