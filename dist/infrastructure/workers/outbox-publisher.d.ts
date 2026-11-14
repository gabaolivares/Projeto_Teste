import { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.js';
import { SqsService } from '../messaging/sqs.module.js';
export declare class OutboxPublisher implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly dataSource;
    private readonly sqs;
    private readonly metrics;
    private readonly logger;
    private running;
    private loopPromise?;
    constructor(dataSource: DataSource, sqs: SqsService, metrics: MetricsService, logger: StructuredLogger);
    onApplicationBootstrap(): void;
    onApplicationShutdown(): Promise<void>;
    private run;
    publishPendingBatch(): Promise<void>;
    private parseEvent;
    private delay;
}
