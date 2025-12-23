import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RegistryService } from './services/registry.service';
import { MarketplaceService } from './services/marketplace.service';
import { TokenService } from './services/token.service';
import { VaultService } from './services/vault.service';
import { EventListenerService } from './services/event-listener.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    RegistryService,
    MarketplaceService,
    TokenService,
    VaultService,
    EventListenerService,
  ],
  exports: [
    RegistryService,
    MarketplaceService,
    TokenService,
    VaultService,
    EventListenerService,
  ],
})
export class BlockchainModule {}
