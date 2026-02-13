import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModuleRegistryService } from './services/module-registry.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [ModuleRegistryService],
  exports: [ModuleRegistryService],
})
export class RegistryModule {}
