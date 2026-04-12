import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import { WalletAdapter } from '../wallet-adapter.interface';

@Injectable()
export class StellarWalletAdapter implements WalletAdapter {
  private adminKeypair: Keypair | null = null;
  private platformKeypair: Keypair | null = null;

  constructor(private readonly configService: ConfigService) {
    // Lazily resolve secrets — throw only when the methods are actually called,
    // so the server boots even if Stellar secrets are not configured locally.
    const adminSecret = this.configService.get<string>('network.stellar.adminSecret');
    const platformSecret = this.configService.get<string>('network.stellar.platformSecret');

    if (adminSecret) this.adminKeypair = Keypair.fromSecret(adminSecret);
    if (platformSecret) this.platformKeypair = Keypair.fromSecret(platformSecret);
  }

  getAdminAddress(): string {
    if (!this.adminKeypair) throw new Error('STELLAR_ADMIN_SECRET not configured');
    return this.adminKeypair.publicKey();
  }

  getPlatformAddress(): string {
    if (!this.platformKeypair) throw new Error('STELLAR_PLATFORM_SECRET not configured');
    return this.platformKeypair.publicKey();
  }

  getAdminKeypair(): Keypair {
    if (!this.adminKeypair) throw new Error('STELLAR_ADMIN_SECRET not configured');
    return this.adminKeypair;
  }

  getAdminWallet(): any {
    return this.getAdminKeypair();
  }

  getPlatformKeypair(): Keypair {
    if (!this.platformKeypair) throw new Error('STELLAR_PLATFORM_SECRET not configured');
    return this.platformKeypair;
  }
}
