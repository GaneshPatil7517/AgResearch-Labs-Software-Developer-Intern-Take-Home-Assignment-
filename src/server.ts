import dotenv from 'dotenv';
import { getDatabasePool } from './db/connection.js';
import { buildApp } from './app.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const db = getDatabasePool();
  const app = buildApp({
    db,
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  try {
    const address = await app.listen({ port: PORT, host: HOST });
    console.log(`🚀 AgResearch Labs API server running at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
