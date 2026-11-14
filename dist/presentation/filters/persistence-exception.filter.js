var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Catch, } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.js';
let PersistenceExceptionFilter = class PersistenceExceptionFilter {
    logger;
    constructor(logger) {
        this.logger = logger;
    }
    catch(exception, host) {
        const response = host.switchToHttp().getResponse();
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
        if (code?.startsWith('08') ||
            ['40001', '40P01', '55P03', '57P01', '57P02', '57P03'].includes(code ?? '')) {
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
    driverCode(exception) {
        const driverError = exception.driverError;
        if (typeof driverError === 'object' &&
            driverError !== null &&
            'code' in driverError &&
            typeof driverError.code === 'string') {
            return driverError.code;
        }
        return undefined;
    }
};
PersistenceExceptionFilter = __decorate([
    Catch(QueryFailedError),
    __metadata("design:paramtypes", [StructuredLogger])
], PersistenceExceptionFilter);
export { PersistenceExceptionFilter };
//# sourceMappingURL=persistence-exception.filter.js.map