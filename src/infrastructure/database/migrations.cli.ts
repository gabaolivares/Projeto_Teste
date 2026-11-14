import { createDataSource } from './data-source.js';

const operation = process.argv[2];
if (operation !== 'run' && operation !== 'revert') {
  throw new Error('Usage: bun run <migration:run|migration:revert>');
}

const dataSource = createDataSource();
try {
  await dataSource.initialize();
  if (operation === 'run') {
    await dataSource.runMigrations({ transaction: 'all' });
  } else {
    await dataSource.undoLastMigration({ transaction: 'all' });
  }
} finally {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
