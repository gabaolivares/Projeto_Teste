import { Money } from './money.js';
export class WalletLedgerEntry {
    id;
    walletId;
    transactionId;
    direction;
    money;
    balanceBefore;
    balanceAfter;
    _createdAt;
    constructor(id, walletId, transactionId, direction, money, balanceBefore, balanceAfter, createdAt) {
        this.id = id;
        this.walletId = walletId;
        this.transactionId = transactionId;
        this.direction = direction;
        this.money = money;
        this.balanceBefore = balanceBefore;
        this.balanceAfter = balanceAfter;
        this._createdAt = this.copyValidDate(createdAt);
        Object.freeze(this);
    }
    static create(props) {
        if (!['DEBIT', 'CREDIT'].includes(props.direction)) {
            throw new Error('Ledger direction is invalid');
        }
        if (!(props.money instanceof Money) || !props.money.isPositive()) {
            throw new Error('Ledger amount must be positive');
        }
        const entry = new WalletLedgerEntry(props.id, props.walletId, props.transactionId, props.direction, props.money, props.balanceBefore, props.balanceAfter, props.createdAt ?? new Date());
        if (!entry.isBalanced()) {
            throw new Error('Ledger entry balance arithmetic is invalid');
        }
        return entry;
    }
    static rehydrate(state) {
        return new WalletLedgerEntry(state.id, state.walletId, state.transactionId, state.direction, state.money, state.balanceBefore, state.balanceAfter, state.createdAt);
    }
    get createdAt() {
        return new Date(this._createdAt.getTime());
    }
    isBalanced() {
        if (this.money.currency !== this.balanceBefore.currency ||
            this.money.currency !== this.balanceAfter.currency) {
            return false;
        }
        const expected = this.direction === 'DEBIT'
            ? this.balanceBefore.subtract(this.money)
            : this.balanceBefore.add(this.money);
        return !this.balanceAfter.isNegative() && expected.equals(this.balanceAfter);
    }
    copyValidDate(value) {
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            throw new Error('Ledger entry date must be valid');
        }
        return new Date(value.getTime());
    }
}
//# sourceMappingURL=wallet-ledger-entry.js.map