var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, } from '@nestjs/common';
import { WageringService } from '../../application/wagering/wagering.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.js';
import { SqsService } from '../messaging/sqs.module.js';
export class PermanentSqsMessageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PermanentSqsMessageError';
    }
}
const transientSqlStates = new Set([
    '40001',
    '40P01',
    '53300',
    '55P03',
    '57014',
    '57P01',
    '57P02',
    '57P03',
]);
const transientNetworkCodes = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'ETIMEDOUT',
]);
export function classifySqsFailure(error) {
    if (error instanceof PermanentSqsMessageError ||
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof SyntaxError) {
        return 'permanent';
    }
    const code = getErrorCode(error);
    if (code?.startsWith('08') ||
        transientSqlStates.has(code ?? '') ||
        transientNetworkCodes.has(code ?? '')) {
        return 'transient';
    }
    if (code && /^[0-9A-Z]{5}$/u.test(code)) {
        return 'permanent';
    }
    return 'transient';
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isWagerMessage(value) {
    if (!isRecord(value) ||
        value['type'] !== 'WagerTransactionRequested' ||
        typeof value['messageId'] !== 'string' ||
        value['messageId'].trim().length === 0 ||
        !isRecord(value['data'])) {
        return false;
    }
    const data = value['data'];
    const money = data['money'];
    return (typeof data['idempotencyKey'] === 'string' &&
        typeof data['providerId'] === 'string' &&
        typeof data['externalTransactionId'] === 'string' &&
        typeof data['playerId'] === 'string' &&
        typeof data['walletId'] === 'string' &&
        typeof data['roundId'] === 'string' &&
        typeof data['gameId'] === 'string' &&
        typeof data['kind'] === 'string' &&
        isRecord(money) &&
        typeof money['amount'] === 'string' &&
        typeof money['currency'] === 'string');
}
function getErrorCode(error) {
    if (!isRecord(error)) {
        return undefined;
    }
    if ('driverError' in error) {
        const driverCode = getErrorCode(error['driverError']);
        if (driverCode) {
            return driverCode;
        }
    }
    return typeof error['code'] === 'string' ? error['code'] : undefined;
}
let SqsTransactionConsumer = class SqsTransactionConsumer {
    sqs;
    wagering;
    metrics;
    logger;
    running = false;
    loopPromise;
    constructor(sqs, wagering, metrics, logger) {
        this.sqs = sqs;
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
                const messages = await this.sqs.receiveTransactions();
                await Promise.all(messages.map((message) => this.handle(message)));
            }
            catch {
                this.metrics.increment('retries');
                this.logger.warn('sqs.transaction_poll_failed');
                await this.delay(1000);
            }
        }
    }
    async handle(message) {
        if (!message.Body || !message.MessageId || !message.ReceiptHandle) {
            this.logger.error('sqs.transaction_message_incomplete', {
                messageId: message.MessageId,
            });
            return;
        }
        try {
            const envelope = JSON.parse(message.Body);
            if (!isWagerMessage(envelope)) {
                throw new PermanentSqsMessageError('Invalid SQS transaction message');
            }
            const parsed = envelope;
            const result = await this.wagering.submit(parsed.data, parsed.data.idempotencyKey, {
                correlationId: parsed.correlationId ?? randomUUID(),
                messageId: parsed.messageId,
                consumerName: 'wager-transaction-consumer',
                inboxPayloadHash: createHash('sha256').update(message.Body).digest('hex'),
            });
            await this.sqs.acknowledgeTransaction(message.ReceiptHandle);
            this.logger.info('sqs.transaction_acknowledged', {
                correlationId: parsed.correlationId,
                messageId: parsed.messageId,
                transactionId: result.transactionId,
                walletId: parsed.data.walletId,
                providerId: parsed.data.providerId,
                errorCode: result.failureCode,
            });
        }
        catch (error) {
            this.metrics.increment('retries');
            const context = {
                messageId: message.MessageId,
                errorCode: getErrorCode(error) ?? (error instanceof Error ? error.name : 'UNKNOWN'),
            };
            if (classifySqsFailure(error) === 'permanent') {
                this.logger.error('sqs.transaction_permanent_failure', context);
            }
            else {
                this.logger.warn('sqs.transaction_retry', context);
            }
        }
    }
    delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
};
SqsTransactionConsumer = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [SqsService,
        WageringService,
        MetricsService,
        StructuredLogger])
], SqsTransactionConsumer);
export { SqsTransactionConsumer };
//# sourceMappingURL=sqs-transaction-consumer.js.map