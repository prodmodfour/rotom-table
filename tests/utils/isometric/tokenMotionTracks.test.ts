import { describe, expect, it } from 'vitest'
import {
  TOKEN_MOTION_TRACK_RUNTIME_BRAND,
  cancelTokenMotionTrack,
  createTokenMotionFacingPlan,
  createTokenMotionPathSegments,
  finishTokenMotionTrack,
  replaceTokenMotionTrack,
  resolveTokenMotionFacingAtSample,
  resolveTokenMotionTravelFacing,
  sampleTokenMotionTrack,
  startTokenMotionTrack,
} from '~/utils/isometric/tokenMotionTracks'

const origin = { x: 0, y: 0, z: 0 }
const destination = { x: 10, y: 5, z: -5 }

describe('token motion tracks', () => {
  it('starts immutable runtime-only tracks with explicit reason and timing metadata', () => {
    const pathSegments = [{
      origin,
      destination: { x: 5, y: 0, z: 0 },
      durationMs: 100,
    }]
    const track = startTokenMotionTrack({
      tokenId: 'token-1',
      origin,
      destination,
      startMs: 1000,
      durationMs: 400,
      reason: 'local-prediction',
      pathSegments,
    })

    expect(track.tokenId).toBe('token-1')
    expect(track.origin).toEqual(origin)
    expect(track.destination).toEqual(destination)
    expect(track.startMs).toBe(1000)
    expect(track.durationMs).toBe(400)
    expect(track.reason).toBe('local-prediction')
    expect(track.pathSegments).toEqual(pathSegments)
    expect(TOKEN_MOTION_TRACK_RUNTIME_BRAND in track).toBe(true)
    expect(Object.getOwnPropertyDescriptor(
      track,
      TOKEN_MOTION_TRACK_RUNTIME_BRAND,
    )?.enumerable).toBe(false)
    expect(JSON.stringify(track)).not.toContain('tokenMotionTrackRuntimeBrand')

    expect(Object.isFrozen(track)).toBe(true)
    expect(Object.isFrozen(track.origin)).toBe(true)
    expect(Object.isFrozen(track.destination)).toBe(true)

    pathSegments[0]!.destination.x = 99
    expect(track.pathSegments?.[0]?.destination.x).toBe(5)
  })

  it('resolves track duration from center distance when no override is provided', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-2',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 0, y: 0, z: 2 },
      startMs: 1000,
      reason: 'remote-accepted',
    })

    expect(track.durationMs).toBe(192)
  })

  it('builds path segments with duration proportional to waypoint distance', () => {
    const pathSegments = createTokenMotionPathSegments({
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 20, y: 0, z: 0 },
      pathCenters: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 20, y: 0, z: 0 },
      ],
      totalDurationMs: 800,
    })

    expect(pathSegments).toEqual([
      {
        origin: { x: 0, y: 0, z: 0 },
        destination: { x: 5, y: 0, z: 0 },
        durationMs: 200,
      },
      {
        origin: { x: 5, y: 0, z: 0 },
        destination: { x: 20, y: 0, z: 0 },
        durationMs: 600,
      },
    ])
  })

  it('resolves path-track duration from total path distance instead of direct distance', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-2b',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 3, y: 0, z: 4 },
      pathCenters: [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 3, y: 0, z: 4 },
      ],
      startMs: 1000,
      reason: 'remote-accepted',
      durationOptions: {
        minDurationMs: 0,
        maxDurationMs: 1000,
        msPerGridUnit: 100,
      },
    })

    expect(track.durationMs).toBe(700)
    expect(track.pathSegments?.map((segment) => segment.durationMs)).toEqual([300, 400])
  })

  it('samples path-aware tracks through waypoints and still finishes at the final destination', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-2c',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 10, y: 0, z: 10 },
      pathCenters: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
      ],
      startMs: 1000,
      durationMs: 1000,
      reason: 'local-prediction',
    })

    expect(sampleTokenMotionTrack(track, 1250)).toEqual({
      center: { x: 1.25, y: 0, z: 0 },
      elapsedMs: 250,
      progress: 0.25,
      easedProgress: 0.0625,
      complete: false,
    })
    expect(sampleTokenMotionTrack(track, 1500)).toEqual({
      center: { x: 10, y: 0, z: 0 },
      elapsedMs: 500,
      progress: 0.5,
      easedProgress: 0.5,
      complete: false,
    })
    expect(sampleTokenMotionTrack(track, 1750)).toEqual({
      center: { x: 10, y: 0, z: 8.75 },
      elapsedMs: 750,
      progress: 0.75,
      easedProgress: 0.9375,
      complete: false,
    })
    expect(sampleTokenMotionTrack(track, 2000).center).toEqual({ x: 10, y: 0, z: 10 })
  })

  it('adds a subtle visual hop for direct elevation-changing movement', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-2d-hop',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 0, y: 2, z: 0 },
      startMs: 1000,
      durationMs: 1000,
      reason: 'remote-accepted',
    })

    expect(track.hopHeight).toBeCloseTo(0.16)
    expect(sampleTokenMotionTrack(track, 1000).center).toEqual({ x: 0, y: 0, z: 0 })
    expect(sampleTokenMotionTrack(track, 1500)).toEqual({
      center: { x: 0, y: 1.16, z: 0 },
      elapsedMs: 500,
      progress: 0.5,
      easedProgress: 0.5,
      complete: false,
    })
    expect(sampleTokenMotionTrack(track, 2000).center).toEqual({ x: 0, y: 2, z: 0 })
  })

  it('removes elevation hops when reduced motion is requested', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-2e-reduced-hop',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 0, y: 2, z: 0 },
      startMs: 1000,
      durationMs: 1000,
      durationOptions: { reducedMotion: true },
      reason: 'remote-accepted',
    })

    expect(track.hopHeight).toBeUndefined()
    expect(sampleTokenMotionTrack(track, 1500)).toEqual({
      center: { x: 0, y: 1, z: 0 },
      elapsedMs: 500,
      progress: 0.5,
      easedProgress: 0.5,
      complete: false,
    })
  })

  it('adds elevation hops to path segments without lifting flat segments', () => {
    const pathSegments = createTokenMotionPathSegments({
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 1, y: 1, z: 0 },
      pathCenters: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      totalDurationMs: 1000,
    })

    expect(pathSegments).toEqual([
      {
        origin: { x: 0, y: 0, z: 0 },
        destination: { x: 1, y: 0, z: 0 },
        durationMs: 500,
      },
      {
        origin: { x: 1, y: 0, z: 0 },
        destination: { x: 1, y: 1, z: 0 },
        durationMs: 500,
        hopHeight: 0.12,
      },
    ])

    const track = startTokenMotionTrack({
      tokenId: 'token-2f-path-hop',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 1, y: 1, z: 0 },
      pathSegments,
      startMs: 1000,
      durationMs: 1000,
      reason: 'local-prediction',
    })
    const sample = sampleTokenMotionTrack(track, 1750)

    expect(sample.center.x).toBe(1)
    expect(sample.center.y).toBeCloseTo(0.9275)
    expect(sample.center.z).toBe(0)
    expect(sample.progress).toBe(0.75)
    expect(sample.easedProgress).toBe(0.9375)
    expect(sample.complete).toBe(false)
  })

  it('faces direct movement toward the travel direction until the track completes', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-2g-facing',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: -4, y: 0, z: 0 },
      startMs: 1000,
      durationMs: 1000,
      reason: 'remote-accepted',
    })
    const plan = createTokenMotionFacingPlan({
      origin: track.origin,
      destination: track.destination,
      currentFacing: 'north-east',
      finalFacing: 'south-east',
    })

    expect(plan).toEqual({
      travelFacing: 'south-west',
      finalFacing: 'south-east',
    })
    expect(resolveTokenMotionTravelFacing({
      origin: track.origin,
      destination: track.destination,
      currentFacing: 'north-east',
    })).toBe('south-west')
    expect(resolveTokenMotionFacingAtSample(plan, sampleTokenMotionTrack(track, 1500))).toBe('south-west')
    expect(resolveTokenMotionFacingAtSample(plan, sampleTokenMotionTrack(track, 2000))).toBe('south-east')
  })

  it('uses the first non-zero path segment for travel facing without flipping at later waypoints', () => {
    const pathSegments = createTokenMotionPathSegments({
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: -2, y: 0, z: -3 },
      pathCenters: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: -3 },
        { x: -2, y: 0, z: -3 },
      ],
      totalDurationMs: 900,
    })

    expect(resolveTokenMotionTravelFacing({
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: -2, y: 0, z: -3 },
      pathSegments,
      currentFacing: 'south-east',
    })).toBe('north-west')
  })

  it('falls back to the final facing for vertical-only movement with no horizontal travel direction', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-2h-vertical-facing',
      origin: { x: 1, y: 0, z: 1 },
      destination: { x: 1, y: 2, z: 1 },
      startMs: 1000,
      durationMs: 1000,
      reason: 'remote-accepted',
    })
    const plan = createTokenMotionFacingPlan({
      origin: track.origin,
      destination: track.destination,
      currentFacing: 'north-east',
      finalFacing: 'south-west',
    })

    expect(plan).toEqual({ finalFacing: 'south-west' })
    expect(resolveTokenMotionFacingAtSample(plan, sampleTokenMotionTrack(track, 1500))).toBe('south-west')
  })

  it('falls back to direct motion when path centers are missing or invalid', () => {
    const missingPathTrack = startTokenMotionTrack({
      tokenId: 'token-2d',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 10, y: 0, z: 0 },
      pathCenters: [{ x: 0, y: 0, z: 0 }],
      startMs: 1000,
      durationMs: 1000,
      reason: 'local-prediction',
    })
    const invalidPathTrack = startTokenMotionTrack({
      tokenId: 'token-2e',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 10, y: 0, z: 0 },
      pathCenters: [
        { x: 0, y: 0, z: 0 },
        { x: Number.NaN, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      startMs: 1000,
      durationMs: 1000,
      reason: 'local-prediction',
    })

    expect(missingPathTrack.pathSegments).toBeUndefined()
    expect(invalidPathTrack.pathSegments).toBeUndefined()
    expect(sampleTokenMotionTrack(missingPathTrack, 1500).center).toEqual({ x: 5, y: 0, z: 0 })
    expect(sampleTokenMotionTrack(invalidPathTrack, 1500).center).toEqual({ x: 5, y: 0, z: 0 })
  })

  it('samples origin before start, eased centers during movement, and destination at completion', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-3',
      origin,
      destination: { x: 10, y: 0, z: 0 },
      startMs: 1000,
      durationMs: 1000,
      reason: 'remote-accepted',
    })

    expect(sampleTokenMotionTrack(track, 900)).toEqual({
      center: origin,
      elapsedMs: 0,
      progress: 0,
      easedProgress: 0,
      complete: false,
    })
    expect(sampleTokenMotionTrack(track, 1000)).toEqual({
      center: origin,
      elapsedMs: 0,
      progress: 0,
      easedProgress: 0,
      complete: false,
    })
    expect(sampleTokenMotionTrack(track, 1250)).toEqual({
      center: { x: 0.625, y: 0, z: 0 },
      elapsedMs: 250,
      progress: 0.25,
      easedProgress: 0.0625,
      complete: false,
    })
    expect(sampleTokenMotionTrack(track, 1500)).toEqual({
      center: { x: 5, y: 0, z: 0 },
      elapsedMs: 500,
      progress: 0.5,
      easedProgress: 0.5,
      complete: false,
    })
    expect(sampleTokenMotionTrack(track, 2000)).toEqual({
      center: { x: 10, y: 0, z: 0 },
      elapsedMs: 1000,
      progress: 1,
      easedProgress: 1,
      complete: true,
    })
    expect(sampleTokenMotionTrack(track, 2400)).toEqual({
      center: { x: 10, y: 0, z: 0 },
      elapsedMs: 1400,
      progress: 1,
      easedProgress: 1,
      complete: true,
    })
  })

  it('handles snap-duration tracks deterministically around their start time', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-4',
      origin,
      destination,
      startMs: 1000,
      durationMs: 0,
      reason: 'reconciliation',
    })

    expect(sampleTokenMotionTrack(track, 999)).toEqual({
      center: origin,
      elapsedMs: 0,
      progress: 0,
      easedProgress: 0,
      complete: false,
    })
    expect(sampleTokenMotionTrack(track, 1000)).toEqual({
      center: destination,
      elapsedMs: 0,
      progress: 1,
      easedProgress: 1,
      complete: true,
    })
  })

  it('replaces active tracks from the sampled current center instead of the old origin', () => {
    const activeTrack = startTokenMotionTrack({
      tokenId: 'token-5',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 10, y: 0, z: 0 },
      startMs: 1000,
      durationMs: 1000,
      reason: 'local-prediction',
    })

    const replacement = replaceTokenMotionTrack(activeTrack, {
      destination: { x: 20, y: 0, z: 0 },
      replaceAtMs: 1250,
      durationMs: 600,
      reason: 'server-correction',
    })

    expect(replacement.tokenId).toBe(activeTrack.tokenId)
    expect(replacement.origin).toEqual({ x: 0.625, y: 0, z: 0 })
    expect(replacement.destination).toEqual({ x: 20, y: 0, z: 0 })
    expect(replacement.startMs).toBe(1250)
    expect(replacement.durationMs).toBe(600)
    expect(replacement.reason).toBe('server-correction')
  })

  it('resolves replacement duration from remaining distance at the active track pace', () => {
    const activeTrack = startTokenMotionTrack({
      tokenId: 'token-5b',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 10, y: 0, z: 0 },
      startMs: 1000,
      durationMs: 400,
      reason: 'local-prediction',
    })

    const replacement = replaceTokenMotionTrack(activeTrack, {
      destination: { x: 0, y: 0, z: 0 },
      replaceAtMs: 1200,
    })

    expect(replacement.origin).toEqual({ x: 5, y: 0, z: 0 })
    expect(replacement.destination).toEqual({ x: 0, y: 0, z: 0 })
    expect(replacement.durationMs).toBe(200)
    expect(sampleTokenMotionTrack(replacement, 1400)).toEqual({
      center: { x: 0, y: 0, z: 0 },
      elapsedMs: 200,
      progress: 1,
      easedProgress: 1,
      complete: true,
    })
  })

  it('lets replacement duration options override active track pace', () => {
    const activeTrack = startTokenMotionTrack({
      tokenId: 'token-5c',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 10, y: 0, z: 0 },
      startMs: 1000,
      durationMs: 400,
      reason: 'local-prediction',
    })

    const replacement = replaceTokenMotionTrack(activeTrack, {
      destination: { x: 8, y: 0, z: 0 },
      replaceAtMs: 1200,
      durationOptions: {
        minDurationMs: 50,
        maxDurationMs: 500,
        msPerGridUnit: 100,
      },
    })

    expect(replacement.origin).toEqual({ x: 5, y: 0, z: 0 })
    expect(replacement.durationMs).toBe(300)
  })

  it('replaces completed tracks from the destination sample', () => {
    const activeTrack = startTokenMotionTrack({
      tokenId: 'token-6',
      origin,
      destination,
      startMs: 1000,
      durationMs: 100,
      reason: 'setup-edit',
    })

    const replacement = replaceTokenMotionTrack(activeTrack, {
      destination: { x: 20, y: 0, z: 0 },
      replaceAtMs: 1200,
      durationMs: 200,
    })

    expect(replacement.origin).toEqual(destination)
    expect(replacement.reason).toBe('setup-edit')
  })

  it('finishes tracks at the exact destination center', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-7',
      origin,
      destination,
      startMs: 1000,
      durationMs: 400,
      reason: 'remote-accepted',
    })

    expect(finishTokenMotionTrack(track)).toEqual({
      center: destination,
      completedAtMs: 1400,
    })
    expect(finishTokenMotionTrack(track, 1500)).toEqual({
      center: destination,
      completedAtMs: 1500,
    })
  })

  it('cancels tracks by sampling, snapping to destination, or snapping to origin', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-8',
      origin: { x: 0, y: 0, z: 0 },
      destination: { x: 10, y: 0, z: 0 },
      startMs: 1000,
      durationMs: 1000,
      reason: 'server-correction',
    })

    expect(cancelTokenMotionTrack(track, { cancelAtMs: 1250 })).toEqual({
      center: { x: 0.625, y: 0, z: 0 },
      cancelledAtMs: 1250,
      mode: 'sample-current',
    })
    expect(cancelTokenMotionTrack(track, {
      cancelAtMs: 1250,
      mode: 'snap-to-destination',
    })).toEqual({
      center: { x: 10, y: 0, z: 0 },
      cancelledAtMs: 1250,
      mode: 'snap-to-destination',
    })
    expect(cancelTokenMotionTrack(track, {
      cancelAtMs: 1250,
      mode: 'snap-to-origin',
    })).toEqual({
      center: { x: 0, y: 0, z: 0 },
      cancelledAtMs: 1250,
      mode: 'snap-to-origin',
    })
  })

  it('normalizes invalid numeric input to deterministic safe values', () => {
    const track = startTokenMotionTrack({
      tokenId: 'token-9',
      origin: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: 2 },
      destination: { x: 4, y: 5, z: Number.NEGATIVE_INFINITY },
      startMs: Number.NaN,
      durationMs: Number.POSITIVE_INFINITY,
      reason: 'reconciliation',
      pathSegments: [{
        origin: { x: 0, y: 0, z: 0 },
        destination: { x: 1, y: 1, z: 1 },
        durationMs: Number.NaN,
      }],
    })

    expect(track.origin).toEqual({ x: 0, y: 0, z: 2 })
    expect(track.destination).toEqual({ x: 4, y: 5, z: 0 })
    expect(track.startMs).toBe(0)
    expect(track.durationMs).toBe(520)
    expect(track.pathSegments?.[0]?.durationMs).toBe(0)
  })
})
