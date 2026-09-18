import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileStorageService } from './file-storage.service';

/**
 * Default driver: local dev and every automated test use this. Not
 * `@Injectable()` — StorageModule constructs whichever driver is selected
 * by hand (see its comment) rather than through Nest's container.
 */
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
      return this.missing();
    }
  }
}
