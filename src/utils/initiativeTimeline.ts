export interface InitiativeTimelineEntry {
  id: string
}

export interface InitiativeTimelineSegments<T extends InitiativeTimelineEntry> {
  past: T[]
  current: T | null
  upcoming: T[]
}

export const splitInitiativeTimeline = <T extends InitiativeTimelineEntry>(
  rows: readonly T[],
  activeId: string | null | undefined,
  round = 1,
): InitiativeTimelineSegments<T> => {
  const activeIndex = activeId ? rows.findIndex((row) => row.id === activeId) : -1
  if (activeIndex < 0) {
    return {
      past: [],
      current: null,
      upcoming: [...rows],
    }
  }

  const past = rows.slice(0, activeIndex)
  const upcoming = rows.slice(activeIndex + 1)

  // At the top of round 2+, the last combatant is the turn that just went.
  // Show that token on the left once, rather than duplicating it as both a
  // previous-round turn and an upcoming turn later in the current round.
  if (activeIndex === 0 && round > 1 && upcoming.length > 0) {
    const justActed = upcoming.pop()
    if (justActed) past.push(justActed)
  }

  return {
    past,
    current: rows[activeIndex] ?? null,
    upcoming,
  }
}
