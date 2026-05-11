import type { GridAnchor } from '~/types/pokemon'

export interface PreviewState {
  position: GridAnchor | null
  reachable: boolean
  pathLength: number
}
