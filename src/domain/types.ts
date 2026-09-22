export type BatchStage = 'SEEDED' | 'GERMINATION' | 'GROWING' | 'HARVEST_READY' | 'HARVESTED';

export const BATCH_STAGES: BatchStage[] = [
  'SEEDED',
  'GERMINATION',
  'GROWING',
  'HARVEST_READY',
  'HARVESTED',
];

export const STAGE_SEQUENCE: BatchStage[] = [
  'SEEDED',
  'GERMINATION',
  'GROWING',
  'HARVEST_READY',
  'HARVESTED',
];

export const NEXT_STAGE_MAP: Record<BatchStage, BatchStage | null> = {
  SEEDED: 'GERMINATION',
  GERMINATION: 'GROWING',
  GROWING: 'HARVEST_READY',
  HARVEST_READY: 'HARVESTED',
  HARVESTED: null,
};

export type HarvestGrade = 'A' | 'B' | 'C';

export interface Tray {
  id: string;
  code: string;
  zone: string;
  capacity_units: number;
  created_at: string;
}

export interface Batch {
  id: string;
  tray_id: string;
  crop: string;
  seeded_on: string;
  stage: BatchStage;
  expected_harvest_on: string;
  created_at: string;
  updated_at: string;
}

export interface BatchWithTray extends Batch {
  tray_code?: string;
  zone?: string;
  harvest_id?: string | null;
  harvested_on?: string | null;
  weight_grams?: number | null;
  grade?: HarvestGrade | null;
}

export interface Harvest {
  id: string;
  batch_id: string;
  harvested_on: string;
  weight_grams: number;
  grade: HarvestGrade;
  created_at: string;
}

export interface IdempotencyRecord {
  key: string;
  handler: string;
  request_hash: string;
  response_code: number;
  response_body: unknown;
  created_at: string;
  expires_at: string;
}

export interface YieldReportRow {
  group_name: string;
  total_weight_grams: number;
  batch_count: number;
  avg_cycle_days: number;
}
