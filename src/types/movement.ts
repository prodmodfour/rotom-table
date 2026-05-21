export type MovementCapabilityKey = 'overland' | 'sky' | 'swim' | 'levitate' | 'burrow' | 'teleporter'

export type ShiftMovementCapabilityKey = Exclude<MovementCapabilityKey, 'teleporter'>

export type MovementCapabilitySpeeds = Partial<Record<MovementCapabilityKey, number>>
