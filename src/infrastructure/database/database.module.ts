import {
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}

@Module({
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
export class DatabaseModule {}
