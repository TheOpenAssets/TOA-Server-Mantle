import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private configService: ConfigService) {}

  private getChain() {
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl') || 'http://localhost:8545';
    const chainId = this.configService.get<number>('blockchain.chainId') || 5003;
    const networkName = this.configService.get<string>('network.networkName') || 'Mantle Sepolia';
    const nativeSymbol = this.configService.get<string>('blockchain.evmNativeSymbol') || 'MNT';
    return defineChain({
      id: chainId,
      name: networkName,
      nativeCurrency: { decimals: 18, name: nativeSymbol, symbol: nativeSymbol },
      rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    });
  }

  getAdminWallet() {
    const pk = this.configService.get<string>('blockchain.adminPrivateKey');
    if (!pk) throw new Error('ADMIN_PRIVATE_KEY not configured');

    const account = privateKeyToAccount(pk as `0x${string}`);
    return createWalletClient({
      account: account as any,
      chain: this.getChain(),
      transport: http(this.configService.get('blockchain.rpcUrl'))
    });
  }

  getPlatformWallet() {
    const pk = this.configService.get<string>('blockchain.platformPrivateKey');
    if (!pk) throw new Error('PLATFORM_PRIVATE_KEY not configured');

    const account = privateKeyToAccount(pk as `0x${string}`);
    return createWalletClient({
      account: account as any,
      chain: this.getChain(),
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
