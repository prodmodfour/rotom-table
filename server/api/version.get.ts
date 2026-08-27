import { defineEventHandler } from 'h3'
import { publicReleaseIdentity, runtimeReleaseIdentity } from '../utils/releaseIdentity'

export default defineEventHandler(event => publicReleaseIdentity(runtimeReleaseIdentity(event)))
