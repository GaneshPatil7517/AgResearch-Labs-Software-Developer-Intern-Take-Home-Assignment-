import { z } from 'zod';
import { BATCH_STAGES, BatchStage } from './types.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;
  const parsed = new Date(dateStr);
  return !isNaN(parsed.getTime()) && dateStr === parsed.toISOString().split('T')[0];
}

export const CreateTraySchema = z.object({
  code: z
    .string({ required_error: 'Tray code is required' })
    .trim()
    .min(1, 'Tray code cannot be empty')
    .max(50, 'Tray code cannot exceed 50 characters'),
  zone: z
    .string({ required_error: 'Zone is required' })
    .trim()
    .min(1, 'Zone cannot be empty')
    .max(50, 'Zone cannot exceed 50 characters'),
  capacity_units: z
    .number({ required_error: 'capacity_units is required' })
    .int('capacity_units must be an integer')
    .positive('capacity_units must be greater than 0'),
});

export type CreateTrayInput = z.infer<typeof CreateTraySchema>;

export const CreateBatchSchema = z
  .object({
    tray_id: z
      .string({ required_error: 'tray_id is required' })
      .uuid('tray_id must be a valid UUID'),
    crop: z
      .string({ required_error: 'crop is required' })
      .trim()
      .min(1, 'crop name cannot be empty')
      .max(100, 'crop name cannot exceed 100 characters'),
    seeded_on: z
      .string({ required_error: 'seeded_on is required' })
      .refine(isValidDate, 'seeded_on must be a valid date in YYYY-MM-DD format'),
    expected_harvest_on: z
      .string({ required_error: 'expected_harvest_on is required' })
      .refine(isValidDate, 'expected_harvest_on must be a valid date in YYYY-MM-DD format'),
  })
  .refine((data) => data.expected_harvest_on >= data.seeded_on, {
    message: 'expected_harvest_on cannot be earlier than seeded_on',
    path: ['expected_harvest_on'],
  });

export type CreateBatchInput = z.infer<typeof CreateBatchSchema>;

export const AdvanceStageSchema = z.object({
  stage: z
    .enum(BATCH_STAGES as [BatchStage, ...BatchStage[]])
    .optional(),
});

export type AdvanceStageInput = z.infer<typeof AdvanceStageSchema>;

export const RecordHarvestSchema = z.object({
  harvested_on: z
    .string({ required_error: 'harvested_on is required' })
    .refine(isValidDate, 'harvested_on must be a valid date in YYYY-MM-DD format'),
  weight_grams: z
    .number({ required_error: 'weight_grams is required' })
    .positive('weight_grams must be greater than 0'),
  grade: z.enum(['A', 'B', 'C'], {
    errorMap: () => ({ message: "grade must be one of 'A', 'B', or 'C'" }),
  }),
});

export type RecordHarvestInput = z.infer<typeof RecordHarvestSchema>;

export const ListBatchesQuerySchema = z.object({
  stage: z.enum(BATCH_STAGES as [BatchStage, ...BatchStage[]]).optional(),
  crop: z.string().trim().optional(),
  zone: z.string().trim().optional(),
  limit: z
    .coerce
    .number()
    .int()
    .min(1, 'limit must be at least 1')
    .max(100, 'limit cannot exceed 100')
    .default(20),
  offset: z
    .coerce
    .number()
    .int()
    .min(0, 'offset must be 0 or greater')
    .default(0),
});

export type ListBatchesQueryInput = z.infer<typeof ListBatchesQuerySchema>;

export const YieldReportQuerySchema = z
  .object({
    from: z
      .string({ required_error: 'from query parameter is required' })
      .refine(isValidDate, 'from must be a valid date in YYYY-MM-DD format'),
    to: z
      .string({ required_error: 'to query parameter is required' })
      .refine(isValidDate, 'to must be a valid date in YYYY-MM-DD format'),
    group_by: z.enum(['crop', 'zone'], {
      errorMap: () => ({ message: "group_by must be either 'crop' or 'zone'" }),
    }),
  })
  .refine((data) => data.to >= data.from, {
    message: 'to date cannot be earlier than from date',
    path: ['to'],
  });

export type YieldReportQueryInput = z.infer<typeof YieldReportQuerySchema>;
