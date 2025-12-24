import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, Address } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ContractLoaderService } from './contract-loader.service';
import { WalletService } from './wallet.service';
import { RegisterAssetDto } from '../dto/register-asset.dto';
import { DeployTokenDto } from '../dto/deploy-token.dto';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    private walletService: WalletService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  async registerAsset(dto: RegisterAssetDto): Promise<Hash> {
    const { assetId, attestationHash, blobId, payload, signature } = dto;
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('AttestationRegistry');
    const abi = this.contractLoader.getContractAbi('AttestationRegistry');

    this.logger.log(`Registering asset ${assetId} on-chain...`);

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'registerAsset',
      args: [assetId, attestationHash, blobId, payload, signature],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    this.logger.log(`Asset registered: ${hash}`);
    return hash;
  }

  async registerIdentity(walletAddress: string): Promise<Hash> {
    const wallet = this.walletService.getAdminWallet(); // Admin is trusted issuer
    const address = this.contractLoader.getContractAddress('IdentityRegistry');
    const abi = this.contractLoader.getContractAbi('IdentityRegistry');

    this.logger.log(`Registering identity for ${walletAddress}...`);

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'registerIdentity',
      args: [walletAddress],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async deployToken(dto: DeployTokenDto): Promise<string> {
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('TokenFactory');
    const abi = this.contractLoader.getContractAbi('TokenFactory');

    this.logger.log(`Deploying token for asset ${dto.assetId}...`);

    // Convert UUID to bytes32 for on-chain usage
    const assetIdBytes32 = '0x' + dto.assetId.replace(/-/g, '').padEnd(64, '0');
    
    // Use provided values or defaults
    const totalSupply = dto.totalSupply || '100000'; // Default 100k tokens
    const issuer = dto.issuer || wallet.account.address; // Default to admin wallet

    this.logger.log(`Token params: supply=${totalSupply}, name=${dto.name}, symbol=${dto.symbol}, issuer=${issuer}`);

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'deployTokenSuite',
      args: [assetIdBytes32, BigInt(totalSupply), dto.name, dto.symbol, issuer],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    
    // Parse logs to find TokenSuiteDeployed event and extract token address
    // This requires parsing logic, simplified here:
    // Ideally use parseEventLogs from viem
    this.logger.log(`Token deployed in tx: ${hash}`);
    
    // For now, return tx hash. The event listener service should pick up the actual address.
    // Or we can parse it here if needed immediately.
    return hash; 
  }

  async depositYield(tokenAddress: string, amount: string): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('YieldVault');
    const abi = this.contractLoader.getContractAbi('YieldVault');
    
    // First approve USDC
    // This assumes Platform Wallet holds the USDC. 
    // Implementation of USDC approval skipped for brevity but required in prod.

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'depositYield',
      args: [tokenAddress, BigInt(amount)],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async distributeYield(tokenAddress: string, holders: string[], amounts: string[]): Promise<Hash> {
    const wallet = this.walletService.getPlatformWallet();
    const address = this.contractLoader.getContractAddress('YieldVault');
    const abi = this.contractLoader.getContractAbi('YieldVault');

    const amountBigInts = amounts.map(a => BigInt(a));

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'distributeYieldBatch',
      args: [tokenAddress, holders, amountBigInts],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async listOnMarketplace(
    tokenAddress: string,
    type: 'STATIC' | 'AUCTION',
    price: string,
    minInvestment: string,
    duration?: string,
  ): Promise<Hash> {
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('PrimaryMarketplace');
    const abi = this.contractLoader.getContractAbi('PrimaryMarketplace');

    this.logger.log(`Listing token ${tokenAddress} on ${type} marketplace...`);

    // For STATIC listings
    if (type === 'STATIC') {
      const hash = await wallet.writeContract({
        address: address as Address,
        abi,
        functionName: 'listToken',
        args: [tokenAddress, BigInt(price), BigInt(minInvestment)],
      });

      await this.publicClient.waitForTransactionReceipt({ hash });
      this.logger.log(`Token listed in tx: ${hash}`);
      return hash;
    }

    // For AUCTION listings
    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'listTokenAuction',
      args: [
        tokenAddress,
        BigInt(price), // Starting price
        BigInt(minInvestment),
        BigInt(duration || '86400'), // Default 24 hours
      ],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    this.logger.log(`Auction listed in tx: ${hash}`);
    return hash;
  }

  async revokeAsset(assetId: string, reason: string): Promise<Hash> {
    const wallet = this.walletService.getAdminWallet();
    const address = this.contractLoader.getContractAddress('AttestationRegistry');
    const abi = this.contractLoader.getContractAbi('AttestationRegistry');

    const hash = await wallet.writeContract({
      address: address as Address,
      abi,
      functionName: 'revokeAsset',
      args: [assetId, reason],
    });

    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // Read Methods
  async isVerified(walletAddress: string): Promise<boolean> {
    const address = this.contractLoader.getContractAddress('IdentityRegistry');
    const abi = this.contractLoader.getContractAbi('IdentityRegistry');

    return await this.publicClient.readContract({
      address: address as Address,
      abi,
      functionName: 'isVerified',
      args: [walletAddress],
    }) as boolean;
  }
}
