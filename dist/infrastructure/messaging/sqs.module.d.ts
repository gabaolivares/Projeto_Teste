import { OnModuleInit } from '@nestjs/common';
import { type Message } from '@aws-sdk/client-sqs';
export declare class SqsService implements OnModuleInit {
    private transactionQueueUrl;
    private deadLetterQueueUrl;
    private eventQueueUrl;
    private visibilityTimeoutSeconds;
    private readonly client;
    onModuleInit(): Promise<void>;
    receiveTransactions(): Promise<Message[]>;
    acknowledgeTransaction(receiptHandle: string): Promise<void>;
    sendTransaction(message: {
        readonly messageId: string;
        readonly type: 'WagerTransactionRequested';
        readonly occurredAt: string;
        readonly correlationId?: string;
        readonly data: {
            readonly walletId: string;
            readonly idempotencyKey: string;
        } & Record<string, unknown>;
    }): Promise<string>;
    publishEvent(event: {
        readonly eventId: string;
        readonly aggregateId: string;
        readonly eventType: string;
        readonly occurredAt: string;
        readonly [key: string]: unknown;
    }): Promise<void>;
    isReachable(): Promise<void>;
    deadLetterCount(): Promise<number>;
    private createQueue;
}
export declare class SqsModule {
}
