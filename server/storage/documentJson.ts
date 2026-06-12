import { normalizeRevision } from '#shared/sessionRevisions'

export const cloneStoredJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const stringifyStoredDocument = (document: unknown): string => {
  const json = JSON.stringify(document)
  if (json === undefined) throw new Error('Stored document must be JSON-serializable')
  return json
}

export const parseStoredDocumentJson = <TDocument = unknown>(json: string, label: string): TDocument => {
  try {
    return JSON.parse(json) as TDocument
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} document_json could not be parsed: ${message}`)
  }
}

export const parseStoredRevision = (value: unknown, label = 'revision'): number => {
  const revision = normalizeRevision(value)
  if (revision !== value) throw new Error(`${label} must be a safe non-negative integer revision`)
  return revision
}

export const parseStoredTimestamp = (value: unknown, label = 'updatedAt'): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe non-negative integer timestamp`)
  }
  return value
}
