import { Money } from './money.js';
export class Wallet {
    id;
    playerId;
    currency;
    _createdAt;
    _balance;
    _version;
    _updatedAt;
    constructor(id, playerId, currency, balance, version, createdAt, updatedAt) {
        this.id = id;
        this.playerId = playerId;
        this.currency = currency;
        this._balance = balance;
        this._version = version;
        this._createdAt = createdAt;
        this._updatedAt = updatedAt;
    }
    static open(props) {
        this.assertIdentity(props.id, 'id');
        this.assertIdentity(props.playerId, 'playerId');
        if (!(props.initialBalance instanceof Money) || props.initialBalance.isNegative()) {
            throw new Error('Initial wallet balance must be a non-negative Money value');
        }
        const now = new Date();
        return new Wallet(props.id, props.playerId, props.initialBalance.currency, props.initialBalance, 1, now, now);
    }
    static rehydrate(state) {
        this.assertIdentity(state.id, 'id');
        this.assertIdentity(state.playerId, 'playerId');
        if (!Number.isSafeInteger(state.version) || state.version < 1) {
            throw new Error('Wallet version must be a positive safe integer');
        }
        const balance = Money.from(state.balance);
        if (balance.currency !== state.currency) {
            throw new Error('Wallet currency must match its balance currency');
        }
        return new Wallet(state.id, state.playerId, state.currency, balance, state.version, this.copyValidDate(state.createdAt), this.copyValidDate(state.updatedAt));
    }
    get balance() {
        return this._balance;
    }
    get version() {
        return this._version;
    }
    get createdAt() {
        return new Date(this._createdAt.getTime());
    }
    get updatedAt() {
        return new Date(this._updatedAt.getTime());
    }
    debit(amount, at = new Date()) {
        this.assertValidMovement(amount);
        const nextBalance = this._balance.subtract(amount);
        if (nextBalance.isNegative()) {
            throw new Error('Insufficient wallet balance');
        }
        this.updateBalance(nextBalance, at);
    }
    credit(amount, at = new Date()) {
        this.assertValidMovement(amount);
        this.updateBalance(this._balance.add(amount), at);
    }
    assertValidMovement(amount) {
        if (!(amount instanceof Money) || amount.isNegative()) {
            throw new Error('Wallet movement must be a non-negative Money value');
        }
        if (amount.currency !== this.currency) {
            throw new Error('Wallet and movement currencies must match');
        }
    }
    updateBalance(nextBalance, at) {
        if (nextBalance.equals(this._balance)) {
            return;
        }
        if (this._version === Number.MAX_SAFE_INTEGER) {
            throw new Error('Wallet version cannot be incremented safely');
        }
        const updatedAt = Wallet.copyValidDate(at);
        this._balance = nextBalance;
        this._version += 1;
        this._updatedAt = updatedAt;
    }
    static assertIdentity(value, field) {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`Wallet ${field} is required`);
        }
    }
    static copyValidDate(value) {
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            throw new Error('Wallet timestamps must be valid dates');
        }
        return new Date(value.getTime());
    }
}
//# sourceMappingURL=wallet.js.map