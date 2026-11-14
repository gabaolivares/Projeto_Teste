import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.js';
import { SqsService } from '../../infrastructure/messaging/sqs.module.js';
export declare class MetricsController {
    private readonly metrics;
    private readonly sqs;
    private readonly dataSource;
    private readonly logger;
    constructor(metrics: MetricsService, sqs: SqsService, dataSource: DataSource, logger: StructuredLogger);
    render(response: Response): Promise<void>;
}
