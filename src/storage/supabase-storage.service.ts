import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { FileStorageService } from './file-storage.service';

/** STORAGE_DRIVER=supabase: used when deployed, so uploads survive a redeploy. */
@Injectable()
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
      throw new NotFoundException('The uploaded file is missing from storage');
    }
    return Buffer.from(await data.arrayBuffer());
  }
}
