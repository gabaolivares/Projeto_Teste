import { Injectable } from '@nestjs/common';

const transactionStatuses = ['PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'];

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly statusCounts = new Map<string, number>();
  private latencyCount = 0;
  private latencyTotalMs = 0;
  private outboxLagSeconds = 0;
  private dlqMessages = 0;

  increment(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  transactionStatus(status: string): void {
    this.statusCounts.set(status, (this.statusCounts.get(status) ?? 0) + 1);
  }

  observeProcessingLatency(milliseconds: number): void {
    this.latencyCount += 1;
    this.latencyTotalMs += milliseconds;
  }

  setOutboxLag(seconds: number): void {
    this.outboxLagSeconds = Math.max(0, seconds);
  }

  setDlqMessages(count: number): void {
    this.dlqMessages = Math.max(0, count);
  }

  render(): string {
    const lines = [
      '# HELP wagering_transactions_total Transactions processed by terminal or pending status',
      '# TYPE wagering_transactions_total counter',
      ...transactionStatuses.map(
        (status) =>
          `wagering_transactions_total{status="${status}"} ${this.statusCounts.get(status) ?? 0}`,
      ),
      '# HELP wagering_duplicates_total Idempotent transaction or message replays',
      '# TYPE wagering_duplicates_total counter',
      `wagering_duplicates_total ${this.counters.get('duplicates') ?? 0}`,
      '# HELP wagering_retries_total Worker and reference retries',
      '# TYPE wagering_retries_total counter',
      `wagering_retries_total ${this.counters.get('retries') ?? 0}`,
      '# HELP wagering_dlq_messages Approximate messages in the SQS dead-letter queue',
      '# TYPE wagering_dlq_messages gauge',
      `wagering_dlq_messages ${this.dlqMessages}`,
      '# HELP wagering_lock_conflicts_total Wallet lock waits exceeding 100ms',
      '# TYPE wagering_lock_conflicts_total counter',
      `wagering_lock_conflicts_total ${this.counters.get('lock_conflicts') ?? 0}`,
      '# HELP wagering_outbox_lag_seconds Age of the oldest pending outbox event',
      '# TYPE wagering_outbox_lag_seconds gauge',
      `wagering_outbox_lag_seconds ${this.outboxLagSeconds}`,
      '# HELP wagering_processing_latency_milliseconds_sum Total processing latency',
      '# TYPE wagering_processing_latency_milliseconds_sum counter',
      `wagering_processing_latency_milliseconds_sum ${this.latencyTotalMs}`,
      '# HELP wagering_processing_latency_milliseconds_count Processed transaction count',
      '# TYPE wagering_processing_latency_milliseconds_count counter',
      `wagering_processing_latency_milliseconds_count ${this.latencyCount}`,
      '# HELP wagering_reconciliation_mismatches_total Wallet reconciliation mismatches',
      '# TYPE wagering_reconciliation_mismatches_total counter',
      `wagering_reconciliation_mismatches_total ${this.counters.get('reconciliation_mismatches') ?? 0}`,
    ];
    return `${lines.join('\n')}\n`;
  }
}
