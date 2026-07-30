export type TrackerScentBranch = 'familiar' | 'random' | 'specific'

export interface TrackerScentSelection {
  readonly branch: TrackerScentBranch
  readonly preyIdentity: string | null
}

const TRACKER_SELECTION_PATTERN = /^(familiar|random|specific)(?:;prey:([A-Za-z0-9][A-Za-z0-9._:/%-]{0,159}))?$/

export const parseTrackerScentSelection = (value: string | null): TrackerScentSelection | null => {
  const match = TRACKER_SELECTION_PATTERN.exec(value ?? '')
  if (!match) return null
  return Object.freeze({
    branch: match[1] as TrackerScentBranch,
    preyIdentity: match[2] ?? null,
  })
}

export const trackerScentSelectionId = (
  branch: TrackerScentBranch,
  preyIdentity: string,
): string | null => /^[A-Za-z0-9][A-Za-z0-9._:/%-]{0,159}$/.test(preyIdentity)
  ? `${branch};prey:${preyIdentity}`
  : null
