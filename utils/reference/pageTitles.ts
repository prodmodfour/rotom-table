export const APP_TITLE = 'Rotom Table'

export const referenceIndexTitle = (collectionLabel: string): string => `${collectionLabel} · ${APP_TITLE}`

export const referenceDetailTitle = (
  entryName: string | null | undefined,
  collectionLabel: string,
  missingLabel: string,
): string => (entryName ? `${entryName} · ${collectionLabel}` : `${missingLabel} · ${APP_TITLE}`)
