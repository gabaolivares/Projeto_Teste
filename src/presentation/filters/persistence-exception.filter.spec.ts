import type { ArgumentsHost } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { PersistenceExceptionFilter } from './persistence-exception.filter.js';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.js';

describe('PersistenceExceptionFilter', () => {
  const logger = new StructuredLogger();
  const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  const filter = new PersistenceExceptionFilter(logger);

  function invoke(code: string) {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const driverError = Object.assign(new Error('database error'), { code });

    filter.catch(
      new QueryFailedError('SELECT 1', [], driverError),
      host,
    );

    return response;
  }

  afterEach(() => {
    logError.mockClear();
  });

  it('maps transient PostgreSQL failures to 503 without leaking query details', () => {
    const response = invoke('40001');

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 503,
      code: 'TRANSIENT_PERSISTENCE_FAILURE',
      message: 'The persistence service is temporarily unavailable',
    });
    expect(logError).toHaveBeenCalledWith('persistence.query_failed', {
      errorCode: '40001',
    });
  });

  it('maps unique constraint conflicts to 409', () => {
    const response = invoke('23505');

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 409,
      code: 'PERSISTENCE_CONFLICT',
      message: 'A conflicting record already exists',
    });
  });
});
