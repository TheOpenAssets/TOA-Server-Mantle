import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWalletClient, http, privateKeyToAccount } from 'viem';
import { mantleSepolia } from 'viem/chains';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  
  constructor(private configService: ConfigService) {}

  getAdminWallet() {
    const pk = this.configService.get<string>('blockchain.adminPrivateKey');
    if (!pk) throw new Error('ADMIN_PRIVATE_KEY not configured');
    
    const account = privateKeyToAccount(pk as `0x${string}`);
    return createWalletClient({
      account,
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl'))
    });
  }

  getPlatformWallet() {
    const pk = this.configService.get<string>('blockchain.platformPrivateKey');
    if (!pk) throw new Error('PLATFORM_PRIVATE_KEY not configured');

    const account = privateKeyToAccount(pk as `0x${string}`);
    return createWalletClient({
      account,
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl'))
    });
  }

  // Helper to get raw account for signing messages
  getAdminAccount() {
    const pk = this.configService.get<string>('blockchain.adminPrivateKey');
    if (!pk) throw new Error('ADMIN_PRIVATE_KEY not configured');
    return privateKeyToAccount(pk as `0x${string}`);
  }
}
