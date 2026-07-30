export const MOVE_ATTACK_SOURCE_ID_PREFIX = 'attack-source.v1.' as const
export const MOVE_ATTACK_SOURCE_ID_HEX_LENGTH = 64 as const

const MOVE_ATTACK_SOURCE_ID_PATTERN = /^attack-source\.v1\.[0-9a-f]{64}$/u

/** Opaque presentation selector. It carries no authority until revalidated. */
export type MoveAttackSourceId = `${typeof MOVE_ATTACK_SOURCE_ID_PREFIX}${string}`

export const isMoveAttackSourceId = (value: unknown): value is MoveAttackSourceId => (
  typeof value === 'string' && MOVE_ATTACK_SOURCE_ID_PATTERN.test(value)
)

export const parseMoveAttackSourceId = (value: unknown): MoveAttackSourceId | null => (
  isMoveAttackSourceId(value) ? value : null
)
