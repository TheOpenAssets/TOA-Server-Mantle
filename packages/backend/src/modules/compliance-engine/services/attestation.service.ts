import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, type Hex } from 'viem';
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

  constructor(private configService: ConfigService) {
    const privateKey = this.configService.get<string>('blockchain.adminPrivateKey');
    if (!privateKey) {
      throw new Error('ADMIN_PRIVATE_KEY not configured');
    }
    this.adminPrivateKey = privateKey.startsWith('0x') ? privateKey as Hex : `0x${privateKey}` as Hex;
  }

  async generateAttestation(asset: Asset, adminWallet: string): Promise<AttestationResult> {
    this.logger.log(`Generating attestation for asset ${asset.assetId}`);

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

    // Convert payload to canonical JSON string
    const payloadString = JSON.stringify(payload);
    const payloadHex = toHex(payloadString);

    // Compute hash of payload
    const hash = keccak256(payloadHex);

    // Sign the hash with admin private key
    const account = privateKeyToAccount(this.adminPrivateKey);
    const signature = await account.signMessage({
      message: { raw: hash },
    });

    this.logger.log(`Attestation generated for asset ${asset.assetId}`);
    this.logger.log(`Attestation hash: ${hash}`);
    this.logger.log(`Signature: ${signature}`);

    return {
      payload: payloadString,
      hash,
      signature,
    };
  }
}
