import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import blockchainConfig from '../../config/blockchain.config';
import { BlockchainService } from './services/blockchain.service';
import { WalletService } from './services/wallet.service';
import { ContractLoaderService } from './services/contract-loader.service';

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(blockchainConfig)
  ],
  providers: [
    BlockchainService,
    WalletService,
    ContractLoaderService,
  ],
  exports: [
    BlockchainService,
    WalletService,
    ContractLoaderService,
  ],
})
export class BlockchainModule {}