import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { TrayService } from '../services/tray.service.js';
import { CreateTraySchema } from '../domain/validators.js';
import { ValidationError } from '../domain/errors.js';

export const trayRoutes: FastifyPluginAsync<{ trayService: TrayService }> = async (
  fastify: FastifyInstance,
  opts
) => {
  const { trayService } = opts;

  // POST /trays - Create a new tray
  fastify.post('/trays', async (request, reply) => {
    const parseResult = CreateTraySchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map((e) => e.message).join(', '),
        parseResult.error.format()
      );
    }

    const tray = await trayService.createTray(parseResult.data);
    return reply.status(201).send(tray);
  });

  // GET /trays - List all trays
  fastify.get('/trays', async (request, reply) => {
    const trays = await trayService.listTrays();
    return reply.status(200).send({ data: trays });
  });

  // GET /trays/:id - Get a single tray by ID
  fastify.get<{ Params: { id: string } }>('/trays/:id', async (request, reply) => {
    const { id } = request.params;
    if (!id || id.trim() === '') {
      throw new ValidationError('Tray ID is required in URL parameter');
    }

    const tray = await trayService.getTrayById(id);
    return reply.status(200).send(tray);
  });
};
