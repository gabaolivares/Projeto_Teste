import { type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.js';
export declare class PersistenceExceptionFilter implements ExceptionFilter {
    private readonly logger;
    constructor(logger: StructuredLogger);
    catch(exception: QueryFailedError, host: ArgumentsHost): void;
    private driverCode;
}
