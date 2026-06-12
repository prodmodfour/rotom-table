import { parseLivePlayMapSlug } from '#shared/livePlayCommands'

export type MapWriteQueueTask<T> = () => T | Promise<T>

export interface MapWriteQueue {
  withMapWriteQueue<T>(mapSlug: string, task: MapWriteQueueTask<T>): Promise<T>
}

export class InProcessMapWriteQueue implements MapWriteQueue {
  private readonly tails = new Map<string, Promise<void>>()

  get pendingMapCount(): number {
    return this.tails.size
  }

  async withMapWriteQueue<T>(mapSlug: string, task: MapWriteQueueTask<T>): Promise<T> {
    const key = parseLivePlayMapSlug(mapSlug)
    const previous = this.tails.get(key) ?? Promise.resolve()

    let releaseCurrent!: () => void
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })

    this.tails.set(key, current)

    await previous

    try {
      return await task()
    } finally {
      releaseCurrent()
      if (this.tails.get(key) === current) {
        this.tails.delete(key)
      }
    }
  }
}

export const createInProcessMapWriteQueue = (): InProcessMapWriteQueue => new InProcessMapWriteQueue()

export const livePlayMapWriteQueue = createInProcessMapWriteQueue()

export const withMapWriteQueue = <T>(mapSlug: string, task: MapWriteQueueTask<T>): Promise<T> =>
  livePlayMapWriteQueue.withMapWriteQueue(mapSlug, task)
