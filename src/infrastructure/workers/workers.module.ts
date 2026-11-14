import { Module } from '@nestjs/common';
import { WageringModule } from '../../application/wagering/wagering.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SqsModule } from '../messaging/sqs.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { ReferenceRetryWorker } from './reference-retry-worker.js';
import { SqsTransactionConsumer } from './sqs-transaction-consumer.js';

@Module({
  imports: [DatabaseModule, WageringModule, SqsModule, ObservabilityModule],
  providers: [OutboxPublisher, ReferenceRetryWorker, SqsTransactionConsumer],
})
export class WorkersModule {}
