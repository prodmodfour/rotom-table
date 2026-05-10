export const APP_TITLE = 'Rotom Table'

export const referenceDetailTitle = (
  entryName: string | null | undefined,
  collectionLabel: string,
  missingLabel: string,
): string => (entryName ? `${entryName} · ${collectionLabel}` : `${missingLabel} · ${APP_TITLE}`)
