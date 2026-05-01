#!/usr/bin/env node
import { resolve } from 'node:path'
import { generateMapFromPlan, readJson, writeGeneratedMap } from './mapgen-v2-lib.mjs'

const usage = () => {
  console.log(`Usage:
  node scripts/generate-map-from-plan.mjs --plan data/map-plans/example.json --out data/maps/example.json

Expands AI-friendly map plans (zones with brushes + prefab placements) into full
TabletopMap v2 JSON containing ordinary voxels/decals/props/doors/zones.`)
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') { out.help = true; continue }
    if (!arg.startsWith('--')) throw new Error(`unexpected positional argument: ${arg}`)
    const key = arg.slice(2)
    const value = args[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    out[key] = value
    i += 1
  }
  return out
}

try {
  const args = parseArgs()
  if (args.help || !args.plan || !args.out) { usage(); process.exit(args.help ? 0 : 1) }
  const planPath = resolve(process.cwd(), args.plan)
  const plan = readJson(planPath)
  plan.planPath = args.plan
  const map = generateMapFromPlan(plan, process.cwd())
  writeGeneratedMap(map, args.out)
  console.log(`Generated ${args.out}`)
  console.log(`- voxels: ${map.voxels.length}`)
  console.log(`- decals: ${map.decals.length}`)
  console.log(`- props: ${map.props.length}`)
  console.log(`- zones: ${map.zones.length}`)
  console.log(`- doors: ${map.doors.length}`)
} catch (err) {
  console.error(`generate-map-from-plan: ${err.message}`)
  process.exit(1)
}
