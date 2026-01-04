import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Address, createPublicClient, http, PublicClient } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { WalletService } from '../../blockchain/services/wallet.service';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';

@Injectable()
export class SolvencyBlockchainService {
  private readonly logger = new Logger(SolvencyBlockchainService.name);
  private publicClient: PublicClient;

  constructor(
    private walletService: WalletService,
    private contractLoader: ContractLoaderService,
    private configService: ConfigService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  /**
   * Deposit collateral to Solvency Vault
   */
  async depositCollateral(
    userAddress: string,
    collateralTokenAddress: string,
    collateralAmount: string,
    tokenValueUSD: string,
    tokenType: 'RWA' | 'PRIVATE_ASSET',
    issueOAID: boolean = false,
  ): Promise<{
    positionId: number;
    txHash: string;
    blockNumber: number;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    this.logger.log(`Depositing collateral for user ${userAddress}`);
    this.logger.log(`Token: ${collateralTokenAddress}, Amount: ${collateralAmount}`);
    this.logger.log(`Value: ${tokenValueUSD}, Type: ${tokenType}`);

    // Approve vault to spend user's tokens (platform executes on behalf)
    const tokenAbi = this.contractLoader.getContractAbi('RWAToken');
    const approveHash = await wallet.writeContract({
      address: collateralTokenAddress as Address,
      abi: tokenAbi,
      functionName: 'approve',
      args: [vaultAddress, BigInt(collateralAmount)],
    });

    await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    this.logger.log(`Approval confirmed: ${approveHash}`);

    // Deposit collateral
    const tokenTypeEnum = tokenType === 'RWA' ? 0 : 1; // RWA = 0, PRIVATE_ASSET = 1
    const hash = await wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'depositCollateral',
      args: [
        collateralTokenAddress,
        BigInt(collateralAmount),
        BigInt(tokenValueUSD),
        tokenTypeEnum,
        issueOAID,
      ],
    });

    this.logger.log(`Deposit transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
    });

    this.logger.log(`Deposit confirmed in block ${receipt.blockNumber}`);

    // Parse PositionCreated event to get positionId
    const logs = await this.publicClient.getLogs({
      address: vaultAddress as Address,
      event: {
        type: 'event',
        name: 'PositionCreated',
        inputs: [
          { name: 'positionId', type: 'uint256', indexed: true },
          { name: 'user', type: 'address', indexed: true },
          { name: 'collateralToken', type: 'address', indexed: false },
          { name: 'collateralAmount', type: 'uint256', indexed: false },
          { name: 'tokenValueUSD', type: 'uint256', indexed: false },
          { name: 'tokenType', type: 'uint8', indexed: false },
        ],
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    const positionId = logs.length > 0 ? Number(logs[0]!.topics[1]) : 1;

    return {
      positionId,
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
    };
  }

  /**
   * Borrow USDC against collateral
   */
  async borrowUSDC(
    positionId: number,
    amount: string,
  ): Promise<{
    txHash: string;
    blockNumber: number;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    this.logger.log(`Borrowing ${amount} USDC for position ${positionId}`);

    const hash = await wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'borrowUSDC',
      args: [BigInt(positionId), BigInt(amount)],
    });

    this.logger.log(`Borrow transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
    });

    this.logger.log(`Borrow confirmed in block ${receipt.blockNumber}`);

    return {
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
    };
  }

  /**
   * Repay loan (principal + interest)
   */
  async repayLoan(
    positionId: number,
    amount: string,
  ): Promise<{
    txHash: string;
    blockNumber: number;
    principal: string;
    interest: string;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    this.logger.log(`Repaying ${amount} USDC for position ${positionId}`);

    // Approve vault to spend USDC
    const usdcAddress = this.contractLoader.getContractAddress('USDC');
    const usdcAbi = this.contractLoader.getContractAbi('USDC');

    const approveHash = await wallet.writeContract({
      address: usdcAddress as Address,
      abi: usdcAbi,
      functionName: 'approve',
      args: [vaultAddress, BigInt(amount)],
    });

    await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    this.logger.log(`USDC approval confirmed: ${approveHash}`);

    // Repay loan
    const hash = await wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'repayLoan',
      args: [BigInt(positionId), BigInt(amount)],
    });

    this.logger.log(`Repay transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
    });

    this.logger.log(`Repay confirmed in block ${receipt.blockNumber}`);

    // Parse LoanRepaid event
    const logs = await this.publicClient.getLogs({
      address: vaultAddress as Address,
      event: {
        type: 'event',
        name: 'LoanRepaid',
        inputs: [
          { name: 'positionId', type: 'uint256', indexed: true },
          { name: 'amount', type: 'uint256', indexed: false },
          { name: 'principal', type: 'uint256', indexed: false },
          { name: 'interest', type: 'uint256', indexed: false },
          { name: 'remainingDebt', type: 'uint256', indexed: false },
        ],
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    const principal = logs.length > 0 ? logs[0]!.args.principal?.toString() || '0' : '0';
    const interest = logs.length > 0 ? logs[0]!.args.interest?.toString() || '0' : '0';

    return {
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      principal,
      interest,
    };
  }

  /**
   * Withdraw collateral (after full repayment)
   */
  async withdrawCollateral(
    positionId: number,
    amount: string,
  ): Promise<{
    txHash: string;
    blockNumber: number;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    this.logger.log(`Withdrawing ${amount} collateral from position ${positionId}`);

    const hash = await wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'withdrawCollateral',
      args: [BigInt(positionId), BigInt(amount)],
    });

    this.logger.log(`Withdraw transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
    });

    this.logger.log(`Withdraw confirmed in block ${receipt.blockNumber}`);

    return {
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
    };
  }

  /**
   * Liquidate position (admin only)
   */
  async liquidatePosition(
    positionId: number,
    marketplaceAssetId: string,
  ): Promise<{
    txHash: string;
    blockNumber: number;
    discountedPrice: string;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    this.logger.log(`Liquidating position ${positionId}`);
    this.logger.log(`Marketplace asset ID: ${marketplaceAssetId}`);

    const hash = await wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'liquidatePosition',
      args: [BigInt(positionId), marketplaceAssetId as `0x${string}`],
    });

    this.logger.log(`Liquidation transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
    });

    this.logger.log(`Liquidation confirmed in block ${receipt.blockNumber}`);

    // Parse PositionLiquidated event
    const logs = await this.publicClient.getLogs({
      address: vaultAddress as Address,
      event: {
        type: 'event',
        name: 'PositionLiquidated',
        inputs: [
          { name: 'positionId', type: 'uint256', indexed: true },
          { name: 'marketplaceAssetId', type: 'bytes32', indexed: false },
          { name: 'discountedPrice', type: 'uint256', indexed: false },
        ],
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    const discountedPrice = logs.length > 0 ? logs[0]!.args.discountedPrice?.toString() || '0' : '0';

    return {
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      discountedPrice,
    };
  }

  /**
   * Get health factor for position
   */
  async getHealthFactor(positionId: number): Promise<number> {
    
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    const healthFactor = await this.publicClient.readContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'getHealthFactor',
      args: [BigInt(positionId)],
    }) as bigint;

    return Number(healthFactor);
  }

  /**
   * Get outstanding debt from SeniorPool
   */
  async getOutstandingDebt(positionId: number): Promise<string> {
    
    const seniorPoolAddress = this.contractLoader.getContractAddress('SeniorPool');
    const seniorPoolAbi = this.contractLoader.getContractAbi('SeniorPool');

    const debt = await this.publicClient.readContract({
      address: seniorPoolAddress as Address,
      abi: seniorPoolAbi,
      functionName: 'getOutstandingDebt',
      args: [BigInt(positionId)],
    }) as bigint;

    return debt.toString();
  }

  /**
   * Get position details from contract
   */
  async getPosition(positionId: number): Promise<{
    user: string;
    collateralToken: string;
    collateralAmount: string;
    usdcBorrowed: string;
    tokenValueUSD: string;
    createdAt: number;
    active: boolean;
    tokenType: number;
  }> {
    
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    const position = await this.publicClient.readContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'getPosition',
      args: [BigInt(positionId)],
    }) as any;

    return {
      user: position[0],
      collateralToken: position[1],
      collateralAmount: position[2].toString(),
      usdcBorrowed: position[3].toString(),
      tokenValueUSD: position[4].toString(),
      createdAt: Number(position[5]),
      active: position[6],
      tokenType: Number(position[7]),
    };
  }

  /**
   * Get max borrowable amount for position
   */
  async getMaxBorrow(positionId: number): Promise<string> {
    
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    const maxBorrow = await this.publicClient.readContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'getMaxBorrow',
      args: [BigInt(positionId)],
    }) as bigint;

    return maxBorrow.toString();
  }
}
