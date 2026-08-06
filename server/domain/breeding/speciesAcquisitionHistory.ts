import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingSpeciesAcquisitionArchiveRecordV1,
  type BreedingSpeciesAcquisitionArchiveRecordV1,
} from '#shared/speciesAcquisitionHistory'

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

const withoutDefinitionHash = (
  value: BreedingSpeciesAcquisitionArchiveRecordV1,
): Omit<BreedingSpeciesAcquisitionArchiveRecordV1, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}

export const parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1 = (
  value: unknown,
  path = 'speciesAcquisition',
): BreedingSpeciesAcquisitionArchiveRecordV1 => {
  const record = parseBreedingSpeciesAcquisitionArchiveRecordV1(value, path)
  if (sha256(withoutDefinitionHash(record)) !== record.definitionSha256) {
    throw new Error(`${path}.definitionSha256 does not match its authoritative definition.`)
  }
  return record
}

export const createBreedingSpeciesAcquisitionArchiveRecordV1 = (
  value: Omit<BreedingSpeciesAcquisitionArchiveRecordV1, 'schemaVersion' | 'definitionSha256'>,
): BreedingSpeciesAcquisitionArchiveRecordV1 => {
  const definition = { schemaVersion: 1 as const, ...value }
  return parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}
