import { loadRealtimeEventRetentionPolicy } from '../realtime/realtimeEventRetentionConfig'
import { createRealtimeEventRetentionScheduler } from '../realtime/realtimeEventRetentionScheduler'

export default defineNitroPlugin((nitroApp) => {
  const policy = loadRealtimeEventRetentionPolicy()
  if (!policy.enabled) return

  const scheduler = createRealtimeEventRetentionScheduler({ policy, logger: console })
  scheduler.start()
  nitroApp.hooks.hook('close', () => scheduler.stop())
})
