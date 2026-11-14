var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from '@nestjs/common';
let StructuredLogger = class StructuredLogger {
    info(event, context = {}) {
        this.write('info', event, context);
    }
    warn(event, context = {}) {
        this.write('warn', event, context);
    }
    error(event, context = {}) {
        this.write('error', event, context);
    }
    write(level, event, context) {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            event,
            ...context,
        }));
    }
};
StructuredLogger = __decorate([
    Injectable()
], StructuredLogger);
export { StructuredLogger };
//# sourceMappingURL=structured-logger.js.map