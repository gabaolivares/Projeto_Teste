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
import { WageringService } from '../../application/wagering/wagering.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.js';
let ReferenceRetryWorker = class ReferenceRetryWorker {
    wagering;
    metrics;
    logger;
    running = false;
    loopPromise;
    constructor(wagering, metrics, logger) {
        this.wagering = wagering;
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
                await this.wagering.processPendingReferences();
            }
            catch {
                this.metrics.increment('retries');
                this.logger.warn('wagering.reference_retry_failed');
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
};
ReferenceRetryWorker = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [WageringService,
        MetricsService,
        StructuredLogger])
], ReferenceRetryWorker);
export { ReferenceRetryWorker };
//# sourceMappingURL=reference-retry-worker.js.map