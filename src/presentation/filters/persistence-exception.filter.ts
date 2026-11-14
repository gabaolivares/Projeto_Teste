import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { Response } from 'express';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.js';

@Catch(QueryFailedError)
export class PersistenceExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const code = this.driverCode(exception);
    this.logger.error('persistence.query_failed', {
      errorCode: code ?? 'UNKNOWN',
    });

    if (code === '23505') {
      response.status(409).json({
        statusCode: 409,
        code: 'PERSISTENCE_CONFLICT',
        message: 'A conflicting record already exists',
      });
      return;
    }

    if (
      code?.startsWith('08') ||
      ['40001', '40P01', '55P03', '57P01', '57P02', '57P03'].includes(code ?? '')
    ) {
      response.status(503).json({
        statusCode: 503,
        code: 'TRANSIENT_PERSISTENCE_FAILURE',
        message: 'The persistence service is temporarily unavailable',
      });
      return;
    }

    response.status(500).json({
      statusCode: 500,
      code: 'PERSISTENCE_FAILURE',
      message: 'The persistence operation failed',
    });
  }

  private driverCode(exception: QueryFailedError): string | undefined {
    const driverError: unknown = exception.driverError;
    if (
      typeof driverError === 'object' &&
      driverError !== null &&
      'code' in driverError &&
      typeof driverError.code === 'string'
    ) {
      return driverError.code;
    }
    return undefined;
  }
}
