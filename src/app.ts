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

  // Root visual dashboard for web browser viewing
  app.get('/', async (request, reply) => {
    reply.type('text/html').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AgResearch Labs — Aeroponic System API</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg: #090d16;
            --card-bg: rgba(22, 30, 49, 0.75);
            --border: rgba(56, 189, 248, 0.15);
            --accent: #10b981;
            --accent-glow: rgba(16, 185, 129, 0.25);
            --text-main: #f1f5f9;
            --text-muted: #94a3b8;
            --badge-get: #38bdf8;
            --badge-post: #10b981;
            --badge-patch: #f59e0b;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background: radial-gradient(circle at 10% 20%, rgba(16, 185, 129, 0.08) 0%, transparent 40%),
                        radial-gradient(circle at 90% 80%, rgba(56, 189, 248, 0.08) 0%, transparent 40%),
                        var(--bg);
            color: var(--text-main);
            min-height: 100vh;
            padding: 2.5rem 1.5rem;
          }
          .container { max-width: 1100px; margin: 0 auto; }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 1rem;
            margin-bottom: 2.5rem;
            border-bottom: 1px solid var(--border);
            padding-bottom: 1.5rem;
          }
          .title-group { display: flex; align-items: center; gap: 0.85rem; }
          .icon-box {
            background: linear-gradient(135deg, #10b981, #059669);
            width: 44px;
            height: 44px;
            border-radius: 12px;
            display: grid;
            place-items: center;
            font-size: 1.4rem;
            box-shadow: 0 0 20px var(--accent-glow);
          }
          h1 { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em; }
          .subtitle { color: var(--text-muted); font-size: 0.9rem; margin-top: 0.2rem; }
          .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: rgba(16, 185, 129, 0.12);
            color: #34d399;
            border: 1px solid rgba(52, 211, 153, 0.3);
            padding: 0.4rem 0.85rem;
            border-radius: 999px;
            font-size: 0.82rem;
            font-weight: 600;
          }
          .pulse {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #34d399;
            box-shadow: 0 0 8px #34d399;
            animation: pulse 2s infinite;
          }
          @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
          
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 1.25rem;
            margin-bottom: 2.5rem;
          }
          .card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 1.4rem;
            transition: transform 0.2s, border-color 0.2s;
          }
          .card:hover { transform: translateY(-3px); border-color: rgba(56, 189, 248, 0.35); }
          .card-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
          .card-value { font-size: 1.3rem; font-weight: 700; margin: 0.5rem 0 0.8rem 0; color: #fff; }
          .card-link {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            color: #38bdf8;
            font-size: 0.85rem;
            text-decoration: none;
            font-weight: 600;
          }
          .card-link:hover { text-decoration: underline; }

          .section-title { font-size: 1.2rem; font-weight: 700; margin-bottom: 1.2rem; }
          .table-wrapper {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--border);
            border-radius: 16px;
            overflow: hidden;
            margin-bottom: 2.5rem;
          }
          table { width: 100%; border-collapse: collapse; text-align: left; }
          th, td { padding: 1rem 1.2rem; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
          th { background: rgba(15, 23, 42, 0.6); color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
          tr:last-child td { border-bottom: none; }
          tr:hover td { background: rgba(56, 189, 248, 0.03); }
          .badge {
            display: inline-block;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.75rem;
            font-weight: 700;
            padding: 0.2rem 0.55rem;
            border-radius: 6px;
          }
          .badge-get { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
          .badge-post { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
          .badge-patch { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
          .endpoint-link {
            font-family: 'JetBrains Mono', monospace;
            color: #f1f5f9;
            text-decoration: none;
            font-size: 0.85rem;
          }
          .endpoint-link:hover { color: #38bdf8; text-decoration: underline; }
          code { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; background: rgba(15, 23, 42, 0.6); padding: 0.15rem 0.4rem; border-radius: 4px; color: #cbd5e1; }
          
          .flow-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 1.5rem;
            margin-bottom: 2rem;
          }
          .flow-steps {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            flex-wrap: wrap;
            margin-top: 1rem;
          }
          .flow-step {
            background: rgba(15, 23, 42, 0.8);
            border: 1px solid var(--border);
            padding: 0.5rem 1rem;
            border-radius: 8px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.82rem;
            font-weight: 600;
            color: #38bdf8;
          }
          .flow-arrow { color: var(--text-muted); font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <header class="header">
            <div class="title-group">
              <div class="icon-box">🌱</div>
              <div>
                <h1>AgResearch Labs (ARL)</h1>
                <div class="subtitle">Aeroponic Batch Tracking System • Fastify + TypeScript + PostgreSQL</div>
              </div>
            </div>
            <div class="status-badge">
              <span class="pulse"></span>
              API Online & Healthy
            </div>
          </header>

          <div class="grid">
            <div class="card">
              <div class="card-title">Physical Trays</div>
              <div class="card-value">6 Trays Configured</div>
              <a class="card-link" href="/trays" target="_blank">View /trays JSON &rarr;</a>
            </div>
            <div class="card">
              <div class="card-title">Batch Tracking</div>
              <div class="card-value">Active & Harvested</div>
              <a class="card-link" href="/batches" target="_blank">View /batches JSON &rarr;</a>
            </div>
            <div class="card">
              <div class="card-title">Analytics (Part 3c)</div>
              <div class="card-value">Yield by Crop</div>
              <a class="card-link" href="/reports/yield?from=2026-08-01&to=2026-09-30&group_by=crop" target="_blank">View Yield Report &rarr;</a>
            </div>
            <div class="card">
              <div class="card-title">System Health</div>
              <div class="card-value">Healthy (200 OK)</div>
              <a class="card-link" href="/health" target="_blank">Check /health &rarr;</a>
            </div>
          </div>

          <div class="flow-card">
            <div class="section-title" style="margin-bottom: 0.5rem;">🌱 Batch Lifecycle State Machine</div>
            <p style="color: var(--text-muted); font-size: 0.88rem;">Strict sequential forward progression enforced at service and PostgreSQL catalog layers:</p>
            <div class="flow-steps">
              <div class="flow-step">SEEDED</div>
              <span class="flow-arrow">&rarr;</span>
              <div class="flow-step">GERMINATION</div>
              <span class="flow-arrow">&rarr;</span>
              <div class="flow-step">GROWING</div>
              <span class="flow-arrow">&rarr;</span>
              <div class="flow-step">HARVEST_READY</div>
              <span class="flow-arrow">&rarr;</span>
              <div class="flow-step" style="color: #34d399; border-color: rgba(52, 211, 153, 0.4);">HARVESTED</div>
            </div>
          </div>

          <div class="section-title">📡 Interactive REST API Endpoints</div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Endpoint</th>
                  <th>Description</th>
                  <th>Status Codes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span class="badge badge-get">GET</span></td>
                  <td><a class="endpoint-link" href="/trays" target="_blank">/trays</a></td>
                  <td>List all physical trays with code, zone, and capacity</td>
                  <td><code>200</code></td>
                </tr>
                <tr>
                  <td><span class="badge badge-get">GET</span></td>
                  <td><a class="endpoint-link" href="/batches" target="_blank">/batches</a></td>
                  <td>List batches with filter query params: <code>?stage=</code>, <code>?crop=</code>, <code>?zone=</code></td>
                  <td><code>200</code>, <code>400</code></td>
                </tr>
                <tr>
                  <td><span class="badge badge-get">GET</span></td>
                  <td><a class="endpoint-link" href="/reports/yield?from=2026-08-01&to=2026-09-30&group_by=crop" target="_blank">/reports/yield?from=2026-08-01&to=2026-09-30&group_by=crop</a></td>
                  <td>Part 3c: Single-query yield analytics grouped by crop or zone</td>
                  <td><code>200</code>, <code>400</code></td>
                </tr>
                <tr>
                  <td><span class="badge badge-post">POST</span></td>
                  <td><span class="endpoint-link">/trays</span></td>
                  <td>Create a new tray <code>{"code": "T-A-014", "zone": "Zone-A", "capacity_units": 100}</code></td>
                  <td><code>201</code>, <code>400</code>, <code>409</code></td>
                </tr>
                <tr>
                  <td><span class="badge badge-post">POST</span></td>
                  <td><span class="endpoint-link">/batches</span></td>
                  <td>Seed batch into tray (Part 3a concurrency & 1-batch constraint)</td>
                  <td><code>201</code>, <code>400</code>, <code>404</code>, <code>409</code></td>
                </tr>
                <tr>
                  <td><span class="badge badge-patch">PATCH</span></td>
                  <td><span class="endpoint-link">/batches/:id/stage</span></td>
                  <td>Advance batch stage sequentially (Rule 2)</td>
                  <td><code>200</code>, <code>400</code>, <code>404</code>, <code>409</code></td>
                </tr>
                <tr>
                  <td><span class="badge badge-post">POST</span></td>
                  <td><span class="endpoint-link">/batches/:id/harvest</span></td>
                  <td>Record harvest & free tray (Supports <code>Idempotency-Key</code> header)</td>
                  <td><code>201</code>, <code>200</code>, <code>400</code>, <code>404</code>, <code>409</code>, <code>422</code></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </body>
      </html>
    `);
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
