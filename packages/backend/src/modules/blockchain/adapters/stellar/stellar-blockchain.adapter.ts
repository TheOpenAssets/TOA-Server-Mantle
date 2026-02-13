import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  rpc, 
  TransactionBuilder, 
  Networks, 
  Operation, 
  Asset, 
  Contract, 
  xdr,
  Address,
  BASE_FEE
} from '@stellar/stellar-sdk';
import { BlockchainAdapter, DeployedTokenResult } from '../blockchain-adapter.interface';
import { StellarWalletAdapter } from './stellar-wallet.adapter';
import { StellarContractAdapter } from './stellar-contract-loader.adapter';

export class StellarBlockchainAdapter implements BlockchainAdapter {
  private readonly logger = new Logger(StellarBlockchainAdapter.name);
  private sorobanServer: rpc.Server;
  private networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly walletAdapter: StellarWalletAdapter,
    private readonly contractAdapter: StellarContractAdapter,
  ) {
    const rpcUrl = this.configService.get<string>('network.stellar.rpcUrl');
    this.networkPassphrase = this.configService.get<string>('network.stellar.networkPassphrase');
    this.sorobanServer = new rpc.Server(rpcUrl);
  }

  async registerAsset(dto: any): Promise<{ txId: string }> {
    const { assetId, attestationHash, blobId } = dto;
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const contractId = this.contractAdapter.getContractAddress('AttestationRegistry');
    const contract = new Contract(contractId);

    this.logger.log(`Registering asset ${assetId} on Stellar...`);

    const source = await this.sorobanServer.getAccount(adminKeypair.publicKey());
    
    // register_asset_direct(env, attestor, asset_id, attestation_hash, blob_id)
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      contract.call(
        'register_asset_direct',
        new Address(adminKeypair.publicKey()).toScVal(),
        xdr.ScVal.scvString(assetId),
        xdr.ScVal.scvBytes(Buffer.from(attestationHash.replace('0x', ''), 'hex')),
        xdr.ScVal.scvBytes(Buffer.from(blobId.replace('0x', ''), 'hex')),
      )
    )
    .setTimeout(30)
    .build();

    tx.sign(adminKeypair);
    
    const response = await this.sorobanServer.sendTransaction(tx);
    if (response.status !== 'PENDING') throw new Error(`Stellar Tx failed: ${response.status}`);

    await this.confirmTransaction(response.hash);
    return { txId: response.hash };
  }

  async registerAssetInRegistry(dto: any): Promise<{ txId: string }> {
    const { assetId, totalSupply, attestationHash, blobId } = dto;
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const contractId = this.contractAdapter.getContractAddress('AssetRegistry');
    const contract = new Contract(contractId);
    
    const assetCode = `RWA${assetId.substring(0, 8)}`.toUpperCase();

    this.logger.log(`Registering asset ${assetCode} in AssetRegistry...`);

    const source = await this.sorobanServer.getAccount(adminKeypair.publicKey());
    
    // register_asset(env, admin, asset_code, asset_id, total_supply, attestation_hash, blob_id)
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      contract.call(
        'register_asset',
        new Address(adminKeypair.publicKey()).toScVal(),
        xdr.ScVal.scvString(assetCode),
        xdr.ScVal.scvString(assetId),
        xdr.ScVal.scvI64(xdr.Int64.fromString(totalSupply.toString())),
        xdr.ScVal.scvBytes(Buffer.from(attestationHash.replace('0x', ''), 'hex')),
        xdr.ScVal.scvBytes(Buffer.from(blobId.replace('0x', ''), 'hex')),
      )
    )
    .setTimeout(30)
    .build();

    tx.sign(adminKeypair);
    
    const response = await this.sorobanServer.sendTransaction(tx);
    if (response.status !== 'PENDING') throw new Error(`Stellar Tx failed: ${response.status}`);

    await this.confirmTransaction(response.hash);
    return { txId: response.hash };
  }

  async revokeAsset(assetId: string): Promise<{ txId: string }> {
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const contractId = this.contractAdapter.getContractAddress('AttestationRegistry');
    const contract = new Contract(contractId);

    this.logger.log(`Revoking asset ${assetId} on Stellar AttestationRegistry...`);

    const source = await this.sorobanServer.getAccount(adminKeypair.publicKey());
    
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      contract.call(
        'revoke_asset',
        new Address(adminKeypair.publicKey()).toScVal(),
        xdr.ScVal.scvString(assetId),
      )
    )
    .setTimeout(30)
    .build();

    tx.sign(adminKeypair);
    const response = await this.sorobanServer.sendTransaction(tx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  async revokeAssetInRegistry(assetId: string): Promise<{ txId: string }> {
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const contractId = this.contractAdapter.getContractAddress('AssetRegistry');
    const contract = new Contract(contractId);
    const assetCode = `RWA${assetId.substring(0, 8)}`.toUpperCase();

    this.logger.log(`Revoking asset ${assetCode} on Stellar AssetRegistry...`);

    const source = await this.sorobanServer.getAccount(adminKeypair.publicKey());
    
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      contract.call(
        'revoke_asset',
        new Address(adminKeypair.publicKey()).toScVal(),
        xdr.ScVal.scvString(assetCode),
      )
    )
    .setTimeout(30)
    .build();

    tx.sign(adminKeypair);
    const response = await this.sorobanServer.sendTransaction(tx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  async deactivateListing(tokenIdentifier: string): Promise<{ txId: string }> {
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const contractId = this.contractAdapter.getContractAddress('PrimaryMarket');
    const contract = new Contract(contractId);
    const [assetCode] = tokenIdentifier.split(':');

    this.logger.log(`Deactivating listing for ${assetCode} on Stellar Primary Market...`);

    const source = await this.sorobanServer.getAccount(adminKeypair.publicKey());
    
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      contract.call(
        'deactivate_listing',
        new Address(adminKeypair.publicKey()).toScVal(),
        xdr.ScVal.scvString(assetCode),
        new Address(this.walletAdapter.getPlatformAddress()).toScVal(),
      )
    )
    .setTimeout(30)
    .build();

    tx.sign(adminKeypair);
    const response = await this.sorobanServer.sendTransaction(tx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  async deployToken(
    assetId: string,
    totalSupply: number,
    params: {
      attestationHash?: string;
      blobId?: string;
    }
  ): Promise<DeployedTokenResult> {
    const platformKeypair = this.walletAdapter.getPlatformKeypair();
    const assetCode = `RWA${assetId.substring(0, 8)}`.toUpperCase();
    
    this.logger.log(`Registering and creating native Stellar asset ${assetCode} for asset ${assetId}...`);

    // 1. Register in AssetRegistry
    await this.registerAssetInRegistry({
      assetId,
      totalSupply,
      attestationHash: params.attestationHash || '',
      blobId: params.blobId || ''
    });

    // 2. Set AUTH flags on platform account (issuer)
    const source = await this.sorobanServer.getAccount(platformKeypair.publicKey());
    
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(Operation.setOptions({
      setFlags: 7, // AUTH_REQUIRED | AUTH_REVOCABLE | AUTH_CLAWBACK
    }))
    .setTimeout(30)
    .build();

    tx.sign(platformKeypair);
    const response = await this.sorobanServer.sendTransaction(tx);
    await this.confirmTransaction(response.hash);

    return {
      primaryIdentifier: `${assetCode}:${platformKeypair.publicKey()}`,
      txId: response.hash,
    };
  }

  async listOnMarketplace(
    tokenIdentifier: string,
    listingType: string,
    price: number,
    minInvestment: number,
    duration: number,
    totalSupply: number,
    minPrice?: string,
  ): Promise<{ txId: string }> {
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const contractId = this.contractAdapter.getContractAddress('PrimaryMarket');
    const contract = new Contract(contractId);
    
    const [assetCode] = tokenIdentifier.split(':');

    this.logger.log(`Listing ${assetCode} on Stellar Primary Market...`);

    const source = await this.sorobanServer.getAccount(adminKeypair.publicKey());
    
    const minPriceVal = minPrice && minPrice !== '0' 
      ? xdr.ScVal.scvOption(xdr.ScVal.scvI64(xdr.Int64.fromString(minPrice)))
      : xdr.ScVal.scvOption(null);

    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      contract.call(
        'list_asset',
        new Address(adminKeypair.publicKey()).toScVal(),
        xdr.ScVal.scvString(assetCode),
        new Address(this.walletAdapter.getPlatformAddress()).toScVal(),
        xdr.ScVal.scvSymbol(listingType === 'STATIC' ? 'Static' : 'Auction'),
        xdr.ScVal.scvI64(xdr.Int64.fromString(price.toString())),
        minPriceVal,
        xdr.ScVal.scvU64(xdr.Uint64.fromString(duration.toString())),
        xdr.ScVal.scvI64(xdr.Int64.fromString(totalSupply.toString())),
      )
    )
    .setTimeout(30)
    .build();

    tx.sign(adminKeypair);
    const response = await this.sorobanServer.sendTransaction(tx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  async registerIdentity(walletAddress: string): Promise<{ txId: string }> {
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const contractId = this.contractAdapter.getContractAddress('IdentityRegistry');
    const contract = new Contract(contractId);

    const source = await this.sorobanServer.getAccount(adminKeypair.publicKey());
    
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      contract.call(
        'register_identity',
        new Address(adminKeypair.publicKey()).toScVal(),
        new Address(walletAddress).toScVal(),
        xdr.ScVal.scvOption(xdr.ScVal.scvU32(365)), // 1 year expiry
        xdr.ScVal.scvU32(1), // Tier 1
        xdr.ScVal.scvString('US'), // Placeholder country
      )
    )
    .setTimeout(30)
    .build();

    tx.sign(adminKeypair);
    const response = await this.sorobanServer.sendTransaction(tx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  async isVerified(walletAddress: string): Promise<boolean> {
    const contractId = this.contractAdapter.getContractAddress('IdentityRegistry');
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(
      new rpc.Account(this.walletAdapter.getAdminAddress(), '0'), 
      {
        fee: '0',
        networkPassphrase: this.networkPassphrase,
      }
    )
    .addOperation(
      contract.call(
        'is_verified',
        new Address(walletAddress).toScVal(),
      )
    )
    .build();

    const response = await this.sorobanServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(response)) {
      return response.result.retval.getBool();
    }
    return false;
  }

  async approveTrustline(walletAddress: string, assetIdentifier: string): Promise<{ txId: string }> {
    const platformKeypair = this.walletAdapter.getPlatformKeypair();
    const [assetCode] = assetIdentifier.split(':');

    this.logger.log(`Approving trustline for ${walletAddress} on asset ${assetCode}...`);

    const source = await this.sorobanServer.getAccount(platformKeypair.publicKey());
    
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(Operation.allowTrust({
      trustor: walletAddress,
      assetCode: assetCode,
      authorize: true,
    }))
    .setTimeout(30)
    .build();

    tx.sign(platformKeypair);
    const response = await this.sorobanServer.sendTransaction(tx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  private async confirmTransaction(hash: string, timeoutMs: number = 30000): Promise<rpc.Api.GetTransactionResponse> {
    const start = Date.now();
    this.logger.log(`Waiting for Stellar transaction ${hash} to confirm...`);

    while (Date.now() - start < timeoutMs) {
      const response = await this.sorobanServer.getTransaction(hash);
      
      if (response.status === 'SUCCESS') {
        this.logger.log(`Stellar transaction ${hash} confirmed`);
        return response;
      }
      
      if (response.status === 'FAILED') {
        this.logger.error(`Stellar transaction ${hash} failed: ${JSON.stringify(response.resultXdr)}`);
        throw new Error(`Stellar transaction ${hash} failed`);
      }

      // Wait 2 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`Stellar transaction ${hash} timed out after ${timeoutMs}ms`);
  }
}
