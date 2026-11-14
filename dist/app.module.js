var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let AppModule = class AppModule {
};
AppModule = __decorate([
    Module({
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
], AppModule);
export { AppModule };
//# sourceMappingURL=app.module.js.map