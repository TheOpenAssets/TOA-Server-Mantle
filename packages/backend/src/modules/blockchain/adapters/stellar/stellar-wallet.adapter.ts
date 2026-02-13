import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import { WalletAdapter } from '../wallet-adapter.interface';

@Injectable()
export class StellarWalletAdapter implements WalletAdapter {
  private adminKeypair: Keypair;
  private platformKeypair: Keypair;

  constructor(private readonly configService: ConfigService) {
    const adminSecret = this.configService.get<string>('network.stellar.adminSecret');
    const platformSecret = this.configService.get<string>('network.stellar.platformSecret');

    if (!adminSecret) throw new Error('STELLAR_ADMIN_SECRET not configured');
    if (!platformSecret) throw new Error('STELLAR_PLATFORM_SECRET not configured');

    this.adminKeypair = Keypair.fromSecret(adminSecret);
    this.platformKeypair = Keypair.fromSecret(platformSecret);
  }

  getAdminAddress(): string {
    return this.adminKeypair.publicKey();
  }

  getPlatformAddress(): string {
    return this.platformKeypair.publicKey();
  }

  getAdminKeypair(): Keypair {
    return this.adminKeypair;
  }

  getPlatformKeypair(): Keypair {
    return this.platformKeypair;
  }
}
