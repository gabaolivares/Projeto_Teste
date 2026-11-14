import { randomUUID } from 'node:crypto';
import type { IntegrationEvent } from './integration-events.js';

export interface OutboxMessageState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt?: Date;
  readonly publishedAt?: Date;
}

export class OutboxMessage {
  private readonly _occurredAt: Date;
  private _attempts: number;
  private _nextAttemptAt?: Date;
  private _publishedAt?: Date;

  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    occurredAt: Date,
    attempts: number,
    nextAttemptAt?: Date,
    publishedAt?: Date,
  ) {
    this._occurredAt = this.copyValidDate(occurredAt);
    this._attempts = attempts;
    this._nextAttemptAt = nextAttemptAt ? new Date(nextAttemptAt.getTime()) : undefined;
    this._publishedAt = publishedAt ? new Date(publishedAt.getTime()) : undefined;
  }

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    const envelope = event.toJSON();
    return new OutboxMessage(
      envelope.eventId || randomUUID(),
      envelope.aggregateId,
      envelope.eventType,
      this.deepFreeze(envelope),
      event.occurredAt,
      0,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      this.deepFreeze({ ...state.payload }),
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt ? new Date(this._nextAttemptAt.getTime()) : undefined;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt ? new Date(this._publishedAt.getTime()) : undefined;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    return (
      this.isPending() &&
      (!this._nextAttemptAt || this._nextAttemptAt.getTime() <= now.getTime())
    );
  }

  markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new Error('Published outbox messages are terminal');
    }
    this._publishedAt = this.copyValidDate(at);
  }

  scheduleRetry(now: Date): void {
    if (!this.isPending()) {
      throw new Error('Published outbox messages cannot be retried');
    }
    const validNow = this.copyValidDate(now);
    this._attempts += 1;
    const delaySeconds = Math.min(300, 2 ** Math.min(this._attempts, 8));
    this._nextAttemptAt = new Date(validNow.getTime() + delaySeconds * 1000);
  }

  private copyValidDate(value: Date): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error('Outbox date must be valid');
    }
    return new Date(value.getTime());
  }

  private static deepFreeze<Value>(value: Value): Readonly<Value> {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach((item) => this.deepFreeze(item));
      Object.freeze(value);
    }
    return value;
  }
}
