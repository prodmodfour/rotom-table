export const abilityMechanicOperation = (
  id: string,
  mechanicId: string,
  config: Record<string, unknown>,
) => ({ kind: 'ability-mechanic', id, mechanicId, config })

export const abilityPresentation = (canonicalId: string, tags: string[]) => ({
  displayName: canonicalId,
  summaryKey: `ability.${canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.summary`,
  vfxKey: null,
  tags,
})

export const noAbilityTarget = (modeId: string) => [{
  id: `${modeId}.none`, modeId, kind: 'none', minSelections: 0, maxSelections: 0,
  selector: null, predicate: null,
}]

export const moveAbilityTarget = (modeId: string) => [{
  id: `${modeId}.move`, modeId, kind: 'move', minSelections: 1, maxSelections: 1,
  selector: null, predicate: null,
}]

export const reviewedAbilitySpec = (input: {
  canonicalId: string
  modes: Record<string, unknown>[]
  subscriptions?: Record<string, unknown>[]
  targeting: Record<string, unknown>[]
  phases: Record<string, unknown>[]
  tags: string[]
}) => ({
  schemaVersion: 1,
  canonicalId: input.canonicalId,
  version: 1,
  modes: input.modes,
  subscriptions: input.subscriptions ?? [],
  targeting: input.targeting,
  preconditions: [],
  costs: [],
  phases: input.phases,
  registeredHandlerId: null,
  presentation: abilityPresentation(input.canonicalId, input.tags),
})

export const reviewedStaticAbilitySpec = (
  canonicalId: string,
  mechanicId: string,
  config: Record<string, unknown>,
  tags: string[],
) => reviewedAbilitySpec({
  canonicalId,
  modes: [{ id: 'passive', kind: 'static' }],
  targeting: noAbilityTarget('passive'),
  phases: [{
    modeId: 'passive', phase: 'effect',
    operations: [abilityMechanicOperation('passive.mechanic', mechanicId, config)],
  }],
  tags,
})

export const reviewedActivatedAbilitySpec = (
  canonicalId: string,
  mechanicId: string,
  config: Record<string, unknown>,
  targeting: Record<string, unknown>[] = noAbilityTarget('activate'),
  tags: string[] = [],
) => reviewedAbilitySpec({
  canonicalId,
  modes: [{ id: 'activate', kind: 'activated' }],
  targeting,
  phases: [{
    modeId: 'activate', phase: 'effect',
    operations: [abilityMechanicOperation('activate.mechanic', mechanicId, config)],
  }],
  tags,
})

export const reviewedTriggeredAbilitySpec = (input: {
  canonicalId: string
  mechanicId: string
  config: Record<string, unknown>
  eventKind: string
  checkpoint: string
  predicate: Record<string, unknown>
  tags: string[]
  oncePerCausalChain?: boolean
}) => reviewedAbilitySpec({
  canonicalId: input.canonicalId,
  modes: [{ id: 'trigger', kind: 'triggered' }],
  subscriptions: [{
    id: 'trigger.subscription', modeId: 'trigger', eventKind: input.eventKind,
    checkpoint: input.checkpoint, response: 'optional', priority: 0,
    oncePerCausalChain: input.oncePerCausalChain ?? true, predicate: input.predicate,
  }],
  targeting: noAbilityTarget('trigger'),
  phases: [{
    modeId: 'trigger', phase: 'effect',
    operations: [abilityMechanicOperation('trigger.mechanic', input.mechanicId, input.config)],
  }],
  tags: input.tags,
})
