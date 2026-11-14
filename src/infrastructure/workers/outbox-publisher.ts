import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.js';
import { SqsService } from '../messaging/sqs.module.js';

interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown> | string;
  occurred_at: Date;
  attempts: number;
}

@Injectable()
export class OutboxPublisher implements OnApplicationBootstrap, OnApplicationShutdown {
  private running = false;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly sqs: SqsService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loopPromise = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.publishPendingBatch();
        const lag = await this.dataSource.query(
          `SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(occurred_at))), 0)::text AS lag
           FROM outbox_messages WHERE published_at IS NULL`,
        );
        this.metrics.setOutboxLag(Number(lag[0]?.lag ?? 0));
      } catch {
        this.metrics.increment('retries');
        this.logger.warn('outbox.publish_batch_failed');
      }
      await this.delay(1000);
    }
  }

  async publishPendingBatch(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT id, aggregate_id, event_type, payload, occurred_at, attempts
         FROM outbox_messages
         WHERE published_at IS NULL AND next_attempt_at <= now()
         ORDER BY occurred_at, id
         LIMIT 10
         FOR UPDATE SKIP LOCKED`,
      )) as OutboxRow[];

      for (const row of rows) {
        try {
          await this.sqs.publishEvent(this.parseEvent(row));
          await manager.query(
            `UPDATE outbox_messages SET published_at = now() WHERE id = $1`,
            [row.id],
          );
        } catch {
          const attempts = row.attempts + 1;
          const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
          await manager.query(
            `UPDATE outbox_messages
             SET attempts = $1, next_attempt_at = now() + ($2 * interval '1 second')
             WHERE id = $3`,
            [attempts, delaySeconds, row.id],
          );
          this.metrics.increment('retries');
          this.logger.warn('outbox.publish_retry_scheduled', {
            transactionId: row.id,
            walletId: row.aggregate_id,
            errorCode: row.event_type,
          });
        }
      }
    });
  }

  private parseEvent(row: OutboxRow): {
    eventId: string;
    aggregateId: string;
    eventType: string;
    occurredAt: string;
    readonly [key: string]: unknown;
  } {
    const payload =
      typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('eventId' in payload) ||
      !('aggregateId' in payload) ||
      !('eventType' in payload) ||
      !('occurredAt' in payload) ||
      typeof payload.eventId !== 'string' ||
      typeof payload.aggregateId !== 'string' ||
      typeof payload.eventType !== 'string' ||
      typeof payload.occurredAt !== 'string'
    ) {
      throw new Error('Outbox event payload is invalid');
    }
    return payload as {
      eventId: string;
      aggregateId: string;
      eventType: string;
      occurredAt: string;
      readonly [key: string]: unknown;
    };
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
