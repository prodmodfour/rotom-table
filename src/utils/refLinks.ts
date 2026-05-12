import {
  describeRef,
  findAbility,
  findCapability,
  findCondition,
  findMove,
  type RefKind,
} from '~~/data/ptuReference'
import { referenceDetailPathOrNull } from '~/utils/reference/routes'

export type RefTooltipKind = Extract<RefKind, 'move' | 'ability' | 'capability' | 'condition'>

export interface RefTooltipMeta {
  label: string
  value: string | number
  badge?: 'type' | 'damage-class'
}

export interface RefTooltipSection {
  heading: string
  body: string
}

export interface RefTooltipDetail {
  kind: RefTooltipKind
  name: string
  meta: RefTooltipMeta[]
  sections: RefTooltipSection[]
}

export const refTargetPath = (kind: RefKind, slug: string | null): string | null =>
  referenceDetailPathOrNull(kind, slug)

export const describeRefTarget = (kind: RefKind, name: string) => {
  const descriptor = describeRef(kind, name)
  return {
    descriptor,
    targetPath: refTargetPath(kind, descriptor.slug),
  }
}

export const presentRefValue = <T extends string | number | null | undefined>(
  value: T,
): value is Exclude<T, null | undefined | ''> => value !== null && value !== undefined && value !== ''

export const getRefTooltipDetail = (kind: RefKind, name: string): RefTooltipDetail | null => {
  switch (kind) {
    case 'move': {
      const move = findMove(name)
      if (!move) return null
      const meta: RefTooltipMeta[] = []
      if (presentRefValue(move.type)) meta.push({ label: 'Type', value: move.type, badge: 'type' })
      if (presentRefValue(move.damage_class)) meta.push({ label: 'Class', value: move.damage_class, badge: 'damage-class' })
      if (presentRefValue(move.frequency)) meta.push({ label: 'Freq', value: move.frequency })
      if (move.damage_base !== null && move.damage_base !== undefined) meta.push({ label: 'DB', value: move.damage_base })
      if (presentRefValue(move.damage_roll)) meta.push({ label: 'Roll', value: move.damage_roll })
      if (move.ac !== null && move.ac !== undefined) meta.push({ label: 'AC', value: move.ac })
      if (presentRefValue(move.range)) meta.push({ label: 'Range', value: move.range })
      return {
        kind: 'move',
        name: move.name,
        meta,
        sections: presentRefValue(move.effect) ? [{ heading: 'Effect', body: move.effect }] : [],
      }
    }

    case 'ability': {
      const ability = findAbility(name)
      if (!ability) return null
      return {
        kind: 'ability',
        name: ability.name,
        meta: presentRefValue(ability.frequency) ? [{ label: 'Freq', value: ability.frequency }] : [],
        sections: [
          ...(presentRefValue(ability.trigger) ? [{ heading: 'Trigger', body: ability.trigger }] : []),
          ...(presentRefValue(ability.effect) ? [{ heading: 'Effect', body: ability.effect }] : []),
        ],
      }
    }

    case 'capability': {
      const capability = findCapability(name)
      if (!capability) return null
      return {
        kind: 'capability',
        name: capability.name,
        meta: [],
        sections: presentRefValue(capability.effect) ? [{ heading: 'Effect', body: capability.effect }] : [],
      }
    }

    case 'condition': {
      const condition = findCondition(name)
      if (!condition) return null
      const meta: RefTooltipMeta[] = []
      if (presentRefValue(condition.category)) meta.push({ label: 'Category', value: condition.category })
      if (presentRefValue(condition.source)) meta.push({ label: 'Source', value: condition.source })
      return {
        kind: 'condition',
        name: condition.name,
        meta,
        sections: presentRefValue(condition.effect) ? [{ heading: 'Effect', body: condition.effect }] : [],
      }
    }

    default:
      return null
  }
}
