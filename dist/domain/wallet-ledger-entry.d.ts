import { Money } from './money.js';
export type LedgerDirection = 'DEBIT' | 'CREDIT';
export interface CreateLedgerEntryProps {
    readonly id: string;
    readonly walletId: string;
    readonly transactionId: string;
    readonly direction: LedgerDirection;
    readonly money: Money;
    readonly balanceBefore: Money;
    readonly balanceAfter: Money;
    readonly createdAt?: Date;
}
export interface LedgerEntryState extends Omit<CreateLedgerEntryProps, 'createdAt'> {
    readonly createdAt: Date;
}
export declare class WalletLedgerEntry {
    readonly id: string;
    readonly walletId: string;
    readonly transactionId: string;
    readonly direction: LedgerDirection;
    readonly money: Money;
    readonly balanceBefore: Money;
    readonly balanceAfter: Money;
    private readonly _createdAt;
    private constructor();
    static create(props: CreateLedgerEntryProps): WalletLedgerEntry;
    static rehydrate(state: LedgerEntryState): WalletLedgerEntry;
    get createdAt(): Date;
    isBalanced(): boolean;
    private copyValidDate;
}
