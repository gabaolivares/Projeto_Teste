export declare class MetricsService {
    private readonly counters;
    private readonly statusCounts;
    private latencyCount;
    private latencyTotalMs;
    private outboxLagSeconds;
    private dlqMessages;
    increment(name: string, amount?: number): void;
    transactionStatus(status: string): void;
    observeProcessingLatency(milliseconds: number): void;
    setOutboxLag(seconds: number): void;
    setDlqMessages(count: number): void;
    render(): string;
}
