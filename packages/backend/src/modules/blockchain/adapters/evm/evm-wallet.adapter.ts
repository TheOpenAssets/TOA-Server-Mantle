import { ConfigService } from '@nestjs/config';
import { createWalletClient, http, WalletClient } from 'viem';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import { WalletAdapter } from '../wallet-adapter.interface';

export class EvmWalletAdapter implements WalletAdapter {
  private adminAccount: PrivateKeyAccount;
  private platformAccount: PrivateKeyAccount;
  private chain: any;
  private rpcUrl: string;

  constructor(private configService: ConfigService) {
    const adminPk = this.configService.get<string>('blockchain.adminPrivateKey');
    const platformPk = this.configService.get<string>('blockchain.platformPrivateKey');
    this.rpcUrl = this.configService.get<string>('blockchain.rpcUrl') || 'http://localhost:8545';
    const chainId = this.configService.get<number>('blockchain.chainId') || 5003;
    const networkName = this.configService.get<string>('network.networkName') || 'Mantle Sepolia';

    if (!adminPk) throw new Error('ADMIN_PRIVATE_KEY not configured');
    if (!platformPk) throw new Error('PLATFORM_PRIVATE_KEY not configured');

    this.adminAccount = privateKeyToAccount(adminPk as `0x${string}`);
    this.platformAccount = privateKeyToAccount(platformPk as `0x${string}`);

    this.chain = defineChain({
      id: chainId,
      name: networkName,
      nativeCurrency: { decimals: 18, name: 'MNT', symbol: 'MNT' },
      rpcUrls: {
        default: { http: [this.rpcUrl] },
        public: { http: [this.rpcUrl] },
      },
    });
  }

  getAdminAddress(): string {
    return this.adminAccount.address;
  }

  getPlatformAddress(): string {
    return this.platformAccount.address;
  }

  getAdminWallet(): WalletClient {
    return createWalletClient({
      account: this.adminAccount,
      chain: this.chain,
      transport: http(this.rpcUrl),
    });
  }

  getPlatformWallet(): WalletClient {
    return createWalletClient({
      account: this.platformAccount,
      chain: this.chain,
      transport: http(this.rpcUrl),
    });
  }
}
