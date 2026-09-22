import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { BatchService } from '../services/batch.service.js';
import { HarvestService } from '../services/harvest.service.js';
import {
  CreateBatchSchema,
  AdvanceStageSchema,
  RecordHarvestSchema,
  ListBatchesQuerySchema,
} from '../domain/validators.js';
import { ValidationError } from '../domain/errors.js';

export const batchRoutes: FastifyPluginAsync<{
  batchService: BatchService;
  harvestService: HarvestService;
}> = async (fastify: FastifyInstance, opts) => {
  const { batchService, harvestService } = opts;

  // POST /batches - Seed a new batch into a tray
  fastify.post('/batches', async (request, reply) => {
    const parseResult = CreateBatchSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map((e) => e.message).join(', '),
        parseResult.error.format()
      );
    }

    const batch = await batchService.createBatch(parseResult.data);
    return reply.status(201).send(batch);
  });

  // GET /batches - List batches with filtering (stage, crop, zone) and pagination
  fastify.get('/batches', async (request, reply) => {
    const parseResult = ListBatchesQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map((e) => e.message).join(', '),
        parseResult.error.format()
      );
    }

    const result = await batchService.listBatches(parseResult.data);
    return reply.status(200).send(result);
  });

  // GET /batches/:id - Get a single batch by ID with tray details
  fastify.get<{ Params: { id: string } }>('/batches/:id', async (request, reply) => {
    const { id } = request.params;
    if (!id || id.trim() === '') {
      throw new ValidationError('Batch ID is required in URL parameter');
    }

    const batch = await batchService.getBatchById(id);
    return reply.status(200).send(batch);
  });

  // PATCH /batches/:id/stage - Advance a batch by one stage
  fastify.patch<{
    Params: { id: string };
    Body: { stage?: string };
  }>('/batches/:id/stage', async (request, reply) => {
    const { id } = request.params;
    if (!id || id.trim() === '') {
      throw new ValidationError('Batch ID is required in URL parameter');
    }

    const body = request.body || {};
    const parseResult = AdvanceStageSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map((e) => e.message).join(', '),
        parseResult.error.format()
      );
    }

    const updatedBatch = await batchService.advanceStage(
      id,
      parseResult.data.stage
    );
    return reply.status(200).send(updatedBatch);
  });

  // POST /batches/:id/harvest - Record a harvest and close out the batch (frees tray)
  // Supports Idempotency-Key header for Part 3b
  fastify.post<{
    Params: { id: string };
  }>('/batches/:id/harvest', async (request, reply) => {
    const { id } = request.params;
    if (!id || id.trim() === '') {
      throw new ValidationError('Batch ID is required in URL parameter');
    }

    const parseResult = RecordHarvestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map((e) => e.message).join(', '),
        parseResult.error.format()
      );
    }

    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const { statusCode, data } = await harvestService.recordHarvest(
      id,
      parseResult.data,
      idempotencyKey
    );

    if (data.isReplayed) {
      reply.header('X-Cache-Lookup', 'HIT');
    }

    return reply.status(statusCode).send(data);
  });
};
