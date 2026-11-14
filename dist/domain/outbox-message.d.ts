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
export declare class OutboxMessage {
    readonly id: string;
    readonly aggregateId: string;
    readonly eventType: string;
    readonly payload: Readonly<Record<string, unknown>>;
    private readonly _occurredAt;
    private _attempts;
    private _nextAttemptAt?;
    private _publishedAt?;
    private constructor();
    static enqueue(event: IntegrationEvent<unknown>): OutboxMessage;
    static rehydrate(state: OutboxMessageState): OutboxMessage;
    get attempts(): number;
    get occurredAt(): Date;
    get nextAttemptAt(): Date | undefined;
    get publishedAt(): Date | undefined;
    isPending(): boolean;
    isDue(now: Date): boolean;
    markPublished(at: Date): void;
    scheduleRetry(now: Date): void;
    private copyValidDate;
    private static deepFreeze;
}
