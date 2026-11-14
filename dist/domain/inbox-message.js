export class InboxMessage {
    messageId;
    consumerName;
    payloadHash;
    _receivedAt;
    _processedAt;
    constructor(messageId, consumerName, payloadHash, receivedAt, processedAt) {
        this.messageId = messageId;
        this.consumerName = consumerName;
        this.payloadHash = payloadHash;
        this._receivedAt = this.copyValidDate(receivedAt);
        this._processedAt = processedAt ? this.copyValidDate(processedAt) : undefined;
    }
    static receive(props) {
        this.assertRequired(props.messageId, 'messageId');
        this.assertRequired(props.consumerName, 'consumerName');
        if (!/^[a-f0-9]{64}$/u.test(props.payloadHash)) {
            throw new Error('Inbox payload hash must be a SHA-256 hex digest');
        }
        return new InboxMessage(props.messageId, props.consumerName, props.payloadHash, props.receivedAt ?? new Date());
    }
    static rehydrate(state) {
        return new InboxMessage(state.messageId, state.consumerName, state.payloadHash, state.receivedAt, state.processedAt);
    }
    get receivedAt() {
        return new Date(this._receivedAt.getTime());
    }
    get processedAt() {
        return this._processedAt ? new Date(this._processedAt.getTime()) : undefined;
    }
    isProcessed() {
        return this._processedAt !== undefined;
    }
    markProcessed(at) {
        if (!this._processedAt) {
            this._processedAt = this.copyValidDate(at);
        }
    }
    static assertRequired(value, field) {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`Inbox ${field} is required`);
        }
    }
    copyValidDate(value) {
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            throw new Error('Inbox date must be valid');
        }
        return new Date(value.getTime());
    }
}
//# sourceMappingURL=inbox-message.js.map