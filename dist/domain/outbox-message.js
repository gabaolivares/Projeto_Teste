import { randomUUID } from 'node:crypto';
export class OutboxMessage {
    id;
    aggregateId;
    eventType;
    payload;
    _occurredAt;
    _attempts;
    _nextAttemptAt;
    _publishedAt;
    constructor(id, aggregateId, eventType, payload, occurredAt, attempts, nextAttemptAt, publishedAt) {
        this.id = id;
        this.aggregateId = aggregateId;
        this.eventType = eventType;
        this.payload = payload;
        this._occurredAt = this.copyValidDate(occurredAt);
        this._attempts = attempts;
        this._nextAttemptAt = nextAttemptAt ? new Date(nextAttemptAt.getTime()) : undefined;
        this._publishedAt = publishedAt ? new Date(publishedAt.getTime()) : undefined;
    }
    static enqueue(event) {
        const envelope = event.toJSON();
        return new OutboxMessage(envelope.eventId || randomUUID(), envelope.aggregateId, envelope.eventType, this.deepFreeze(envelope), event.occurredAt, 0);
    }
    static rehydrate(state) {
        return new OutboxMessage(state.id, state.aggregateId, state.eventType, this.deepFreeze({ ...state.payload }), state.occurredAt, state.attempts, state.nextAttemptAt, state.publishedAt);
    }
    get attempts() {
        return this._attempts;
    }
    get occurredAt() {
        return new Date(this._occurredAt.getTime());
    }
    get nextAttemptAt() {
        return this._nextAttemptAt ? new Date(this._nextAttemptAt.getTime()) : undefined;
    }
    get publishedAt() {
        return this._publishedAt ? new Date(this._publishedAt.getTime()) : undefined;
    }
    isPending() {
        return this._publishedAt === undefined;
    }
    isDue(now) {
        return (this.isPending() &&
            (!this._nextAttemptAt || this._nextAttemptAt.getTime() <= now.getTime()));
    }
    markPublished(at) {
        if (!this.isPending()) {
            throw new Error('Published outbox messages are terminal');
        }
        this._publishedAt = this.copyValidDate(at);
    }
    scheduleRetry(now) {
        if (!this.isPending()) {
            throw new Error('Published outbox messages cannot be retried');
        }
        const validNow = this.copyValidDate(now);
        this._attempts += 1;
        const delaySeconds = Math.min(300, 2 ** Math.min(this._attempts, 8));
        this._nextAttemptAt = new Date(validNow.getTime() + delaySeconds * 1000);
    }
    copyValidDate(value) {
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            throw new Error('Outbox date must be valid');
        }
        return new Date(value.getTime());
    }
    static deepFreeze(value) {
        if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.values(value).forEach((item) => this.deepFreeze(item));
            Object.freeze(value);
        }
        return value;
    }
}
//# sourceMappingURL=outbox-message.js.map