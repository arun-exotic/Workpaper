import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileStorageService } from './file-storage.service';

/** Default driver: local dev and every automated test use this. */
@Injectable()
export class LocalDiskStorageService extends FileStorageService {
  constructor(private readonly config: ConfigService) {
    super();
  }

  private root(): string {
    return this.config.get<string>('UPLOAD_DIR', 'uploads');
  }

  async save(key: string, buffer: Buffer): Promise<void> {
    const absolutePath = path.join(this.root(), key);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(path.join(this.root(), key));
    } catch {
      // Disk and DB disagreeing (e.g. an ephemeral deploy wiped uploads/)
      // shouldn't surface as a 500 — a missing file is a 404 same as
      // anything else that isn't there.
      throw new NotFoundException('The uploaded file is missing from storage');
    }
  }
}
