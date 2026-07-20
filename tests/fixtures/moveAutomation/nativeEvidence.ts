const IGNORED_EVIDENCE_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'is', 'move', 'of', 'on', 'the', 'to', 'type',
])

/** Legacy prose assertions migrate to equivalent structured v2 trace tokens. */
export const assertReviewedNativeEvidenceFragments = (
  searchable: string,
  fragments: readonly string[],
): void => {
  const evidence = searchable.toLowerCase()
  for (const fragment of fragments) {
    const words: readonly string[] = fragment.toLowerCase().match(/[a-z0-9]+/g) ?? []
    const expectsImmunity = words.includes('immunity')
    const tokens = words.filter(token => (
      token !== 'immunity' && !IGNORED_EVIDENCE_WORDS.has(token)
    ))
    for (const token of tokens) {
      if (!evidence.includes(token)) {
        throw new Error(`Expected structured native evidence for ${JSON.stringify(fragment)} to contain token ${JSON.stringify(token)}.`)
      }
    }
    if (
      expectsImmunity
      && !evidence.includes('immune')
      && !evidence.includes('"outcome":"prevented"')
      && !evidence.includes('"finalmultiplier":0')
    ) {
      throw new Error(`Expected structured native immunity evidence for ${JSON.stringify(fragment)}.`)
    }
  }
}

interface NativeSmiteEvidence {
  readonly rollLedger: readonly {
    readonly parentEffectId: string
    readonly reason: string
  }[]
  readonly auditTrace: { readonly events: readonly unknown[] }
}

/** Certify native Smite miss damage and its one-step resistance without relying on retired prose logs. */
export const assertReviewedNativeSmiteMissEvidence = (
  resolution: NativeSmiteEvidence,
  targetId: string,
): void => {
  const damageRoll = resolution.rollLedger.find(entry => (
    entry.parentEffectId.endsWith('.damage') && entry.reason.includes(targetId)
  ))
  if (!damageRoll) throw new Error(`Expected a native Smite damage roll for ${targetId}.`)

  const event = resolution.auditTrace.events.find((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false
    const value = candidate as Record<string, unknown>
    return value.kind === 'operation'
      && value.operationKind === 'damage'
      && Array.isArray(value.recipientIds)
      && value.recipientIds.includes(targetId)
  }) as Record<string, unknown> | undefined
  if (!event) throw new Error(`Expected a native Smite damage trace for ${targetId}.`)

  const result = event.result as { readonly recipients?: readonly {
    readonly recipientId?: string
    readonly outcome?: string
  }[] } | undefined
  const recipient = result?.recipients?.find(candidate => candidate.recipientId === targetId)
  if (
    recipient?.outcome !== 'applied'
    || !JSON.stringify(recipient).includes('damage.smite-miss-resistance-step')
  ) {
    throw new Error(`Expected native Smite damage for ${targetId} to apply one additional resistance step.`)
  }
}
