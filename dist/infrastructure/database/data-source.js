import { DataSource } from 'typeorm';
import { InitialWageringSchema1710000000000 } from './migrations/1710000000000-InitialWageringSchema.js';
export function createDataSource() {
    return new DataSource({
        type: 'postgres',
        url: process.env.DATABASE_URL ??
            'postgres://jungle_user:jungle_pass@localhost:5432/jungle_db',
        migrations: [InitialWageringSchema1710000000000],
        migrationsTableName: 'typeorm_migrations',
        synchronize: false,
        logging: false,
        extra: { max: 20, connectionTimeoutMillis: 5000 },
    });
}
//# sourceMappingURL=data-source.js.map