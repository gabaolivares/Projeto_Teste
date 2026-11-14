export interface ReceiveInboxProps {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  readonly receivedAt?: Date;
}

export interface InboxMessageState extends ReceiveInboxProps {
  readonly receivedAt: Date;
  readonly processedAt?: Date;
}

export class InboxMessage {
  private readonly _receivedAt: Date;
  private _processedAt?: Date;

  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    receivedAt: Date,
    processedAt?: Date,
  ) {
    this._receivedAt = this.copyValidDate(receivedAt);
    this._processedAt = processedAt ? this.copyValidDate(processedAt) : undefined;
  }

  static receive(props: ReceiveInboxProps): InboxMessage {
    this.assertRequired(props.messageId, 'messageId');
    this.assertRequired(props.consumerName, 'consumerName');
    if (!/^[a-f0-9]{64}$/u.test(props.payloadHash)) {
      throw new Error('Inbox payload hash must be a SHA-256 hex digest');
    }
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt ?? new Date(),
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get receivedAt(): Date {
    return new Date(this._receivedAt.getTime());
  }

  get processedAt(): Date | undefined {
    return this._processedAt ? new Date(this._processedAt.getTime()) : undefined;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (!this._processedAt) {
      this._processedAt = this.copyValidDate(at);
    }
  }

  private static assertRequired(value: string, field: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Inbox ${field} is required`);
    }
  }

  private copyValidDate(value: Date): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error('Inbox date must be valid');
    }
    return new Date(value.getTime());
  }
}
