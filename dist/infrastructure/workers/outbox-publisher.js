var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.js';
import { SqsService } from '../messaging/sqs.module.js';
let OutboxPublisher = class OutboxPublisher {
    dataSource;
    sqs;
    metrics;
    logger;
    running = false;
    loopPromise;
    constructor(dataSource, sqs, metrics, logger) {
        this.dataSource = dataSource;
        this.sqs = sqs;
        this.metrics = metrics;
        this.logger = logger;
    }
    onApplicationBootstrap() {
        this.running = true;
        this.loopPromise = this.run();
    }
    async onApplicationShutdown() {
        this.running = false;
        await this.loopPromise;
    }
    async run() {
        while (this.running) {
            try {
                await this.publishPendingBatch();
                const lag = await this.dataSource.query(`SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(occurred_at))), 0)::text AS lag
           FROM outbox_messages WHERE published_at IS NULL`);
                this.metrics.setOutboxLag(Number(lag[0]?.lag ?? 0));
            }
            catch {
                this.metrics.increment('retries');
                this.logger.warn('outbox.publish_batch_failed');
            }
            await this.delay(1000);
        }
    }
    async publishPendingBatch() {
        await this.dataSource.transaction(async (manager) => {
            const rows = (await manager.query(`SELECT id, aggregate_id, event_type, payload, occurred_at, attempts
         FROM outbox_messages
         WHERE published_at IS NULL AND next_attempt_at <= now()
         ORDER BY occurred_at, id
         LIMIT 10
         FOR UPDATE SKIP LOCKED`));
            for (const row of rows) {
                try {
                    await this.sqs.publishEvent(this.parseEvent(row));
                    await manager.query(`UPDATE outbox_messages SET published_at = now() WHERE id = $1`, [row.id]);
                }
                catch {
                    const attempts = row.attempts + 1;
                    const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
                    await manager.query(`UPDATE outbox_messages
             SET attempts = $1, next_attempt_at = now() + ($2 * interval '1 second')
             WHERE id = $3`, [attempts, delaySeconds, row.id]);
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
    parseEvent(row) {
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        if (typeof payload !== 'object' ||
            payload === null ||
            !('eventId' in payload) ||
            !('aggregateId' in payload) ||
            !('eventType' in payload) ||
            !('occurredAt' in payload) ||
            typeof payload.eventId !== 'string' ||
            typeof payload.aggregateId !== 'string' ||
            typeof payload.eventType !== 'string' ||
            typeof payload.occurredAt !== 'string') {
            throw new Error('Outbox event payload is invalid');
        }
        return payload;
    }
    delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
};
OutboxPublisher = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DataSource,
        SqsService,
        MetricsService,
        StructuredLogger])
], OutboxPublisher);
export { OutboxPublisher };
//# sourceMappingURL=outbox-publisher.js.map