import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ReportService } from '../services/report.service.js';
import { YieldReportQuerySchema } from '../domain/validators.js';
import { ValidationError } from '../domain/errors.js';

export const reportRoutes: FastifyPluginAsync<{ reportService: ReportService }> = async (
  fastify: FastifyInstance,
  opts
) => {
  const { reportService } = opts;

  // GET /reports/yield - Part 3c: Single-query yield reporting grouped by crop or zone
  fastify.get('/reports/yield', async (request, reply) => {
    const parseResult = YieldReportQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map((e) => e.message).join(', '),
        parseResult.error.format()
      );
    }

    const report = await reportService.getYieldReport(parseResult.data);
    return reply.status(200).send(report);
  });
};
