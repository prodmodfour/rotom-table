import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const planningPathFiles = [
  'server/domain/planAuthoritativeMoveState.ts',
  'server/domain/moveAutomation/plan.ts',
  'server/domain/planMoveUsageTransition.ts',
  'server/domain/resolveAuthoritativeMove.ts',
  'src/utils/mapHazards.ts',
  'src/utils/mapFieldEffects.ts',
  'src/utils/moveAutomationLog.ts',
]

const forbiddenImportPattern = /from ['"](?:vue|h3|.*(?:sqlite|Repository|realtime|Realtime|api|composables|\.vue|browser).*)['"]/i
const forbiddenGlobalPattern = /\b(?:window|document|localStorage|sessionStorage)\s*(?:\.|\[)/

describe('authoritative move planning architecture', () => {
  it('keeps planner and shared pure helpers out of client, database, and realtime layers', () => {
    for (const file of planningPathFiles) {
      const source = readFileSync(file, 'utf8')
      const executableSource = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(source, `${file} imports a forbidden runtime boundary`).not.toMatch(forbiddenImportPattern)
      expect(executableSource, `${file} references a browser global`).not.toMatch(forbiddenGlobalPattern)
    }
  })
})
