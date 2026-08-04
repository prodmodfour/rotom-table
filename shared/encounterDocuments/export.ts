import { parseEncounterDocument, type EncounterDocument } from './model'

export const ENCOUNTER_DOCUMENT_EXPORT_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_DOCUMENT_EXPORT_FORMAT = 'rotom-table.encounter-document' as const

export interface EncounterDocumentExport {
  readonly schemaVersion: typeof ENCOUNTER_DOCUMENT_EXPORT_SCHEMA_VERSION
  readonly format: typeof ENCOUNTER_DOCUMENT_EXPORT_FORMAT
  readonly exportedAt: number
  readonly documentSha256: string
  readonly document: EncounterDocument
}

export const parseEncounterDocumentExport = (value: unknown): EncounterDocumentExport => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Encounter export must be an object.')
  const root = value as Record<string, unknown>
  const keys = ['schemaVersion', 'format', 'exportedAt', 'documentSha256', 'document']
  if (Object.keys(root).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(root, key))) {
    throw new Error('Encounter export has unsupported or missing fields.')
  }
  if (root.schemaVersion !== ENCOUNTER_DOCUMENT_EXPORT_SCHEMA_VERSION || root.format !== ENCOUNTER_DOCUMENT_EXPORT_FORMAT) {
    throw new Error('Encounter export format is unsupported.')
  }
  if (!Number.isSafeInteger(root.exportedAt) || Number(root.exportedAt) < 0) throw new Error('Encounter export timestamp is invalid.')
  if (typeof root.documentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(root.documentSha256)) throw new Error('Encounter export digest is invalid.')
  return Object.freeze({
    schemaVersion: ENCOUNTER_DOCUMENT_EXPORT_SCHEMA_VERSION,
    format: ENCOUNTER_DOCUMENT_EXPORT_FORMAT,
    exportedAt: Number(root.exportedAt),
    documentSha256: root.documentSha256,
    document: parseEncounterDocument(root.document),
  })
}
