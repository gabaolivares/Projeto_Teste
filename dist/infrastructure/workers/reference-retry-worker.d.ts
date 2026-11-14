import { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { WageringService } from '../../application/wagering/wagering.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.js';
export declare class ReferenceRetryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly wagering;
    private readonly metrics;
    private readonly logger;
    private running;
    private loopPromise?;
    constructor(wagering: WageringService, metrics: MetricsService, logger: StructuredLogger);
    onApplicationBootstrap(): void;
    onApplicationShutdown(): Promise<void>;
    private run;
}
