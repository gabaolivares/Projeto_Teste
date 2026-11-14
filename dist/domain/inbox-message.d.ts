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
export declare class InboxMessage {
    readonly messageId: string;
    readonly consumerName: string;
    readonly payloadHash: string;
    private readonly _receivedAt;
    private _processedAt?;
    private constructor();
    static receive(props: ReceiveInboxProps): InboxMessage;
    static rehydrate(state: InboxMessageState): InboxMessage;
    get receivedAt(): Date;
    get processedAt(): Date | undefined;
    isProcessed(): boolean;
    markProcessed(at: Date): void;
    private static assertRequired;
    private copyValidDate;
}
