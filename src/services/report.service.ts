import { DatabasePool } from '../db/connection.js';
import { ReportRepository } from '../repositories/report.repository.js';
import { YieldReportQueryInput } from '../domain/validators.js';
import { YieldReportRow } from '../domain/types.js';

export class ReportService {
  private reportRepo: ReportRepository;

  constructor(private db: DatabasePool) {
    this.reportRepo = new ReportRepository(db);
  }

  async getYieldReport(
    params: YieldReportQueryInput
  ): Promise<{
    from: string;
    to: string;
    group_by: 'crop' | 'zone';
    data: YieldReportRow[];
  }> {
    const data = await this.reportRepo.getYieldReport(params);
    return {
      from: params.from,
      to: params.to,
      group_by: params.group_by,
      data,
    };
  }
}
