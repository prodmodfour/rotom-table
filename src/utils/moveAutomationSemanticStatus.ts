import capabilityCatalogJson from '~~/data/move-automation/capabilities.json'
import menuStatusJson from '~~/data/move-automation/menu-status.json'
import type {
  MoveAutomationBaseStatus,
  MoveAutomationInteractionStatus,
  MoveAutomationManifestDebt,
  MoveAutomationRuntimeKind,
} from '#shared/moveAutomation/manifest'
import type {
  MoveAutomationCapabilityImplementationStatus,
  MoveAutomationCapabilityPhase,
} from '#shared/moveAutomation/capabilities'

export type MoveAutomationStatusDetailKind = 'blocker' | 'limitation' | 'manual-step'

export interface MoveAutomationStatusDetail {
  readonly kind: MoveAutomationStatusDetailKind
  readonly label: string
  readonly code: string
  readonly summary: string
}

/** Bounded, presentation-safe projection of one reviewed semantic manifest row. */
export interface MoveAutomationSemanticStatus {
  readonly canonicalId: string | null
  readonly baseStatus: MoveAutomationBaseStatus
  readonly baseStatusLabel: string
  readonly interactionStatus: MoveAutomationInteractionStatus
  readonly interactionStatusLabel: string
  readonly runtimeKind: MoveAutomationRuntimeKind
  readonly blockerCodes: readonly string[]
  readonly limitations: readonly MoveAutomationManifestDebt[]
  readonly manualSteps: readonly MoveAutomationManifestDebt[]
  readonly details: readonly MoveAutomationStatusDetail[]
}

interface ManifestStatusRow {
  readonly canonicalId: string
  readonly displayName: string
  readonly baseStatus: MoveAutomationBaseStatus
  readonly interactionStatus: MoveAutomationInteractionStatus
  readonly runtimeKind: MoveAutomationRuntimeKind
  readonly blockerCodes: readonly string[]
  readonly limitations: readonly MoveAutomationManifestDebt[]
  readonly manualSteps: readonly MoveAutomationManifestDebt[]
}

interface CapabilityStatusRow {
  readonly code: string
  readonly owningPhase: MoveAutomationCapabilityPhase
  readonly implementationStatus: MoveAutomationCapabilityImplementationStatus
}

const BASE_STATUS_LABELS: Readonly<Record<MoveAutomationBaseStatus, string>> = Object.freeze({
  complete: 'Complete',
  assisted: 'Assisted',
  blocked: 'Blocked',
})

const INTERACTION_STATUS_LABELS: Readonly<Record<MoveAutomationInteractionStatus, string>> = Object.freeze({
  unassessed: 'Unassessed',
  partial: 'Partial',
  complete: 'Complete',
})

const manifestRows = (menuStatusJson as unknown as { readonly moves: readonly ManifestStatusRow[] }).moves
const capabilityRows = (
  capabilityCatalogJson as unknown as { readonly capabilities: readonly CapabilityStatusRow[] }
).capabilities
const capabilityByCode = new Map(capabilityRows.map((capability) => [capability.code, capability]))

const normalizedMoveName = (value: string): string => value.trim().toLowerCase()

const titleCaseWords = (value: string): string => value
  .split(/[-_]/g)
  .filter(Boolean)
  .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
  .join(' ')

const capabilityLabel = (code: string): string => code
  .split('.')
  .map(titleCaseWords)
  .join(' · ')

const phaseLabel = (phase: MoveAutomationCapabilityPhase): string => {
  const suffix = phase.replace(/^phase-/, '')
  return `Phase ${suffix.toUpperCase()}`
}

const capabilityBlockerSummary = (code: string): string => {
  const capability = capabilityByCode.get(code)
  const label = capabilityLabel(code)
  if (!capability) return `${label} blocks reviewed automation.`
  return capability.implementationStatus === 'planned'
    ? `${label} is planned for ${phaseLabel(capability.owningPhase)}.`
    : `${label} is implemented but remains a reviewed blocker.`
}

const cloneDebt = (entries: readonly MoveAutomationManifestDebt[]): readonly MoveAutomationManifestDebt[] => Object.freeze(
  entries.map((entry) => Object.freeze({ code: entry.code, summary: entry.summary })),
)

const detail = (
  kind: MoveAutomationStatusDetailKind,
  label: string,
  code: string,
  summary: string,
): MoveAutomationStatusDetail => Object.freeze({ kind, label, code, summary })

const statusForRow = (row: ManifestStatusRow): MoveAutomationSemanticStatus => {
  const blockerCodes = Object.freeze([...row.blockerCodes])
  const limitations = cloneDebt(row.limitations)
  const manualSteps = cloneDebt(row.manualSteps)
  const details = Object.freeze([
    ...blockerCodes.map((code) => detail('blocker', 'Capability blocker', code, capabilityBlockerSummary(code))),
    ...limitations.map((entry) => detail('limitation', 'Limitation', entry.code, entry.summary)),
    ...manualSteps.map((entry) => detail('manual-step', 'Manual step', entry.code, entry.summary)),
  ])

  return Object.freeze({
    canonicalId: row.canonicalId,
    baseStatus: row.baseStatus,
    baseStatusLabel: BASE_STATUS_LABELS[row.baseStatus],
    interactionStatus: row.interactionStatus,
    interactionStatusLabel: INTERACTION_STATUS_LABELS[row.interactionStatus],
    runtimeKind: row.runtimeKind,
    blockerCodes,
    limitations,
    manualSteps,
    details,
  })
}

const statusByMoveName = new Map<string, MoveAutomationSemanticStatus>()
for (const row of manifestRows) {
  const status = statusForRow(row)
  statusByMoveName.set(normalizedMoveName(row.canonicalId), status)
  statusByMoveName.set(normalizedMoveName(row.displayName), status)
}

const UNREVIEWED_MOVE_STATUS: MoveAutomationSemanticStatus = Object.freeze({
  canonicalId: null,
  baseStatus: 'blocked',
  baseStatusLabel: BASE_STATUS_LABELS.blocked,
  interactionStatus: 'unassessed',
  interactionStatusLabel: INTERACTION_STATUS_LABELS.unassessed,
  runtimeKind: 'unimplemented',
  blockerCodes: Object.freeze(['catalog.unreviewed']),
  limitations: Object.freeze([]),
  manualSteps: Object.freeze([]),
  details: Object.freeze([
    detail(
      'blocker',
      'Catalog blocker',
      'catalog.unreviewed',
      'This move has no reviewed semantic automation record.',
    ),
  ]),
})

/** Resolve only canonical manifest rows; unknown/custom names return null. */
export const findMoveAutomationSemanticStatus = (
  moveName: string | null | undefined,
): MoveAutomationSemanticStatus | null => {
  if (typeof moveName !== 'string') return null
  const key = normalizedMoveName(moveName)
  return key ? statusByMoveName.get(key) ?? null : null
}

/** Resolve menu state, failing closed for unknown/custom move names. */
export const moveAutomationSemanticStatusForMenu = (
  moveName: string | null | undefined,
): MoveAutomationSemanticStatus => findMoveAutomationSemanticStatus(moveName) ?? UNREVIEWED_MOVE_STATUS

export const moveAutomationStatusDetailsText = (
  status: MoveAutomationSemanticStatus,
): string => status.details
  .map((entry) => `${entry.label} ${entry.code}: ${entry.summary}`)
  .join(' ')
