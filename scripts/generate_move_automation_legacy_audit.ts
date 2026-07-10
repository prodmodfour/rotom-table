import {
  buildLegacyMoveAutomationAudit,
  formatLegacyMoveAutomationAuditReport,
} from './move_automation_legacy_audit'

const usage = (): string => [
  'Usage: npm run audit:move-automation-legacy -- [--json|--report]',
  '       npm run --silent audit:move-automation-legacy -- --json',
  '',
  '  --json    Emit deterministic machine-readable audit metadata.',
  '  --report  Emit the deterministic human-readable review report (default).',
].join('\n')

const run = (args: readonly string[]): number => {
  if (args.includes('--help')) {
    console.log(usage())
    return 0
  }

  const unknown = args.filter(argument => argument !== '--json' && argument !== '--report')
  if (unknown.length > 0 || (args.includes('--json') && args.includes('--report'))) {
    console.error(usage())
    return 2
  }

  const audit = buildLegacyMoveAutomationAudit()
  if (args.includes('--json')) {
    console.log(JSON.stringify(audit, null, 2))
  }
  else {
    process.stdout.write(formatLegacyMoveAutomationAuditReport(audit))
  }
  return 0
}

process.exitCode = run(process.argv.slice(2))
