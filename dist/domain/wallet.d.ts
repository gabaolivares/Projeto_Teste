import { Money, type MoneyProps } from './money.js';
export interface WalletState {
    readonly id: string;
    readonly playerId: string;
    readonly currency: string;
    readonly balance: MoneyProps;
    readonly version: number;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}
export declare class Wallet {
    readonly id: string;
    readonly playerId: string;
    readonly currency: string;
    private readonly _createdAt;
    private _balance;
    private _version;
    private _updatedAt;
    private constructor();
    static open(props: {
        readonly id: string;
        readonly playerId: string;
        readonly initialBalance: Money;
    }): Wallet;
    static rehydrate(state: WalletState): Wallet;
    get balance(): Money;
    get version(): number;
    get createdAt(): Date;
    get updatedAt(): Date;
    debit(amount: Money, at?: Date): void;
    credit(amount: Money, at?: Date): void;
    private assertValidMovement;
    private updateBalance;
    private static assertIdentity;
    private static copyValidDate;
}
