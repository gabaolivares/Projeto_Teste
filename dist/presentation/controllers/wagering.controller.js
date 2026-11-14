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
import { Body, Controller, Get, Headers, Param, Post, Req, Res, UseGuards, } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { WageringService, } from '../../application/wagering/wagering.service.js';
import { WagerTransactionStatus } from '../../domain/wager-transaction.js';
import { NoopAuthGuard } from '../auth/noop-auth.guard.js';
let WageringController = class WageringController {
    wagering;
    constructor(wagering) {
        this.wagering = wagering;
    }
    async submit(body, idempotencyKey, correlationId, request, response) {
        const result = await this.wagering.submit(body, idempotencyKey ?? '', {
            correlationId: correlationId?.trim() ||
                (typeof request.headers['x-correlation-id'] === 'string'
                    ? request.headers['x-correlation-id']
                    : randomUUID()),
        });
        if (result.status === WagerTransactionStatus.Rejected) {
            response.status(422);
        }
        else if (result.status === WagerTransactionStatus.PendingReference) {
            response.status(202);
        }
        else {
            response.status(200);
        }
        return result;
    }
    transaction(transactionId) {
        return this.wagering.findTransaction(transactionId);
    }
    providerTransaction(providerId, externalTransactionId) {
        return this.wagering.findProviderTransaction(providerId, externalTransactionId);
    }
};
__decorate([
    Post('wagering/transactions'),
    __param(0, Body()),
    __param(1, Headers('idempotency-key')),
    __param(2, Headers('x-correlation-id')),
    __param(3, Req()),
    __param(4, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], WageringController.prototype, "submit", null);
__decorate([
    Get('wagering/transactions/:transactionId'),
    __param(0, Param('transactionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WageringController.prototype, "transaction", null);
__decorate([
    Get('providers/:providerId/wagering/transactions/:externalTransactionId'),
    __param(0, Param('providerId')),
    __param(1, Param('externalTransactionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], WageringController.prototype, "providerTransaction", null);
WageringController = __decorate([
    Controller(),
    UseGuards(NoopAuthGuard),
    __metadata("design:paramtypes", [WageringService])
], WageringController);
export { WageringController };
//# sourceMappingURL=wagering.controller.js.map