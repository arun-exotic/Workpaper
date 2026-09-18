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
      useFactory: (config: ConfigService): FileStorageService =>
        config.get<string>('STORAGE_DRIVER', 'local') === 'supabase'
          ? new SupabaseStorageService(config)
          : new LocalDiskStorageService(config),
    },
  ],
  exports: [FileStorageService],
})
export class StorageModule {}
