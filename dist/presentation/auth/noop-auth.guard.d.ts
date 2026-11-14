import { type CanActivate, type ExecutionContext } from '@nestjs/common';
export declare class NoopAuthGuard implements CanActivate {
    canActivate(_context: ExecutionContext): boolean;
}
