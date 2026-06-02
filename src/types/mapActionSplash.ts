import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

export type MapActionSplashProfileEntry = Pick<InitiativeRow, 'name' | 'profileUrl' | 'sprite'>

export interface MapActionSplashState {
  id: number
  userId: string
  actorName: string
  actionLabel: string
  profileEntry: MapActionSplashProfileEntry
  accentColor?: string | null
}
