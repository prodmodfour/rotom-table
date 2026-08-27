import { defineEventHandler } from 'h3'
import { ROTOM_TABLE_SERVICE } from '#shared/release/identity'
import { publicReleaseIdentity, runtimeReleaseIdentity } from '../utils/releaseIdentity'

export default defineEventHandler(event => ({
  ok: true,
  service: ROTOM_TABLE_SERVICE,
  ...publicReleaseIdentity(runtimeReleaseIdentity(event)),
}))
