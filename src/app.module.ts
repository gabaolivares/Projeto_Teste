import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { WageringModule } from './application/wagering/wagering.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { SqsModule } from './infrastructure/messaging/sqs.module.js';
import { ObservabilityModule } from './infrastructure/observability/observability.module.js';
import { WorkersModule } from './infrastructure/workers/workers.module.js';
import { HealthController } from './presentation/controllers/health.controller.js';
import { MetricsController } from './presentation/controllers/metrics.controller.js';
import { WalletController } from './presentation/controllers/wallet.controller.js';
import { WageringController } from './presentation/controllers/wagering.controller.js';
import { NoopAuthGuard } from './presentation/auth/noop-auth.guard.js';
import { PersistenceExceptionFilter } from './presentation/filters/persistence-exception.filter.js';

@Module({
  imports: [
    DatabaseModule,
    SqsModule,
    ObservabilityModule,
    WageringModule,
    WorkersModule,
  ],
  controllers: [
    HealthController,
    MetricsController,
    WalletController,
    WageringController,
  ],
  providers: [
    NoopAuthGuard,
    { provide: APP_FILTER, useClass: PersistenceExceptionFilter },
  ],
})
export class AppModule {}
