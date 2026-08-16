import { createHash } from 'node:crypto'

export const WONDER_LAUNCHER_DELIVERY_ACTION_ID = 'equipment.wonder-launcher.apply' as const

/**
 * Private declaration binding. It proves one exact equipped source without
 * transporting the serialized whole-item identity to a client projection.
 */
export const wonderLauncherDeliveryBindingId = (input: {
  readonly instanceId: string
  readonly instanceRevision: number
  readonly actorKind: 'trainer'
  readonly actorSlug: string
  readonly actorRevision: number
  readonly mapSlug: string
  readonly mapRevision: number
}): string => `equipment-delivery:v1:${createHash('sha256')
  .update(JSON.stringify({
    schemaVersion: 1,
    actionId: WONDER_LAUNCHER_DELIVERY_ACTION_ID,
    ...input,
  }))
  .digest('hex')
  .slice(0, 32)}`
