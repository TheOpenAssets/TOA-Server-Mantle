import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  createPublicClient, 
  http, 
  Address, 
  decodeEventLog, 
  defineChain,
  PublicClient 
} from 'viem';
import { ListingType, WalletAddress } from '@openassets/types';
import { BlockchainAdapter, DeployedTokenResult } from '../blockchain-adapter.interface';
import { EvmWalletAdapter } from './evm-wallet.adapter';
import { EvmContractAdapter } from './evm-contract-loader.adapter';

export class EvmBlockchainAdapter implements BlockchainAdapter {
  private readonly logger = new Logger(EvmBlockchainAdapter.name);
  private publicClient: PublicClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly walletAdapter: EvmWalletAdapter,
    private readonly contractAdapter: EvmContractAdapter,
  ) {
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl') || 'http://localhost:8545';
    const chainId = this.configService.get<number>('blockchain.chainId') || 5003;
    const networkName = this.configService.get<string>('network.networkName') || 'Mantle Sepolia';

    const chain = defineChain({
      id: chainId,
      name: networkName,
      nativeCurrency: {
        decimals: 18,
        name: 'MNT',
        symbol: 'MNT',
      },
      rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] },
      },
    });

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient;
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    description: string,
    maxRetries: number = 5,
    initialDelay: number = 2000,
  ): Promise<T> {
    let retries = 0;
    let delay = initialDelay;

    while (true) {
      try {
        return await operation();
      } catch (error: any) {
        retries++;
        if (retries > maxRetries) {
          this.logger.error(`Failed ${description} after ${maxRetries} retries: ${error.message}`);
          throw error;
        }
        this.logger.warn(
          `Error in ${description} (attempt ${retries}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  async registerAsset(dto: any): Promise<{ txId: string }> {
    const { assetId, attestationHash, blobId, payload, signature } = dto;
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('AttestationRegistry');
    const abi = this.contractAdapter.getContractInterface('AttestationRegistry');

    this.logger.log(`Registering asset ${assetId} on EVM chain...`);

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'registerAsset',
      args: [assetId, attestationHash, blobId, payload, signature],
    }), 'registerAsset write') as `0x${string}`;

    this.logger.log(`Asset registered on EVM: ${txId}`);
    return { txId };
  }

  async revokeAsset(assetId: string): Promise<{ txId: string }> {
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('AttestationRegistry');
    const abi = this.contractAdapter.getContractInterface('AttestationRegistry');

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'revokeAsset',
      args: [assetId, 'REASON_NOT_SPECIFIED'],
    }), 'revokeAsset write') as `0x${string}`;

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({ hash: txId }), 'revokeAsset receipt');
    return { txId };
  }

  async deployToken(
    assetId: string,
    totalSupply: number,
    params: {
      name?: string;
      symbol?: string;
    }
  ): Promise<DeployedTokenResult> {
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('TokenFactory');
    const abi = this.contractAdapter.getContractInterface('TokenFactory');

    // Convert UUID to bytes32
    const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');
    const totalSupplyBigInt = BigInt(totalSupply);
    const issuer = wallet.account?.address;
    const { name, symbol } = params;

    this.logger.log(`Deploying EVM token for asset ${assetId}...`);

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'deployTokenSuite',
      args: [assetIdBytes32, totalSupplyBigInt, name || 'RWA Token', symbol || 'RWA', issuer],
    }), 'deployTokenSuite write') as `0x${string}`;

    const receipt = await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: txId,
      timeout: 180000,
    }), 'deployTokenSuite receipt');

    let tokenAddress: string | undefined;
    let complianceAddress: string | undefined;

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        }) as { eventName: string; args: any };

        if (decoded.eventName === 'TokenSuiteDeployed') {
          tokenAddress = decoded.args.token;
          complianceAddress = decoded.args.compliance;
          break;
        }
      } catch { continue; }
    }

    if (!tokenAddress) throw new Error('TokenSuiteDeployed event not found');

    return {
      primaryIdentifier: tokenAddress,
      auxiliaryIdentifier: complianceAddress,
      txId,
    };
  }

  async listOnMarketplace(
    tokenIdentifier: string,
    listingType: ListingType,
    price: number,
    minInvestment: number,
    duration: number,
    totalSupply: number,
    minPrice?: string
  ): Promise<{ txId: string }> {
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('PrimaryMarketplace');
    const abi = this.contractAdapter.getContractInterface('PrimaryMarketplace');

    const listingTypeEnum = listingType === ListingType.STATIC ? 0 : 1;
    const dummyAssetId = '0x' + '0'.repeat(64); 

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'createListing',
      args: [
        dummyAssetId,
        tokenIdentifier as Address,
        listingTypeEnum,
        BigInt(price),
        BigInt(minPrice || '0'),
        BigInt(duration),
        BigInt(totalSupply),
        BigInt(minInvestment),
      ],
    }), 'createListing write') as `0x${string}`;

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: txId,
      timeout: 180000,
    }), 'createListing receipt');

    return { txId };
  }

  async registerIdentity(walletAddress: WalletAddress): Promise<{ txId: string }> {
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('IdentityRegistry');
    const abi = this.contractAdapter.getContractInterface('IdentityRegistry');

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'registerIdentity',
      args: [walletAddress],
    }), 'registerIdentity write') as `0x${string}`;

    await this.executeWithReceipt(txId, 'registerIdentity');

    return { txId };
  }

  private async executeWithReceipt(hash: string, description: string) {
    return await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: hash as `0x${string}`,
      timeout: 300000,
    }), `${description} receipt`);
  }

  async isVerified(walletAddress: WalletAddress): Promise<boolean> {
    const address = this.contractAdapter.getContractAddress('IdentityRegistry');
    const abi = this.contractAdapter.getContractInterface('IdentityRegistry');

    return await this.executeWithRetry(() => this.publicClient.readContract({
      address: address as Address,
      abi,
      functionName: 'isVerified',
      args: [walletAddress],
    }), 'isVerified check') as boolean;
  }
}
