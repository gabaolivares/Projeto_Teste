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
import { Body, Controller, Get, Param, Post, Query, UseGuards, } from '@nestjs/common';
import { WageringService } from '../../application/wagering/wagering.service.js';
import { NoopAuthGuard } from '../auth/noop-auth.guard.js';
let WalletController = class WalletController {
    wagering;
    constructor(wagering) {
        this.wagering = wagering;
    }
    open(body) {
        return this.wagering.openWallet(body);
    }
    get(walletId) {
        return this.wagering.getWallet(walletId);
    }
    ledger(walletId, cursor, limit) {
        const parsedLimit = limit === undefined ? 50 : Number(limit);
        return this.wagering.listLedger(walletId, cursor, parsedLimit);
    }
    reconcile(walletId) {
        return this.wagering.reconcile(walletId);
    }
};
__decorate([
    Post(),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "open", null);
__decorate([
    Get(':walletId'),
    __param(0, Param('walletId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "get", null);
__decorate([
    Get(':walletId/ledger'),
    __param(0, Param('walletId')),
    __param(1, Query('cursor')),
    __param(2, Query('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "ledger", null);
__decorate([
    Post(':walletId/reconciliation'),
    __param(0, Param('walletId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "reconcile", null);
WalletController = __decorate([
    Controller('wallets'),
    UseGuards(NoopAuthGuard),
    __metadata("design:paramtypes", [WageringService])
], WalletController);
export { WalletController };
//# sourceMappingURL=wallet.controller.js.map