import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, type Hex } from 'viem';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Asset } from '../../../database/schemas/asset.schema';

interface AttestationPayload {
  assetId: string;
  merkleRoot: string;
  issueDate: Date;
  expiryDate: Date;
  attestor: string;
}

interface AttestationResult {
  payload: string;
  hash: string;
  signature: string;
}

@Injectable()
export class AttestationService {
  private readonly logger = new Logger(AttestationService.name);
  private readonly adminPrivateKey: Hex;
  private readonly stellarAdminSecret: string | null;

  constructor(private configService: ConfigService) {
    // EVM admin private key
    const privateKey = this.configService.get<string>('blockchain.adminPrivateKey');
    if (!privateKey) {
      throw new Error('ADMIN_PRIVATE_KEY not configured');
    }
    this.adminPrivateKey = privateKey.startsWith('0x') ? privateKey as Hex : `0x${privateKey}` as Hex;

    // Stellar admin secret (optional, for multi-network support)
    this.stellarAdminSecret = this.configService.get<string>('blockchain.stellarAdminSecret') || null;
  }

  async generateAttestation(asset: Asset, adminWallet: string): Promise<AttestationResult> {
    this.logger.log(`Generating attestation for asset ${asset.assetId} on ${asset.network || 'EVM'}`);

    // Verify asset has merkle root
    if (!asset.cryptography?.merkleRoot) {
      throw new Error('Asset must have merkle root before attestation');
    }

    // Create attestation payload
    const issueDate = new Date();
    const expiryDate = new Date(asset.metadata.dueDate);

    const payload: AttestationPayload = {
      assetId: asset.assetId,
      merkleRoot: asset.cryptography.merkleRoot,
      issueDate,
      expiryDate,
      attestor: adminWallet,
    };

    // Convert payload to canonical JSON string and then to hex bytes
    const payloadString = JSON.stringify(payload);
    const payloadHex = toHex(payloadString);

    // Compute hash of payload
    const hash = keccak256(payloadHex);

    // Sign the hash with appropriate key based on network
    let signature: string;

    if (asset.network === 'stellar') {
      // Stellar network - use Ed25519 signing
      if (!this.stellarAdminSecret) {
        throw new Error('Stellar admin secret not configured for Stellar network attestation');
      }

      const keypair = StellarSdk.Keypair.fromSecret(this.stellarAdminSecret);
      // Remove '0x' prefix from hash for Stellar signing
      const hashBytes = Buffer.from(hash.slice(2), 'hex');
      const signatureBuffer = keypair.sign(hashBytes);
      signature = '0x' + signatureBuffer.toString('hex');

      this.logger.log(`Attestation signed with Stellar key for asset ${asset.assetId}`);
    } else {
      // EVM network - use ECDSA signing
      const account = privateKeyToAccount(this.adminPrivateKey);
      signature = await account.signMessage({
        message: { raw: hash },
      });

      this.logger.log(`Attestation signed with EVM key for asset ${asset.assetId}`);
    }

    this.logger.log(`Attestation hash: ${hash}`);
    this.logger.log(`Signature: ${signature}`);

    return {
      payload: payloadHex,  // Store as hex bytes, not JSON string
      hash,
      signature,
    };
  }
}
