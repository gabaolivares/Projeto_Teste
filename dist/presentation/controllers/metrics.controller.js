var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Res } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.js';
import { SqsService } from '../../infrastructure/messaging/sqs.module.js';
let MetricsController = class MetricsController {
    metrics;
    sqs;
    dataSource;
    logger;
    constructor(metrics, sqs, dataSource, logger) {
        this.metrics = metrics;
        this.sqs = sqs;
        this.dataSource = dataSource;
        this.logger = logger;
    }
    async render(response) {
        const lag = (await this.dataSource.query(`SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(occurred_at))), 0)::text AS lag
       FROM outbox_messages WHERE published_at IS NULL`));
        this.metrics.setOutboxLag(Number(lag[0]?.lag ?? 0));
        try {
            this.metrics.setDlqMessages(await this.sqs.deadLetterCount());
        }
        catch (error) {
            this.logger.warn('metrics.dlq_count_unavailable', {
                errorCode: error instanceof Error ? error.name : 'UNKNOWN',
            });
        }
        response.type('text/plain').send(this.metrics.render());
    }
};
__decorate([
    Get('metrics'),
    __param(0, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MetricsController.prototype, "render", null);
MetricsController = __decorate([
    Controller(),
    __metadata("design:paramtypes", [MetricsService,
        SqsService,
        DataSource,
        StructuredLogger])
], MetricsController);
export { MetricsController };
//# sourceMappingURL=metrics.controller.js.map