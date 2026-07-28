import { createHash } from 'node:crypto'
import type { AbilityAutomationManifest } from '#shared/abilityAutomation/manifest'

/**
 * Bind interaction certification to every executable base row without creating
 * a cycle through the interaction status being certified.
 */
export const abilityAutomationInteractionReviewSha256 = (
  manifest: AbilityAutomationManifest,
): string => createHash('sha256').update(JSON.stringify(manifest.abilities.map(record => ({
  canonicalId: record.canonicalId,
  baseStatus: record.baseStatus,
  runtime: record.runtime,
  rulesProvenance: record.rulesProvenance,
  capabilityTags: record.capabilityTags,
  conformanceEvidence: record.conformanceEvidence,
}))), 'utf8').digest('hex')
