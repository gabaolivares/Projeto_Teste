var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { WageringModule } from '../../application/wagering/wagering.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SqsModule } from '../messaging/sqs.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { ReferenceRetryWorker } from './reference-retry-worker.js';
import { SqsTransactionConsumer } from './sqs-transaction-consumer.js';
let WorkersModule = class WorkersModule {
};
WorkersModule = __decorate([
    Module({
        imports: [DatabaseModule, WageringModule, SqsModule, ObservabilityModule],
        providers: [OutboxPublisher, ReferenceRetryWorker, SqsTransactionConsumer],
    })
], WorkersModule);
export { WorkersModule };
//# sourceMappingURL=workers.module.js.map