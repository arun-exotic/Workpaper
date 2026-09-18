import { NotFoundException } from '@nestjs/common';

/**
 * Where an uploaded document's bytes actually live. Two implementations —
 * see storage.module.ts for which one gets wired up, chosen by
 * STORAGE_DRIVER so local dev/tests keep using the filesystem with zero
 * external credentials while a deploy can point the same code at Supabase
 * Storage, which survives redeploys the way an ephemeral container's local
 * disk doesn't.
 */
export abstract class FileStorageService {
  abstract save(key: string, buffer: Buffer): Promise<void>;
  abstract read(key: string): Promise<Buffer>;

  /** Both drivers hit this the same way: disk/DB disagreeing is a 404, not a 500. */
  protected missing(): never {
    throw new NotFoundException('The uploaded file is missing from storage');
  }
}
