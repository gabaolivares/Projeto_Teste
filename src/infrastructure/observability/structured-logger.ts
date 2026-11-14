import { Injectable } from '@nestjs/common';

export interface LogContext {
  readonly correlationId?: string;
  readonly messageId?: string;
  readonly transactionId?: string;
  readonly walletId?: string;
  readonly providerId?: string;
  readonly errorCode?: string;
}

@Injectable()
export class StructuredLogger {
  info(event: string, context: LogContext = {}): void {
    this.write('info', event, context);
  }

  warn(event: string, context: LogContext = {}): void {
    this.write('warn', event, context);
  }

  error(event: string, context: LogContext = {}): void {
    this.write('error', event, context);
  }

  private write(level: string, event: string, context: LogContext): void {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...context,
      }),
    );
  }
}
