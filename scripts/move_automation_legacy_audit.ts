import capabilitiesJson from '../data/move-automation/capabilities.json'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
} from '../src/utils/move-automation/registry'
import type {
  MoveAutomationAreaTemplateKind,
  MoveAutomationScript,
  MoveAutomationTargetMode,
} from '../src/types/moveAutomation'

export const LEGACY_MOVE_AUTOMATION_AUDIT_SCHEMA_VERSION = 1 as const

export const LEGACY_MOVE_AUTOMATION_SUGGESTION_KINDS = [
  'condition',
  'stage',
  'hp',
  'field',
  'hazard',
] as const

export type LegacyMoveAutomationSuggestionKind =
  (typeof LEGACY_MOVE_AUTOMATION_SUGGESTION_KINDS)[number]

export interface LegacyMoveAutomationScriptShape {
  readonly damageKind: string
  readonly requiresAccuracy: boolean
  readonly targetCount: number | null
  readonly areaTemplateKinds: readonly MoveAutomationAreaTemplateKind[]
  readonly targetBranchCount: number
  readonly randomStageKind: string | null
}

export interface LegacyMoveAutomationAuditEntry {
  readonly canonicalId: string
  readonly sourceModule: string
  readonly v1Version: number
  readonly scriptShape: LegacyMoveAutomationScriptShape
  readonly targetMode: MoveAutomationTargetMode
  readonly suggestionKinds: readonly LegacyMoveAutomationSuggestionKind[]
  readonly automationNotes: readonly string[]
  readonly inferredCapabilityHints: readonly string[]
}

export interface LegacyMoveAutomationAudit {
  readonly schemaVersion: typeof LEGACY_MOVE_AUTOMATION_AUDIT_SCHEMA_VERSION
  readonly generatedFrom: 'EXPLICIT_MOVE_AUTOMATION_SCRIPTS'
  readonly scope: string
  readonly entryCount: number
  readonly entries: readonly LegacyMoveAutomationAuditEntry[]
}

const compareCodePoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const capabilityCodes = new Set(
  capabilitiesJson.capabilities.map(capability => capability.code),
)

const sourceModuleByCanonicalId = (): ReadonlyMap<string, string> => {
  const modules = new Map<string, string>()
  for (const { sourceModule, scripts } of EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES) {
    for (const [canonicalId, script] of scripts) {
      if (canonicalId !== script.moveName) {
        throw new Error(
          `Legacy registry key ${JSON.stringify(canonicalId)} does not match script moveName ${JSON.stringify(script.moveName)}.`,
        )
      }
      const existing = modules.get(canonicalId)
      if (existing && existing !== sourceModule) {
        throw new Error(
          `Legacy registry entry ${JSON.stringify(canonicalId)} is attributed to both ${existing} and ${sourceModule}.`,
        )
      }
      modules.set(canonicalId, sourceModule)
    }
  }
  return modules
}

const uniqueSorted = <T extends string>(values: readonly T[]): T[] =>
  [...new Set(values)].sort(compareCodePoints)

const damageKind = (script: MoveAutomationScript): string => {
  if (script.directHpLoss) return `direct-hp-loss:${script.directHpLoss.kind}`
  if (script.dynamicDamageBase) return `dynamic-damage-base:${script.dynamicDamageBase.kind}`
  return script.damaging ? 'ordinary-damage' : 'none'
}

export const extractLegacyScriptShape = (
  script: MoveAutomationScript,
): LegacyMoveAutomationScriptShape => ({
  damageKind: damageKind(script),
  requiresAccuracy: script.requiresAccuracy,
  targetCount: script.targetCount,
  areaTemplateKinds: uniqueSorted(
    (script.areaTemplates ?? []).map(template => template.kind),
  ),
  targetBranchCount: script.targetBranches?.length ?? 0,
  randomStageKind: script.randomStageSuggestion?.kind ?? null,
})

export const extractLegacySuggestionKinds = (
  script: MoveAutomationScript,
): LegacyMoveAutomationSuggestionKind[] => {
  const kinds: LegacyMoveAutomationSuggestionKind[] = []
  if (script.conditionSuggestions.length > 0) kinds.push('condition')
  if (script.stageSuggestions.length > 0) kinds.push('stage')
  if (script.hpSuggestions.length > 0) kinds.push('hp')
  if (script.fieldSuggestions.length > 0) kinds.push('field')
  if (script.hazardSuggestions.length > 0) kinds.push('hazard')
  return kinds
}

const scriptRulesText = (script: MoveAutomationScript): string => [
  script.range,
  script.effect,
  script.special ?? '',
  ...script.automationNotes,
].join('\n')

const hasWeatherDependentHpSuggestion = (script: MoveAutomationScript): boolean =>
  script.hpSuggestions.some(suggestion =>
    suggestion.weatherPercentOverrides
    && Object.keys(suggestion.weatherPercentOverrides).length > 0,
  )

/**
 * Infer planning hints from structured v1 fields and reviewed notes. These are
 * deliberately non-authoritative: they identify likely review areas but never
 * promote semantic status or replace a rules review.
 */
export const inferLegacyCapabilityHints = (
  script: MoveAutomationScript,
): string[] => {
  const hints = new Set<string>(['targeting.authoritative'])
  const rulesText = scriptRulesText(script)

  if (script.conditionSuggestions.length > 0) hints.add('conditions.typed')
  if (script.stageSuggestions.length > 0 || script.randomStageSuggestion) hints.add('stages.typed')
  if (script.hpSuggestions.length > 0 || script.directHpLoss) hints.add('hp.typed')
  if (
    script.dynamicDamageBase
    || script.directHpLoss
    || script.randomStageSuggestion
    || hasWeatherDependentHpSuggestion(script)
  ) {
    hints.add('expressions.bounded')
  }
  if (script.fieldSuggestions.length > 0) hints.add('fields.typed')
  if (script.hazardSuggestions.length > 0) hints.add('hazards.typed')

  if (
    script.areaTemplates?.some(template => template.kind === 'pass')
    || /\b(?:push|pull|shift|teleport|recalled|send out|switch|move the (?:user|target)|moved to)\b/i.test(rulesText)
  ) {
    hints.add('movement.authoritative')
  }
  if (/\b(?:item|held items?|accessory slot|equipment slot|berry)\b/i.test(rulesText)) {
    hints.add('items.authoritative')
  }
  if (
    script.fieldSuggestions.length > 0
    || script.hazardSuggestions.length > 0
    || /\b(?:marker|blessing|coat|vortex|activations?|next turn|round ends?|end of (?:the )?target[’']s next turn|turn processing|dispel)\b/i.test(rulesText)
  ) {
    hints.add('lifecycle.effects')
  }
  if (/\b(?:consecutive|same-target|joining an encounter|once-per-scene|previous move|last move|history)\b/i.test(rulesText)) {
    hints.add('history.structured')
  }
  if (/\b(?:priority|interrupt|reaction|trigger|shield|opposed maneuver)\b/i.test(rulesText)) {
    hints.add('reactions.durable')
  }
  if (/\b(?:copy|copies|move list|random move|instruct)\b/i.test(rulesText)) {
    hints.add('nested-moves.reviewed')
  }
  if (/\b(?:transform|form|copy (?:the )?target[’']s types?|swap abilities)\b/i.test(rulesText)) {
    hints.add('transformations.reversible')
  }

  const inferred = [...hints].sort(compareCodePoints)
  const unknown = inferred.filter(code => !capabilityCodes.has(code))
  if (unknown.length > 0) {
    throw new Error(`Legacy audit inferred unknown capability codes: ${unknown.join(', ')}.`)
  }
  return inferred
}

export const buildLegacyMoveAutomationAudit = (): LegacyMoveAutomationAudit => {
  const sourceModules = sourceModuleByCanonicalId()
  const entries = [...EXPLICIT_MOVE_AUTOMATION_SCRIPTS]
    .map(([canonicalId, script]): LegacyMoveAutomationAuditEntry => {
      const sourceModule = sourceModules.get(canonicalId)
      if (!sourceModule) {
        throw new Error(`Legacy registry entry ${JSON.stringify(canonicalId)} has no source module attribution.`)
      }
      if (!Number.isInteger(script.version) || script.version < 1) {
        throw new Error(`Legacy registry entry ${JSON.stringify(canonicalId)} has an invalid v1 version.`)
      }
      return {
        canonicalId,
        sourceModule,
        v1Version: script.version,
        scriptShape: extractLegacyScriptShape(script),
        targetMode: script.targetMode,
        suggestionKinds: extractLegacySuggestionKinds(script),
        automationNotes: [...script.automationNotes],
        inferredCapabilityHints: inferLegacyCapabilityHints(script),
      }
    })
    .sort((left, right) => compareCodePoints(left.canonicalId, right.canonicalId))

  if (sourceModules.size !== entries.length) {
    throw new Error(
      `Legacy source registry contains ${sourceModules.size} entries but runtime registry contains ${entries.length}.`,
    )
  }

  return {
    schemaVersion: LEGACY_MOVE_AUTOMATION_AUDIT_SCHEMA_VERSION,
    generatedFrom: 'EXPLICIT_MOVE_AUTOMATION_SCRIPTS',
    scope: 'Non-authoritative review metadata only; semantic completion is not evaluated.',
    entryCount: entries.length,
    entries,
  }
}

const shapeSummary = (shape: LegacyMoveAutomationScriptShape): string => [
  `damage=${shape.damageKind}`,
  `accuracy=${shape.requiresAccuracy ? 'required' : 'not-required'}`,
  `target-count=${shape.targetCount ?? 'variable'}`,
  `areas=${shape.areaTemplateKinds.join(',') || 'none'}`,
  `branches=${shape.targetBranchCount}`,
  `random-stage=${shape.randomStageKind ?? 'none'}`,
].join('; ')

export const formatLegacyMoveAutomationAuditReport = (
  audit: LegacyMoveAutomationAudit,
): string => {
  const lines = [
    'Legacy move automation audit report',
    `Registry entries: ${audit.entryCount}`,
    audit.scope,
    'Capability hints are inferred planning aids, not reviewed capability tags.',
  ]

  for (const entry of audit.entries) {
    lines.push(
      '',
      entry.canonicalId,
      `  Source module: ${entry.sourceModule}`,
      `  V1 version: ${entry.v1Version}`,
      `  Target mode: ${entry.targetMode}`,
      `  Script shape: ${shapeSummary(entry.scriptShape)}`,
      `  Suggestion kinds: ${entry.suggestionKinds.join(', ') || 'none'}`,
      `  Inferred capability hints (non-authoritative): ${entry.inferredCapabilityHints.join(', ') || 'none'}`,
      '  Automation notes:',
    )
    if (entry.automationNotes.length === 0) {
      lines.push('    - none')
    }
    else {
      lines.push(...entry.automationNotes.map(note => `    - ${note}`))
    }
  }

  return `${lines.join('\n')}\n`
}
