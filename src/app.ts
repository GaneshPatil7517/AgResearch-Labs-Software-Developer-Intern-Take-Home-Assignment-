import fastify, { FastifyInstance, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import { DatabasePool } from './db/connection.js';
import { TrayService } from './services/tray.service.js';
import { BatchService } from './services/batch.service.js';
import { HarvestService } from './services/harvest.service.js';
import { ReportService } from './services/report.service.js';
import { trayRoutes } from './routes/trays.js';
import { batchRoutes } from './routes/batches.js';
import { reportRoutes } from './routes/reports.js';
import { AppError } from './domain/errors.js';
import { getDashboardHtml } from './ui/dashboard.js';

export interface AppOptions {
  db: DatabasePool;
  logger?: boolean | object;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = fastify({
    logger: opts.logger ?? {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // Register CORS
  app.register(cors, {
    origin: '*',
  });

  // Services
  const trayService = new TrayService(opts.db);
  const batchService = new BatchService(opts.db);
  const ttlHours = parseInt(process.env.IDEMPOTENCY_TTL_HOURS || '24', 10);
  const harvestService = new HarvestService(opts.db, ttlHours);
  const reportService = new ReportService(opts.db);

  // Root interactive operations console
  app.get('/', async (request, reply) => {
    return reply.type('text/html').send(getDashboardHtml());
  });

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'healthy', timestamp: new Date().toISOString() };
  });

  // Register domain routes
  app.register(trayRoutes, { trayService });
  app.register(batchRoutes, { batchService, harvestService });
  app.register(reportRoutes, { reportService });

  // Centralized Error Handler
  app.setErrorHandler((error: FastifyError | Error | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        statusCode: error.statusCode,
        details: error.details,
      });
    }

    const fastifyErr = error as FastifyError;
    if (fastifyErr.statusCode && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500) {
      return reply.status(fastifyErr.statusCode).send({
        error: 'CLIENT_ERROR',
        message: fastifyErr.message,
        statusCode: fastifyErr.statusCode,
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      statusCode: 500,
    });
  });

  return app;
}
