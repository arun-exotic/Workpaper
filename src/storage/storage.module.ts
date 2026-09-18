import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStorageService } from './file-storage.service';
import { LocalDiskStorageService } from './local-disk-storage.service';
import { SupabaseStorageService } from './supabase-storage.service';

@Global()
@Module({
  providers: [
    {
      provide: FileStorageService,
      inject: [ConfigService],
      // The driver is a runtime config value (STORAGE_DRIVER), not a
      // compile-time type, so this has to be a factory rather than a plain
      // useClass — everything downstream just injects FileStorageService
      // and never knows which one it got.
      //
      // Deliberately `new`s the chosen driver here rather than registering
      // both as ordinary providers: Nest eagerly constructs every
      // registered provider, and SupabaseStorageService's constructor
      // throws immediately if SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
      // aren't set — which is exactly the case for local dev and CI, where
      // STORAGE_DRIVER stays "local" and those vars are never provided.
      // Only the driver actually selected gets constructed.
      useFactory: (config: ConfigService): FileStorageService =>
        config.get<string>('STORAGE_DRIVER', 'local') === 'supabase'
          ? new SupabaseStorageService(config)
          : new LocalDiskStorageService(config),
    },
  ],
  exports: [FileStorageService],
})
export class StorageModule {}
