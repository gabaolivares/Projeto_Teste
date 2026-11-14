var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Controller, Get, ServiceUnavailableException, } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SqsService } from '../../infrastructure/messaging/sqs.module.js';
let HealthController = class HealthController {
    dataSource;
    sqs;
    constructor(dataSource, sqs) {
        this.dataSource = dataSource;
        this.sqs = sqs;
    }
    live() {
        return { status: 'ok' };
    }
    async ready() {
        const checks = { postgres: false, sqs: false };
        try {
            await this.dataSource.query('SELECT 1');
            checks.postgres = true;
        }
        catch {
            checks.postgres = false;
        }
        try {
            await this.sqs.isReachable();
            checks.sqs = true;
        }
        catch {
            checks.sqs = false;
        }
        if (!checks.postgres || !checks.sqs) {
            throw new ServiceUnavailableException({ status: 'not_ready', checks });
        }
        return { status: 'ready', checks };
    }
};
__decorate([
    Get('live'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "live", null);
__decorate([
    Get('ready'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "ready", null);
HealthController = __decorate([
    Controller('health'),
    __metadata("design:paramtypes", [DataSource,
        SqsService])
], HealthController);
export { HealthController };
//# sourceMappingURL=health.controller.js.map