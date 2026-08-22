export const CONTESTS_PATH = '/contests' as const
export const contestPath = (contestId: string): string => `${CONTESTS_PATH}/${encodeURIComponent(contestId)}`
export const contestApiPath = (contestId: string): string => `/api/contests/${encodeURIComponent(contestId)}`
