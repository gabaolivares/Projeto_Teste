import { WageringService } from '../../application/wagering/wagering.service.js';
interface OpenWalletBody {
    readonly playerId: string;
    readonly initialBalance: {
        readonly amount: string;
        readonly currency: string;
    };
}
export declare class WalletController {
    private readonly wagering;
    constructor(wagering: WageringService);
    open(body: OpenWalletBody): Promise<import("../../application/wagering/wagering.service.js").WalletSummary>;
    get(walletId: string): Promise<import("../../application/wagering/wagering.service.js").WalletSummary>;
    ledger(walletId: string, cursor: string | undefined, limit: string | undefined): Promise<{
        entries: Array<Record<string, unknown>>;
        nextCursor?: string;
    }>;
    reconcile(walletId: string): Promise<{
        walletId: string;
        storedBalance: import("../../domain/money.js").MoneyProps;
        calculatedBalance: import("../../domain/money.js").MoneyProps;
        difference: import("../../domain/money.js").MoneyProps;
        consistent: boolean;
        checkedEntries: number;
    }>;
}
export {};
