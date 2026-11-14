var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Inject, Injectable, Module, } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';
let DatabaseShutdown = class DatabaseShutdown {
    dataSource;
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    async onApplicationShutdown() {
        if (this.dataSource.isInitialized) {
            await this.dataSource.destroy();
        }
    }
};
DatabaseShutdown = __decorate([
    Injectable(),
    __param(0, Inject(DataSource)),
    __metadata("design:paramtypes", [DataSource])
], DatabaseShutdown);
let DatabaseModule = class DatabaseModule {
};
DatabaseModule = __decorate([
    Module({
        providers: [
            {
                provide: DataSource,
                useFactory: async () => {
                    const dataSource = createDataSource();
                    await dataSource.initialize();
                    await dataSource.runMigrations({ transaction: 'all' });
                    return dataSource;
                },
            },
            DatabaseShutdown,
        ],
        exports: [DataSource],
    })
], DatabaseModule);
export { DatabaseModule };
//# sourceMappingURL=database.module.js.map