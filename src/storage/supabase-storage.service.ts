import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { FileStorageService } from './file-storage.service';

/**
 * STORAGE_DRIVER=supabase: used when deployed, so uploads survive a
 * redeploy. Not `@Injectable()` — see StorageModule's comment on why this
 * is constructed by hand rather than through Nest's container (this
 * constructor throws if SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY aren't set,
 * which must not happen just because Nest eagerly instantiated it).
 */
export class SupabaseStorageService extends FileStorageService {
  private readonly client: ReturnType<typeof createClient>;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    super();
    this.client = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
    this.bucket = config.get<string>('SUPABASE_BUCKET', 'documents');
  }

  async save(key: string, buffer: Buffer): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(key, buffer, { upsert: true });
    if (error) {
      throw new Error(
        `Supabase Storage upload failed for "${key}": ${error.message}`,
      );
    }
  }

  async read(key: string): Promise<Buffer> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(key);
    if (error || !data) {
      return this.missing();
    }
    return Buffer.from(await data.arrayBuffer());
  }
}
