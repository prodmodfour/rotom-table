export const CAMPAIGN_OPERATION_LEDGER_STATUSES = Object.freeze(['pending', 'accepted', 'rejected'] as const)
export type CampaignOperationLedgerStatus = typeof CAMPAIGN_OPERATION_LEDGER_STATUSES[number]

export interface CampaignOperationLedgerRecord<Command, Result, Scope, OperationId extends string = string> {
  readonly operationId: OperationId
  readonly commandHash: string
  readonly command: Command
  readonly scopes: readonly Scope[]
  readonly status: CampaignOperationLedgerStatus
  readonly result: Result | null
  readonly createdAtCampaignMinute: number
  readonly settledAtCampaignMinute: number | null
}

export type CampaignOperationReservationDecision<Record> =
  | { readonly kind: 'reserved', readonly record: Record }
  | { readonly kind: 'pending', readonly record: Record }
  | { readonly kind: 'exact-retry', readonly record: Record }

export type CampaignOperationSettlementDecision<Record> =
  | { readonly kind: 'settled', readonly record: Record }
  | { readonly kind: 'exact-retry', readonly record: Record }

export type CampaignOperationExecutionDecision<Record> =
  | { readonly kind: 'executed', readonly record: Record }
  | { readonly kind: 'pending', readonly record: Record }
  | { readonly kind: 'exact-retry', readonly record: Record }

/** Storage adapter consumed by the neutral synchronous campaign-operation coordinator. */
export interface CampaignOperationLedgerAdapter<Command, Result, Record> {
  reserve(command: unknown, createdAtCampaignMinute: number): CampaignOperationReservationDecision<Record>
  settle(command: Command, result: Result, settledAtCampaignMinute: number): CampaignOperationSettlementDecision<Record>
}
