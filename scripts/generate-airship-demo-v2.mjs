#!/usr/bin/env node
import { generateMapFromPlan, readJson, writeGeneratedMap } from './mapgen-v2-lib.mjs'

const planPath = 'data/map-plans/airship-habitat-atrium-phase2-demo.plan.json'
const outPath = 'data/maps/ranger_ark/airship-habitat-atrium-phase2-demo.json'

try {
  const plan = readJson(planPath)
  plan.planPath = planPath
  const map = generateMapFromPlan(plan, process.cwd())
  writeGeneratedMap(map, outPath)
  console.log(`Generated ${outPath}`)
  console.log(`- voxels: ${map.voxels.length}`)
  console.log(`- decals: ${map.decals.length}`)
  console.log(`- props: ${map.props.length}`)
  console.log(`- zones: ${map.zones.length}`)
  console.log(`- doors: ${map.doors.length}`)
} catch (err) {
  console.error(`generate-airship-demo-v2: ${err.message}`)
  process.exit(1)
}
