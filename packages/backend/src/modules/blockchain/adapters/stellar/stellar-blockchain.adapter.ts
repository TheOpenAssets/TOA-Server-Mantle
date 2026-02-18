import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import {
  rpc,
  TransactionBuilder,
  Transaction,
  Operation,
  Contract,
  xdr,
  Address,
  Account,
  BASE_FEE,
  Keypair,
  scValToNative,
  nativeToScVal,
  StrKey,
  Asset,
} from '@stellar/stellar-sdk';
import { ListingType, WalletAddress } from '@openassets/types';
import { 
  BlockchainAdapter, 
  DeployedTokenResult,
  PurchaseVerificationResult,
  BidVerificationResult,
  BidSettlementResult
} from '../blockchain-adapter.interface';
import { StellarWalletAdapter } from './stellar-wallet.adapter';
import { StellarContractAdapter } from './stellar-contract-loader.adapter';
import { Model } from 'mongoose';
import { AssetDocument } from '../../../../database/schemas/asset.schema';
import { toCanonical, fromCanonical } from '../../utils/numeric-conversion';

export class StellarBlockchainAdapter implements BlockchainAdapter {
  private readonly logger = new Logger(StellarBlockchainAdapter.name);
  private sorobanServer: rpc.Server;
  private networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly walletAdapter: StellarWalletAdapter,
    private readonly contractAdapter: StellarContractAdapter,
    private readonly assetModel: Model<AssetDocument>,
  ) {
    const rpcUrl = this.configService.get<string>('network.stellar.rpcUrl') || 'https://soroban-testnet.stellar.org';
    this.networkPassphrase = this.configService.get<string>('network.stellar.networkPassphrase') || 'Test SDF Network ; September 2015';
    this.sorobanServer = new rpc.Server(rpcUrl);
  }

  private async prepareContractCall(tx: Transaction, keypair: Keypair): Promise<Transaction> {
    this.logger.debug(`[Soroban] Simulating transaction...`);
    const simResult = await this.sorobanServer.simulateTransaction(tx);
    this.logger.debug(`[Soroban] Simulation result: ${JSON.stringify({ status: (simResult as any).error ? 'ERROR' : 'SUCCESS', cost: (simResult as any).cost })}`);

    if (!rpc.Api.isSimulationSuccess(simResult)) {
      this.logger.debug(`[Soroban] Simulation failed details: ${JSON.stringify(simResult)}`);
      throw new Error(`Soroban simulation failed: ${(simResult as any).error || JSON.stringify(simResult)}`);
    }

    const preparedTx = rpc.assembleTransaction(tx, simResult).build();
    this.logger.debug(`[Soroban] Transaction assembled with resource footprint. Signing...`);
    preparedTx.sign(keypair);
    return preparedTx;
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

    const preparedTx = await this.prepareContractCall(tx, adminKeypair);
    const response = await this.sorobanServer.sendTransaction(preparedTx);
    if (response.status !== 'PENDING') throw new Error(`Stellar Tx failed: ${response.status}`);

    await this.confirmTransaction(response.hash);
    return { txId: response.hash };
  }

  async registerAssetInRegistry(dto: any): Promise<{ txId: string }> {
    const { assetId, totalSupply, attestationHash, blobId, symbol } = dto;
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const contractId = this.contractAdapter.getContractAddress('AssetRegistry');
    const contract = new Contract(contractId);
    
    // Use provided symbol or generate one from assetId
    const assetCode = symbol || 'RWA' + assetId.replace(/^0x/i, '').substring(0, 8).toUpperCase();

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

    const preparedTx = await this.prepareContractCall(tx, adminKeypair);
    const response = await this.sorobanServer.sendTransaction(preparedTx);
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

    const preparedTx = await this.prepareContractCall(tx, adminKeypair);
    const response = await this.sorobanServer.sendTransaction(preparedTx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  async revokeAssetInRegistry(assetId: string): Promise<{ txId: string }> {
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const contractId = this.contractAdapter.getContractAddress('AssetRegistry');
    const contract = new Contract(contractId);
    const assetCode = 'RWA' + assetId.replace(/^0x/i, '').substring(0, 8).toUpperCase();

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

    const preparedTx = await this.prepareContractCall(tx, adminKeypair);
    const response = await this.sorobanServer.sendTransaction(preparedTx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  private async deactivateListing(tokenIdentifier: string): Promise<{ txId: string }> {
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
        xdr.ScVal.scvString(assetCode || ''),
      )
    )
    .setTimeout(30)
    .build();

    const preparedTx = await this.prepareContractCall(tx, adminKeypair);
    const response = await this.sorobanServer.sendTransaction(preparedTx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  async endAuction(
    tokenIdentifier: string,
    clearingPrice: string
  ): Promise<{ txId: string }> {
    this.logger.log(`Ending Stellar auction for ${tokenIdentifier}. Clearing price ${clearingPrice} is handled off-chain.`);
    return this.deactivateListing(tokenIdentifier);
  }

  async deployToken(
    assetId: string,
    totalSupply: string | number,
    params: {
      attestationHash?: string;
      blobId?: string;
      symbol?: string;
    }
  ): Promise<DeployedTokenResult> {
    const platformKeypair = this.walletAdapter.getPlatformKeypair();
    const assetCode = params.symbol || 'RWA' + assetId.replace(/^0x/i, '').substring(0, 8).toUpperCase();
    
    this.logger.log(`Registering and creating native Stellar asset ${assetCode} for asset ${assetId}...`);

    // 1. Register in AssetRegistry
    await this.registerAssetInRegistry({
      assetId,
      totalSupply,
      attestationHash: params.attestationHash || '0x' + '0'.repeat(64),
      blobId: params.blobId || '0x' + '0'.repeat(64),
      symbol: params.symbol
    });

    // 2. Set AUTH flags on platform account (issuer)
    const source = await this.sorobanServer.getAccount(platformKeypair.publicKey());
    
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(Operation.setOptions({
      setFlags: (1 | 2 | 8) as any, // AUTH_REQUIRED | AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED
    }))
    .setTimeout(30)
    .build();

    tx.sign(platformKeypair);
    let flagsTxId: string;
    try {
      const response = await this.sorobanServer.sendTransaction(tx);
      await this.confirmTransaction(response.hash);
      flagsTxId = response.hash;
    } catch (err: any) {
      // setOptionsCantChange (-5) means the account flags are already configured — treat as success
      if (err?.message?.includes('setOptionsCantChange') || err?.message?.includes('failed')) {
        this.logger.warn(`Platform account flags already set (or immutable) — skipping setOptions for ${assetCode}`);
        flagsTxId = 'skipped';
      } else {
        throw err;
      }
    }

    // 3. Deploy the SAC (Stellar Asset Contract) for this classic asset.
    //    The SAC must exist before listOnMarketplace can call set_authorized or mint on it.
    const assetIdentifier = `${assetCode}:${platformKeypair.publicKey()}`;
    const rpcUrl = this.configService.get<string>('network.stellar.rpcUrl') || 'https://soroban-testnet.stellar.org';
    try {
      const sacId = execSync(
        `stellar contract asset deploy --asset "${assetIdentifier}" --rpc-url "${rpcUrl}" --network-passphrase "${this.networkPassphrase}" --source-account ${platformKeypair.secret()}`,
        { encoding: 'utf8', stdio: 'pipe' },
      ).trim();
      this.logger.log(`SAC deployed for ${assetCode}: ${sacId}`);
    } catch (err: any) {
      const stderr = (err.stderr as string) || '';
      if (stderr.includes('ExistingValue') || stderr.includes('already exists')) {
        this.logger.warn(`SAC already deployed for ${assetCode} — skipping`);
      } else {
        // Non-fatal: log and continue. Listing will surface a clearer error if SAC is missing.
        this.logger.error(`SAC deploy warning for ${assetCode}: ${stderr || (err as Error).message}`);
      }
    }

    return {
      primaryIdentifier: `${assetCode}:${platformKeypair.publicKey()}`,
      txId: flagsTxId,
    };
  }

  async listOnMarketplace(
    tokenIdentifier: string,
    listingType: ListingType,
    price: string | number,
    minInvestment: string | number,
    duration: number,
    totalSupply: string | number,
    minPrice?: string,
  ): Promise<{ txId: string }> {
    const adminKeypair = this.walletAdapter.getAdminKeypair();
    const platformKeypair = this.walletAdapter.getPlatformKeypair();
    const contractId = this.contractAdapter.getContractAddress('PrimaryMarket');
    const primaryMarket = new Contract(contractId);
    
    // In Stellar, tokenIdentifier is "ASSET_CODE:ISSUER_PUBKEY"
    const [assetCode, issuerPublicKey] = tokenIdentifier.split(':');

    // The SAC (Stellar Asset Contract) address derived from the classic asset.
    const sacContractId = new Asset(assetCode || '', issuerPublicKey || '').contractId(this.networkPassphrase);
    const sacContract = new Contract(sacContractId);

    this.logger.log(`Listing ${assetCode} on Stellar Primary Market...`);
    this.logger.debug(`SAC: ${sacContractId}`);
    this.logger.debug(`PrimaryMarket: ${contractId}`);

    // Convert canonical inputs to raw integer stroops/USDC FIRST
    // This must happen before any blockchain operations that use these values
    const priceRaw = fromCanonical(price.toString(), 6); // USDC Price (6 decimals)
    const minPriceRaw = minPrice && minPrice !== '0' && minPrice !== 'null'
      ? fromCanonical(minPrice.toString(), 6)
      : 0n;
    const totalSupplyRaw = fromCanonical(totalSupply.toString(), 7); // Token Amount (7 decimals)

    // SAC operations (set_authorized, mint) require the issuer (platformKeypair) as both
    // the source account and the Soroban auth signer.
    if (platformKeypair.publicKey() === issuerPublicKey) {
      // Step 1: Authorize the PrimaryMarket balance entry on the SAC.
      //         AUTH_REQUIRED is set, so any address (including contracts) must be authorized
      //         via set_authorized() before it can receive tokens.
      this.logger.log(`Authorizing PrimaryMarket balance on SAC...`);
      let sacSource = await this.sorobanServer.getAccount(platformKeypair.publicKey());

      const authTx = new TransactionBuilder(sacSource, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
      .addOperation(sacContract.call(
        'set_authorized',
        new Address(contractId).toScVal(),
        xdr.ScVal.scvBool(true),
      ))
      .setTimeout(60)
      .build();

      const preparedAuthTx = await this.prepareContractCall(authTx, platformKeypair);
      const authResponse = await this.sorobanServer.sendTransaction(preparedAuthTx);
      if (authResponse.status !== 'PENDING') {
        this.logger.warn(`set_authorized may have failed: ${authResponse.status}`);
      } else {
        await this.confirmTransaction(authResponse.hash);
      }

      // Step 2: Mint total_supply tokens to the PrimaryMarket contract.
      //         The issuer calls mint() (not transfer) since the issuer never "holds" tokens —
      //         it emits them on demand via the SAC.
      this.logger.log(`Minting ${totalSupplyRaw} token stroops to PrimaryMarket...`);
      sacSource = await this.sorobanServer.getAccount(platformKeypair.publicKey());

      const mintTx = new TransactionBuilder(sacSource, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
      .addOperation(sacContract.call(
        'mint',
        new Address(contractId).toScVal(),
        nativeToScVal(totalSupplyRaw, { type: 'i128' }),
      ))
      .setTimeout(60)
      .build();

      const preparedMintTx = await this.prepareContractCall(mintTx, platformKeypair);
      const mintResponse = await this.sorobanServer.sendTransaction(preparedMintTx);
      await this.confirmTransaction(mintResponse.hash);
    }

    // Step 3: Register the listing in the PrimaryMarket contract
    let source = await this.sorobanServer.getAccount(adminKeypair.publicKey());

    // Option<i64> in Soroban: None → scvVoid(), Some(x) → scvI64(x) directly
    let minPriceVal: xdr.ScVal;
    if (minPriceRaw > 0n) {
      minPriceVal = xdr.ScVal.scvI64(xdr.Int64.fromString(minPriceRaw.toString()));
    } else {
      minPriceVal = xdr.ScVal.scvVoid();
    }

    // #[contracttype] unit enum: plain Symbol, no Vec wrapper
    const listingTypeSymbol = listingType.toString().toUpperCase() === 'AUCTION' ? 'Auction' : 'Static';
    const listingTypeVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(listingTypeSymbol)]);

    const listTx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      primaryMarket.call(
        'list_asset',
        new Address(adminKeypair.publicKey()).toScVal(),
        xdr.ScVal.scvString(assetCode || ''),
        new Address(sacContractId).toScVal(),
        listingTypeVal,
        xdr.ScVal.scvI64(xdr.Int64.fromString(priceRaw.toString())),
        minPriceVal,
        xdr.ScVal.scvU64(xdr.Uint64.fromString(duration.toString())),
        xdr.ScVal.scvI64(xdr.Int64.fromString(totalSupplyRaw.toString())),
      )
    )
    .setTimeout(60)
    .build();

    const preparedListTx = await this.prepareContractCall(listTx, adminKeypair);
    const response = await this.sorobanServer.sendTransaction(preparedListTx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  async verifyPurchaseTransaction(
    txHash: string,
    assetId: string,
    expectedBuyer: string,
  ): Promise<PurchaseVerificationResult | null> {
    try {
      this.logger.log(`Verifying Stellar purchase transaction: ${txHash}`);
      const response = await this.sorobanServer.getTransaction(txHash);
      if (response.status !== 'SUCCESS' || !response.resultMetaXdr) {
        this.logger.warn(`Stellar transaction ${txHash} failed or missing meta`);
        return null;
      }

      // response.resultMetaXdr is typed as TransactionMeta in new SDKs when using getTransaction
      // We cast to any to avoid TS issues if types are mismatched in older/newer versions
      const meta = response.resultMetaXdr as unknown as xdr.TransactionMeta;
      
      const events = meta.v3()?.sorobanMeta()?.events();
      if (!events) {
        this.logger.warn(`No events found in transaction ${txHash}`);
        return null;
      }

      const contractIdStr = this.contractAdapter.getContractAddress('PrimaryMarket');

      for (const event of events) {
        // Filter by contract ID
        const eventContractId = event.contractId();
        // Convert Opaque/Hash to Buffer for StrKey encoding
        if (!eventContractId || StrKey.encodeContract(Buffer.from(eventContractId as any)) !== contractIdStr) continue;

        const topics = event.body().v0().topics();
        if (topics.length === 0) continue;

        // First topic is event name
        const eventName = scValToNative(topics[0]!);

        if (eventName === 'TokensPurchased') {
          const data = event.body().v0().data();
          const args = scValToNative(data);
          
          // Expecting [assetId, buyer, amount, price, totalPayment]
          const [evtAssetId, evtBuyer, evtAmount, evtPrice, evtTotalPayment] = args;

          if (evtAssetId === assetId && evtBuyer === expectedBuyer) {
            // Price normalization: Soroban contract stores price divided by 10^10
            // const STELLAR_PRICE_MULTIPLIER = BigInt(10_000_000_000); // 10^10
            // const normalizedPrice = (BigInt(evtPrice) * STELLAR_PRICE_MULTIPLIER).toString();
            // const normalizedTotalPayment = (BigInt(evtTotalPayment) * STELLAR_PRICE_MULTIPLIER).toString();

            return {
              amount: toCanonical(evtAmount, 7), // 7 decimals for tokens on Stellar
              price: toCanonical(evtPrice, 6), // 6 decimals for USDC
              totalPayment: toCanonical(evtTotalPayment, 6), // 6 decimals for USDC
              blockNumber: response.ledger,
              timestamp: Number(response.createdAt),
            };
          }
        }
      }

      this.logger.warn(`TokensPurchased event not found in tx ${txHash}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error verifying purchase tx ${txHash}: ${error.message}`);
      return null;
    }
  }

  async verifyBidTransaction(
    txHash: string,
    assetId: string,
    expectedBidder: string,
  ): Promise<BidVerificationResult | null> {
    try {
      this.logger.log(`Verifying Stellar bid transaction: ${txHash}`);
      const response = await this.sorobanServer.getTransaction(txHash);
      if (response.status !== 'SUCCESS' || !response.resultMetaXdr) {
        this.logger.warn(`Stellar transaction ${txHash} failed or missing meta`);
        return null;
      }

      const meta = response.resultMetaXdr as unknown as xdr.TransactionMeta;
      const events = meta.v3()?.sorobanMeta()?.events();

      if (!events) return null;

      const contractIdStr = this.contractAdapter.getContractAddress('PrimaryMarket');

      for (const event of events) {
        const eventContractId = event.contractId();
        if (!eventContractId || StrKey.encodeContract(Buffer.from(eventContractId as any)) !== contractIdStr) continue;

        const topics = event.body().v0().topics();
        if (topics.length === 0) continue;

        const eventName = scValToNative(topics[0]!);

        if (eventName === 'BidSubmitted') {
          const data = event.body().v0().data();
          const args = scValToNative(data);
          
          // Expecting [assetId, bidder, tokenAmount, price, bidIndex]
          const [evtAssetId, evtBidder, evtTokenAmount, evtPrice, evtBidIndex] = args;

          if (evtAssetId === assetId && evtBidder === expectedBidder) {
            // Price normalization: Soroban contract stores price divided by 10^10
            // We must multiply back to restore canonical 6-decimal USDC form.
            // const STELLAR_PRICE_MULTIPLIER = BigInt(10_000_000_000); // 10^10
            // const normalizedPrice = (BigInt(evtPrice) * STELLAR_PRICE_MULTIPLIER).toString();

            return {
              tokenAmount: toCanonical(evtTokenAmount, 7), // 7 decimals for tokens on Stellar
              price: toCanonical(evtPrice, 6), // 6 decimals for USDC
              bidIndex: Number(evtBidIndex),
            };
          }
        }
      }

      this.logger.warn(`BidSubmitted event not found in tx ${txHash}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error verifying bid tx ${txHash}: ${error.message}`);
      return null;
    }
  }

  async verifyBidSettlement(
    txHash: string,
    assetId: string,
    expectedBidder: string,
  ): Promise<BidSettlementResult | null> {
    try {
      this.logger.log(`Verifying Stellar settlement transaction: ${txHash}`);
      const response = await this.sorobanServer.getTransaction(txHash);
      if (response.status !== 'SUCCESS' || !response.resultMetaXdr) {
        this.logger.warn(`Stellar transaction ${txHash} failed or missing meta`);
        return null;
      }

      const meta = response.resultMetaXdr as unknown as xdr.TransactionMeta;
      const events = meta.v3()?.sorobanMeta()?.events();

      if (!events) return null;

      const contractIdStr = this.contractAdapter.getContractAddress('PrimaryMarket');

      for (const event of events) {
        const eventContractId = event.contractId();
        if (!eventContractId || StrKey.encodeContract(Buffer.from(eventContractId as any)) !== contractIdStr) continue;

        const topics = event.body().v0().topics();
        if (topics.length === 0) continue;

        const eventName = scValToNative(topics[0]!);

        if (eventName === 'BidSettled') {
          const data = event.body().v0().data();
          const args = scValToNative(data);
          
          // Expecting [assetId, bidder, tokensReceived, cost, refund]
          const [evtAssetId, evtBidder, evtTokensReceived, evtCost, evtRefund] = args;

          if (evtAssetId === assetId && evtBidder === expectedBidder) {
            // Price normalization: Soroban contract stores price divided by 10^10
            // cost = (tokensReceived * price) / 10^18. 
            // If evtCost is returned in Stellar format, we must normalize it too.
            // const STELLAR_PRICE_MULTIPLIER = BigInt(10_000_000_000); // 10^10
            // const normalizedCost = (BigInt(evtCost) * STELLAR_PRICE_MULTIPLIER).toString();
            // const normalizedRefund = (BigInt(evtRefund) * STELLAR_PRICE_MULTIPLIER).toString();

            return {
              tokensReceived: toCanonical(evtTokensReceived, 7), // 7 decimals for tokens on Stellar
              cost: toCanonical(evtCost, 6), // 6 decimals for USDC
              refundAmount: toCanonical(evtRefund, 6), // 6 decimals for USDC
            };
          }
        }
      }

      this.logger.warn(`BidSettled event not found in tx ${txHash}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error verifying settlement tx ${txHash}: ${error.message}`);
      return null;
    }
  }

  async registerIdentity(walletAddress: WalletAddress): Promise<{ txId: string }> {
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
        xdr.ScVal.scvU32(365), // 1 year expiry (Some(365 days))
        xdr.ScVal.scvU32(1), // Tier 1
        xdr.ScVal.scvString('US'), // Placeholder country
      )
    )
    .setTimeout(30)
    .build();

    const preparedTx = await this.prepareContractCall(tx, adminKeypair);
    const response = await this.sorobanServer.sendTransaction(preparedTx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  async isVerified(walletAddress: WalletAddress): Promise<boolean> {
    const contractId = this.contractAdapter.getContractAddress('IdentityRegistry');
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(
      new Account(this.walletAdapter.getAdminAddress(), '0'), 
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
      return (response.result!.retval as any).getBool();
    }
    return false;
  }

  async approveTrustline(walletAddress: WalletAddress, assetIdentifier: string): Promise<{ txId: string }> {
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
      assetCode: assetCode || '',
      authorize: true,
    }))
    .setTimeout(30)
    .build();

    tx.sign(platformKeypair);
    const response = await this.sorobanServer.sendTransaction(tx);
    await this.confirmTransaction(response.hash);

    return { txId: response.hash };
  }

  private async confirmTransaction(hash: string, timeoutMs: number = 60000): Promise<rpc.Api.GetTransactionResponse> {
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
