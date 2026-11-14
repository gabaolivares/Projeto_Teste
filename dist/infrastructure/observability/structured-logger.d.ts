export interface LogContext {
    readonly correlationId?: string;
    readonly messageId?: string;
    readonly transactionId?: string;
    readonly walletId?: string;
    readonly providerId?: string;
    readonly errorCode?: string;
}
export declare class StructuredLogger {
    info(event: string, context?: LogContext): void;
    warn(event: string, context?: LogContext): void;
    error(event: string, context?: LogContext): void;
    private write;
}
