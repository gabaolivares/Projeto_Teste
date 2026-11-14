export class IntegrationEvent {
    eventId;
    aggregateId;
    correlationId;
    causationId;
    _occurredAt;
    data;
    constructor(props) {
        this.eventId = props.eventId;
        this.aggregateId = props.aggregateId;
        this.correlationId = props.correlationId;
        this.causationId = props.causationId;
        this._occurredAt = new Date(props.occurredAt.getTime());
        this.data = this.deepFreeze({ ...props.data });
    }
    get occurredAt() {
        return new Date(this._occurredAt.getTime());
    }
    toJSON() {
        return {
            eventId: this.eventId,
            eventType: this.eventType,
            aggregateId: this.aggregateId,
            correlationId: this.correlationId,
            ...(this.causationId ? { causationId: this.causationId } : {}),
            occurredAt: this.occurredAt.toISOString(),
            version: this.version,
            data: this.data,
        };
    }
    deepFreeze(value) {
        if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.values(value).forEach((item) => this.deepFreeze(item));
            Object.freeze(value);
        }
        return value;
    }
}
export class WagerTransactionProcessed extends IntegrationEvent {
    eventType = 'WagerTransactionProcessed';
    version = 1;
    constructor(props) {
        super(props);
        Object.freeze(this);
    }
}
export class WagerTransactionRejected extends IntegrationEvent {
    eventType = 'WagerTransactionRejected';
    version = 1;
    constructor(props) {
        super(props);
        Object.freeze(this);
    }
}
export class WagerTransactionPendingReference extends IntegrationEvent {
    eventType = 'WagerTransactionPendingReference';
    version = 1;
    constructor(props) {
        super(props);
        Object.freeze(this);
    }
}
export class WalletBalanceChanged extends IntegrationEvent {
    eventType = 'WalletBalanceChanged';
    version = 1;
    constructor(props) {
        super(props);
        Object.freeze(this);
    }
}
//# sourceMappingURL=integration-events.js.map