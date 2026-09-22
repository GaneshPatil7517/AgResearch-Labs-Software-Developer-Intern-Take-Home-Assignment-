import { DatabasePool, DbClient } from '../db/connection.js';
import { BatchRepository } from '../repositories/batch.repository.js';
import { TrayRepository } from '../repositories/tray.repository.js';
import {
  CreateBatchInput,
  ListBatchesQueryInput,
} from '../domain/validators.js';
import {
  Batch,
  BatchStage,
  BatchWithTray,
  NEXT_STAGE_MAP,
} from '../domain/types.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.js';

export class BatchService {
  private batchRepo: BatchRepository;
  private trayRepo: TrayRepository;

  constructor(private db: DatabasePool) {
    this.batchRepo = new BatchRepository(db);
    this.trayRepo = new TrayRepository(db);
  }

  /**
   * Business Rule 1 & Concurrency Safety (Part 3a):
   * A tray can hold at most one active batch.
   * We lock the tray row within a transaction and check for active batches.
   * If two concurrent requests arrive simultaneously, the second acquires the lock
   * only after the first commits, detects the newly active batch, and returns 409 Conflict.
   * Additionally, the PostgreSQL partial unique index acts as a hard database invariant.
   */
  async createBatch(input: CreateBatchInput): Promise<Batch> {
    return await this.db.transaction(async (client: DbClient) => {
      // 1. Verify tray existence and acquire row-level lock
      const tray = await this.trayRepo.findByIdForUpdate(input.tray_id, client);
      if (!tray) {
        throw new NotFoundError(`Tray with ID '${input.tray_id}' not found`);
      }

      // 2. Check for existing active batch on this tray
      const activeBatch = await this.batchRepo.findActiveBatchByTrayId(
        input.tray_id,
        client
      );
      if (activeBatch) {
        throw new ConflictError(
          `Tray '${tray.code}' (${input.tray_id}) already has an active batch (Batch ID: ${activeBatch.id}, Stage: ${activeBatch.stage})`
        );
      }

      // 3. Insert new batch
      try {
        return await this.batchRepo.create(
          {
            tray_id: input.tray_id,
            crop: input.crop,
            seeded_on: input.seeded_on,
            expected_harvest_on: input.expected_harvest_on,
            stage: 'SEEDED',
          },
          client
        );
      } catch (err: any) {
        // Handle PostgreSQL unique constraint violation (code 23505) from partial index
        if (err.code === '23505' || err.message?.includes('unique') || err.message?.includes('duplicate')) {
          throw new ConflictError(
            `Tray '${tray.code}' (${input.tray_id}) already has an active batch`
          );
        }
        throw err;
      }
    });
  }

  /**
   * Business Rule 2:
   * Stage transitions only move forward, and only one step at a time.
   * You cannot skip GROWING, and you cannot go back.
   */
  async advanceStage(batchId: string, requestedStage?: BatchStage): Promise<Batch> {
    return await this.db.transaction(async (client: DbClient) => {
      const batch = await this.batchRepo.findByIdForUpdate(batchId, client);
      if (!batch) {
        throw new NotFoundError(`Batch with ID '${batchId}' not found`);
      }

      if (batch.stage === 'HARVESTED') {
        throw new ConflictError(
          'Batch has already been harvested and cannot transition to any further stage'
        );
      }

      const nextValidStage = NEXT_STAGE_MAP[batch.stage];
      if (!nextValidStage) {
        throw new ConflictError(
          `Batch is currently in '${batch.stage}' and cannot be advanced further`
        );
      }

      // If batch is in HARVEST_READY, it must be completed via harvest endpoint
      if (batch.stage === 'HARVEST_READY') {
        throw new ConflictError(
          "Batch is in 'HARVEST_READY' stage. To complete and harvest this batch, use POST /batches/:id/harvest"
        );
      }

      // If user supplied an explicit target stage, verify it is strictly the next sequential step
      if (requestedStage && requestedStage !== nextValidStage) {
        throw new ConflictError(
          `Invalid stage transition: cannot transition from '${batch.stage}' to '${requestedStage}'. Next valid stage is '${nextValidStage}'.`
        );
      }

      return await this.batchRepo.updateStage(batchId, nextValidStage, client);
    });
  }

  async getBatchById(id: string): Promise<BatchWithTray> {
    const batch = await this.batchRepo.findByIdWithDetails(id);
    if (!batch) {
      throw new NotFoundError(`Batch with ID '${id}' not found`);
    }
    return batch;
  }

  async listBatches(
    query: ListBatchesQueryInput
  ): Promise<{ data: BatchWithTray[]; total: number; limit: number; offset: number }> {
    const { batches, total } = await this.batchRepo.list(query);
    return {
      data: batches,
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
