import { Money } from './money.js';
export var WagerTransactionKind;
(function (WagerTransactionKind) {
    WagerTransactionKind["Opening"] = "OPENING";
    WagerTransactionKind["Bet"] = "BET";
    WagerTransactionKind["Win"] = "WIN";
    WagerTransactionKind["Loss"] = "LOSS";
    WagerTransactionKind["Refund"] = "REFUND";
    WagerTransactionKind["Rollback"] = "ROLLBACK";
})(WagerTransactionKind || (WagerTransactionKind = {}));
export var WagerTransactionStatus;
(function (WagerTransactionStatus) {
    WagerTransactionStatus["Pending"] = "PENDING";
    WagerTransactionStatus["PendingReference"] = "PENDING_REFERENCE";
    WagerTransactionStatus["Processed"] = "PROCESSED";
    WagerTransactionStatus["Rejected"] = "REJECTED";
    WagerTransactionStatus["Failed"] = "FAILED";
})(WagerTransactionStatus || (WagerTransactionStatus = {}));
export class InvalidTransactionStateError extends Error {
    constructor(status) {
        super(`Cannot transition a ${status} wager transaction`);
        this.name = 'InvalidTransactionStateError';
    }
}
export class WagerTransaction {
    id;
    providerId;
    externalTransactionId;
    idempotencyKey;
    payloadHash;
    walletId;
    playerId;
    roundId;
    gameId;
    kind;
    money;
    referenceExternalTransactionId;
    _status;
    _referenceTransactionId;
    _failureCode;
    _processedAt;
    _createdAt;
    constructor(id, providerId, externalTransactionId, idempotencyKey, payloadHash, walletId, playerId, roundId, gameId, kind, money, referenceExternalTransactionId, createdAt, _status, _referenceTransactionId, _failureCode, _processedAt) {
        this.id = id;
        this.providerId = providerId;
        this.externalTransactionId = externalTransactionId;
        this.idempotencyKey = idempotencyKey;
        this.payloadHash = payloadHash;
        this.walletId = walletId;
        this.playerId = playerId;
        this.roundId = roundId;
        this.gameId = gameId;
        this.kind = kind;
        this.money = money;
        this.referenceExternalTransactionId = referenceExternalTransactionId;
        this._status = _status;
        this._referenceTransactionId = _referenceTransactionId;
        this._failureCode = _failureCode;
        this._processedAt = _processedAt;
        this._createdAt = WagerTransaction.copyValidDate(createdAt);
    }
    static create(props) {
        for (const [field, value] of Object.entries({
            id: props.id,
            providerId: props.providerId,
            externalTransactionId: props.externalTransactionId,
            idempotencyKey: props.idempotencyKey,
            payloadHash: props.payloadHash,
            walletId: props.walletId,
            playerId: props.playerId,
            roundId: props.roundId,
            gameId: props.gameId,
        })) {
            if (typeof value !== 'string' || value.trim().length === 0) {
                throw new Error(`Wager transaction ${field} is required`);
            }
        }
        if (!/^[a-f0-9]{64}$/u.test(props.payloadHash)) {
            throw new Error('Wager transaction payload hash must be a SHA-256 hex digest');
        }
        if (!Object.values(WagerTransactionKind).includes(props.kind)) {
            throw new Error('Wager transaction kind is invalid');
        }
        if (props.kind === WagerTransactionKind.Opening) {
            throw new Error('OPENING transactions cannot be submitted externally');
        }
        if (!(props.money instanceof Money) || !props.money.isPositive()) {
            throw new Error('Wager transaction amount must be positive');
        }
        if ([WagerTransactionKind.Refund, WagerTransactionKind.Rollback].includes(props.kind) &&
            !props.referenceExternalTransactionId) {
            throw new Error(`${props.kind} requires a reference transaction`);
        }
        if ([WagerTransactionKind.Bet, WagerTransactionKind.Loss].includes(props.kind) &&
            props.referenceExternalTransactionId) {
            throw new Error(`${props.kind} cannot reference another transaction`);
        }
        return new WagerTransaction(props.id, props.providerId, props.externalTransactionId, props.idempotencyKey, props.payloadHash, props.walletId, props.playerId, props.roundId, props.gameId, props.kind, props.money, props.referenceExternalTransactionId, props.createdAt ?? new Date(), WagerTransactionStatus.Pending);
    }
    static rehydrate(state) {
        const transaction = new WagerTransaction(state.id, state.providerId, state.externalTransactionId, state.idempotencyKey, state.payloadHash, state.walletId, state.playerId, state.roundId, state.gameId, state.kind, Money.from(state.money), state.referenceExternalTransactionId, state.createdAt, state.status, state.referenceTransactionId, state.failureCode, state.processedAt ? this.copyValidDate(state.processedAt) : undefined);
        return transaction;
    }
    get status() {
        return this._status;
    }
    get createdAt() {
        return new Date(this._createdAt.getTime());
    }
    get referenceTransactionId() {
        return this._referenceTransactionId;
    }
    get failureCode() {
        return this._failureCode;
    }
    get processedAt() {
        return this._processedAt ? new Date(this._processedAt.getTime()) : undefined;
    }
    isTerminal() {
        return [
            WagerTransactionStatus.Processed,
            WagerTransactionStatus.Rejected,
            WagerTransactionStatus.Failed,
        ].includes(this._status);
    }
    affectsBalance() {
        return this.kind !== WagerTransactionKind.Loss;
    }
    requiresReference() {
        return (this.kind === WagerTransactionKind.Refund ||
            this.kind === WagerTransactionKind.Rollback);
    }
    matchesPayload(payloadHash) {
        return this.payloadHash === payloadHash;
    }
    ledgerDirectionFor(reference) {
        switch (this.kind) {
            case WagerTransactionKind.Bet:
                return 'DEBIT';
            case WagerTransactionKind.Win:
            case WagerTransactionKind.Refund:
            case WagerTransactionKind.Opening:
                return 'CREDIT';
            case WagerTransactionKind.Loss:
                return undefined;
            case WagerTransactionKind.Rollback:
                if (!reference) {
                    throw new Error('ROLLBACK ledger direction requires its reference');
                }
                if (![
                    WagerTransactionKind.Bet,
                    WagerTransactionKind.Win,
                    WagerTransactionKind.Refund,
                ].includes(reference.kind)) {
                    throw new Error('ROLLBACK reference kind is invalid');
                }
                return reference.ledgerDirectionFor() === 'DEBIT' ? 'CREDIT' : 'DEBIT';
        }
    }
    markProcessed(referenceTransactionId, at) {
        this.assertTransitionAllowed();
        this._status = WagerTransactionStatus.Processed;
        this._referenceTransactionId = referenceTransactionId;
        this._failureCode = undefined;
        this._processedAt = WagerTransaction.copyValidDate(at);
    }
    markPendingReference() {
        this.assertTransitionAllowed();
        this._status = WagerTransactionStatus.PendingReference;
        this._referenceTransactionId = undefined;
        this._failureCode = undefined;
        this._processedAt = undefined;
    }
    reject(code) {
        this.assertTransitionAllowed();
        this._status = WagerTransactionStatus.Rejected;
        this._failureCode = code;
    }
    fail(code) {
        this.assertTransitionAllowed();
        this._status = WagerTransactionStatus.Failed;
        this._failureCode = code;
    }
    assertTransitionAllowed() {
        if (this.isTerminal()) {
            throw new InvalidTransactionStateError(this._status);
        }
    }
    static copyValidDate(value) {
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            throw new Error('Wager transaction date must be valid');
        }
        return new Date(value.getTime());
    }
}
//# sourceMappingURL=wager-transaction.js.map