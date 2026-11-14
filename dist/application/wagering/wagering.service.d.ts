import { DataSource } from 'typeorm';
import { type MoneyProps } from '../../domain/money.js';
import { WagerTransactionStatus } from '../../domain/wager-transaction.js';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.js';
export interface SubmitWagerInput {
    readonly providerId: string;
    readonly externalTransactionId: string;
    readonly playerId: string;
    readonly walletId: string;
    readonly roundId: string;
    readonly gameId: string;
    readonly kind: string;
    readonly money: MoneyProps;
    readonly referenceExternalTransactionId?: string;
}
export interface ProcessContext {
    readonly correlationId: string;
    readonly messageId?: string;
    readonly consumerName?: string;
    readonly inboxPayloadHash?: string;
}
export interface WagerResult {
    readonly transactionId: string;
    readonly status: WagerTransactionStatus;
    readonly balance?: MoneyProps;
    readonly failureCode?: string;
    readonly idempotentReplay: boolean;
}
export interface WalletSummary {
    readonly id: string;
    readonly playerId: string;
    readonly balance: MoneyProps;
    readonly version: number;
}
export declare class WageringService {
    private readonly dataSource;
    private readonly metrics;
    private readonly logger;
    constructor(dataSource: DataSource, metrics: MetricsService, logger: StructuredLogger);
    openWallet(input: {
        readonly playerId: string;
        readonly initialBalance: MoneyProps;
    }): Promise<WalletSummary>;
    getWallet(walletId: string): Promise<WalletSummary>;
    submit(input: SubmitWagerInput, idempotencyKey: string, context: ProcessContext): Promise<WagerResult>;
    findTransaction(transactionId: string): Promise<WagerResult>;
    findProviderTransaction(providerId: string, externalTransactionId: string): Promise<WagerResult>;
    listLedger(walletId: string, cursor: string | undefined, limit: number): Promise<{
        entries: Array<Record<string, unknown>>;
        nextCursor?: string;
    }>;
    reconcile(walletId: string): Promise<{
        walletId: string;
        storedBalance: MoneyProps;
        calculatedBalance: MoneyProps;
        difference: MoneyProps;
        consistent: boolean;
        checkedEntries: number;
    }>;
    processPendingReferences(): Promise<void>;
    getOutboxLagSeconds(): Promise<number>;
    private applyTransaction;
    private rejectTransaction;
    private deferTransaction;
    private validateReference;
    private isReferenceWaiting;
    private insertLedger;
    private enqueueEvent;
    private persistOpeningTransaction;
    private parseWager;
    private parseMoney;
    private hashBusinessPayload;
    private canonicalJson;
    private findByIdempotency;
    private resultFromRow;
    private markInboxProcessed;
    private toWallet;
    private toDomain;
    private walletSummary;
    private assertUuid;
    private canonicalAmount;
    private encodeCursor;
    private decodeCursor;
    private isPostgresError;
}
