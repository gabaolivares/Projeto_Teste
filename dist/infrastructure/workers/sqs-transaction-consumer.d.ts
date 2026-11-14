import { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { WageringService } from '../../application/wagering/wagering.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.js';
import { SqsService } from '../messaging/sqs.module.js';
export declare class PermanentSqsMessageError extends Error {
    constructor(message: string);
}
export declare function classifySqsFailure(error: unknown): 'permanent' | 'transient';
export declare class SqsTransactionConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly sqs;
    private readonly wagering;
    private readonly metrics;
    private readonly logger;
    private running;
    private loopPromise?;
    constructor(sqs: SqsService, wagering: WageringService, metrics: MetricsService, logger: StructuredLogger);
    onApplicationBootstrap(): void;
    onApplicationShutdown(): Promise<void>;
    private run;
    private handle;
    private delay;
}
