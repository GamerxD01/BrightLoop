import { env } from './config/env';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { pool } from './db/pool';
import { logger } from './lib/logger';

async function main() {
  await migrate();
  const server = createApp().listen(env.PORT, () => {
    logger.info(`Brightloop API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => void pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
