import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const planningPathFiles = [
  'server/domain/planAuthoritativeMoveState.ts',
  'server/domain/moveAutomation/adaptV1Transaction.ts',
  'server/domain/moveAutomation/plan.ts',
  'server/domain/moveAutomation/reducers/combatStage.ts',
  'server/domain/moveAutomation/reducers/condition.ts',
  'server/domain/moveAutomation/reducers/coreTokenEffects.ts',
  'server/domain/moveAutomation/reducers/coreTokenPlan.ts',
  'server/domain/moveAutomation/reducers/coreTokenRecipients.ts',
  'server/domain/moveAutomation/reducers/coreTokenTrace.ts',
  'server/domain/moveAutomation/reducers/effectRecipients.ts',
  'server/domain/moveAutomation/reducers/hp.ts',
  'server/domain/moveAutomation/reducers/immunities.ts',
  'server/domain/moveAutomation/reducers/mapFieldEffects.ts',
  'server/domain/moveAutomation/reducers/mapHazardEffects.ts',
  'server/domain/moveAutomation/reducers/mapOperationError.ts',
  'server/domain/moveAutomation/reducers/mapOperationPlan.ts',
  'server/domain/moveAutomation/reducers/mapOperations.ts',
  'server/domain/moveAutomation/reducers/mapOperationTrace.ts',
  'server/domain/moveAutomation/reducers/mapOperationTypes.ts',
  'server/domain/moveAutomation/reducers/mapUsageEffects.ts',
  'server/domain/planMoveUsageTransition.ts',
  'server/domain/resolveAuthoritativeMove.ts',
  'src/utils/mapHazards.ts',
  'src/utils/mapFieldEffects.ts',
  'src/utils/moveAutomationLog.ts',
  'src/utils/moveLog.ts',
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
