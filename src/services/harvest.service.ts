import crypto from 'node:crypto';
import { DatabasePool, DbClient } from '../db/connection.js';
import { BatchRepository } from '../repositories/batch.repository.js';
import { HarvestRepository } from '../repositories/harvest.repository.js';
import { IdempotencyRepository } from '../repositories/idempotency.repository.js';
import { RecordHarvestInput } from '../domain/validators.js';
import { Harvest, Batch } from '../domain/types.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
  ValidationError,
} from '../domain/errors.js';

export interface HarvestResult {
  harvest: Harvest;
  batch: Batch;
  isReplayed?: boolean;
}

export class HarvestService {
  private batchRepo: BatchRepository;
  private harvestRepo: HarvestRepository;
  private idempotencyRepo: IdempotencyRepository;
  private ttlHours: number;

  constructor(private db: DatabasePool, ttlHours: number = 24) {
    this.batchRepo = new BatchRepository(db);
    this.harvestRepo = new HarvestRepository(db);
    this.idempotencyRepo = new IdempotencyRepository(db);
    this.ttlHours = ttlHours;
  }

  /**
   * Business Rules 3 & 4 + Part 3b (Idempotency):
   * Rule 3: A harvest can only be recorded for a batch in HARVEST_READY.
   * Rule 4: Recording a harvest moves the batch to HARVESTED and frees the tray for reuse.
   * Part 3b: Handles Idempotency-Key header for spotty field connections.
   */
  async recordHarvest(
    batchId: string,
    input: RecordHarvestInput,
    idempotencyKey?: string
  ): Promise<{ statusCode: number; data: HarvestResult }> {
    const handler = `POST /batches/${batchId}/harvest`;
    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ batchId, ...input }))
      .digest('hex');

    // 1. Check Idempotency Key if provided
    if (idempotencyKey) {
      const existingRecord = await this.idempotencyRepo.find(
        idempotencyKey,
        handler
      );
      if (existingRecord) {
        if (existingRecord.request_hash !== payloadHash) {
          throw new UnprocessableEntityError(
            'Idempotency-Key was previously used with a different request payload'
          );
        }
        // Return identical replayed response
        return {
          statusCode: existingRecord.response_code,
          data: {
            ...(existingRecord.response_body as any),
            isReplayed: true,
          },
        };
      }
    }

    // 2. Execute Harvest Transaction
    const result = await this.db.transaction(async (client: DbClient) => {
      // Lock batch row to prevent race conditions during harvest
      const batch = await this.batchRepo.findByIdForUpdate(batchId, client);
      if (!batch) {
        throw new NotFoundError(`Batch with ID '${batchId}' not found`);
      }

      // Check Business Rule 3
      if (batch.stage === 'HARVESTED') {
        throw new ConflictError(
          `Batch with ID '${batchId}' has already been harvested`
        );
      }

      if (batch.stage !== 'HARVEST_READY') {
        throw new ConflictError(
          `Cannot harvest batch in '${batch.stage}' stage. A harvest can only be recorded for a batch in 'HARVEST_READY' stage.`
        );
      }

      // Validate harvest date against seeding date
      if (input.harvested_on < batch.seeded_on) {
        throw new ValidationError(
          `harvested_on (${input.harvested_on}) cannot be earlier than batch seeded_on (${batch.seeded_on})`
        );
      }

      // Create harvest record
      const harvest = await this.harvestRepo.create(
        {
          batch_id: batchId,
          harvested_on: input.harvested_on,
          weight_grams: input.weight_grams,
          grade: input.grade,
        },
        client
      );

      // Business Rule 4: Advance batch stage to HARVESTED (freeing tray for reuse)
      const updatedBatch = await this.batchRepo.updateStage(
        batchId,
        'HARVESTED',
        client
      );

      const responsePayload = {
        harvest,
        batch: updatedBatch,
      };

      // Store idempotency record if key was provided
      if (idempotencyKey) {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + this.ttlHours);

        await this.idempotencyRepo.save(
          {
            key: idempotencyKey,
            handler,
            request_hash: payloadHash,
            response_code: 201,
            response_body: responsePayload,
            expires_at: expiresAt,
          },
          client
        );
      }

      return responsePayload;
    });

    return {
      statusCode: 201,
      data: result,
    };
  }
}
