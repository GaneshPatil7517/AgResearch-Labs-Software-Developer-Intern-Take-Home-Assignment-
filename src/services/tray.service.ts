import { DatabasePool } from '../db/connection.js';
import { TrayRepository } from '../repositories/tray.repository.js';
import { CreateTrayInput } from '../domain/validators.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import { Tray } from '../domain/types.js';

export class TrayService {
  private trayRepo: TrayRepository;

  constructor(private db: DatabasePool) {
    this.trayRepo = new TrayRepository(db);
  }

  async createTray(input: CreateTrayInput): Promise<Tray> {
    const existing = await this.trayRepo.findByCode(input.code);
    if (existing) {
      throw new ConflictError(`Tray with code '${input.code}' already exists`);
    }

    try {
      return await this.trayRepo.create(input);
    } catch (err: any) {
      if (err.code === '23505') {
        throw new ConflictError(`Tray with code '${input.code}' already exists`);
      }
      throw err;
    }
  }

  async listTrays(): Promise<Tray[]> {
    return await this.trayRepo.findAll();
  }

  async getTrayById(id: string): Promise<Tray> {
    const tray = await this.trayRepo.findById(id);
    if (!tray) {
      throw new NotFoundError(`Tray with ID '${id}' not found`);
    }
    return tray;
  }
}
