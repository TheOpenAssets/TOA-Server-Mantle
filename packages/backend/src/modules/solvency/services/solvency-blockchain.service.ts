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

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 5,
    initialDelay: number = 2000,
  ): Promise<T> {
    let retries = 0;
    while (true) {
      try {
        return await operation();
      } catch (error: any) {
        // Check for nonce errors or other transient issues
        const errorMessage = error?.message || '';
        const errorDetails = error?.details || '';
        const causeMessage = error?.cause?.message || '';
        
        const isNonceError =
          errorMessage.includes('nonce too low') ||
          errorDetails.includes('nonce too low') ||
          causeMessage.includes('nonce too low') ||
          errorMessage.includes('replacement transaction underpriced');

        if (isNonceError && retries < maxRetries) {
          retries++;
          const delay = initialDelay * Math.pow(1.5, retries - 1); // Exponential backoff
          this.logger.warn(
            `Transaction failed with nonce/replacement error. Retrying attempt ${retries}/${maxRetries} after ${Math.round(delay)}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }
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
    const approveHash = await this.retryWithBackoff(() => wallet.writeContract({
      address: collateralTokenAddress as Address,
      abi: tokenAbi,
      functionName: 'approve',
      args: [vaultAddress, BigInt(collateralAmount)],
    }));

    await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    this.logger.log(`Approval confirmed: ${approveHash}`);

    // Deposit collateral
    const tokenTypeEnum = tokenType === 'RWA' ? 0 : 1; // RWA = 0, PRIVATE_ASSET = 1
    const hash = await this.retryWithBackoff(() => wallet.writeContract({
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
    }));

    this.logger.log(`Deposit transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 300_000, // 5 minutes timeout for Mantle Sepolia
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
   * Get position details from chain
   */
  async getPositionFromChain(positionId: number): Promise<{
    user: string;
    collateralToken: string;
    collateralAmount: bigint;
    usdcBorrowed: bigint;
    tokenValueUSD: bigint;
    createdAt: bigint;
    active: boolean;
    tokenType: number;
  }> {
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    this.logger.log(`Fetching position ${positionId} from chain`);

    const position = await this.publicClient.readContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'positions',
      args: [BigInt(positionId)],
    }) as any;

    return {
      user: position[0],
      collateralToken: position[1],
      collateralAmount: position[2],
      usdcBorrowed: position[3],
      tokenValueUSD: position[4],
      createdAt: position[5],
      active: position[6],
      tokenType: position[7],
    };
  }

  /**
   * Borrow USDC against collateral
   */
  async borrowUSDC(
    positionId: number,
    amount: string,
    loanDuration: number,
    numberOfInstallments: number,
  ): Promise<{
    txHash: string;
    blockNumber: number;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    this.logger.log(`Borrowing ${amount} USDC for position ${positionId}`);
    this.logger.log(`Terms: ${loanDuration}s duration, ${numberOfInstallments} installments`);

    const hash = await this.retryWithBackoff(() => wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'borrowUSDC',
      args: [
        BigInt(positionId),
        BigInt(amount),
        BigInt(loanDuration),
        BigInt(numberOfInstallments),
      ],
    }));

    this.logger.log(`Borrow transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 300_000, // 5 minutes timeout
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

    const approveHash = await this.retryWithBackoff(() => wallet.writeContract({
      address: usdcAddress as Address,
      abi: usdcAbi,
      functionName: 'approve',
      args: [vaultAddress, BigInt(amount)],
    }));

    await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    this.logger.log(`USDC approval confirmed: ${approveHash}`);

    // Repay loan
    const hash = await this.retryWithBackoff(() => wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'repayLoan',
      args: [BigInt(positionId), BigInt(amount)],
    }));

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

    const hash = await this.retryWithBackoff(() => wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'withdrawCollateral',
      args: [BigInt(positionId), BigInt(amount)],
    }));

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

    const hash = await this.retryWithBackoff(() => wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'liquidatePosition',
      args: [BigInt(positionId), marketplaceAssetId as `0x${string}`],
    }));

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

  /**
   * Get repayment plan details
   */
  async getRepaymentPlan(positionId: number): Promise<{
    loanDuration: number;
    numberOfInstallments: number;
    installmentInterval: number;
    nextPaymentDue: number;
    installmentsPaid: number;
    missedPayments: number;
    isActive: boolean;
  }> {
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');

    const plan = await this.publicClient.readContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'getRepaymentPlan',
      args: [BigInt(positionId)],
    }) as any;

    return {
      loanDuration: Number(plan.loanDuration),
      numberOfInstallments: Number(plan.numberOfInstallments),
      installmentInterval: Number(plan.installmentInterval),
      nextPaymentDue: Number(plan.nextPaymentDue),
      installmentsPaid: Number(plan.installmentsPaid),
      missedPayments: Number(plan.missedPayments),
      isActive: plan.isActive,
    };
  }

  /**
   * Check if user has existing OAID registration
   */
  async hasOAIDCreditLine(userAddress: string): Promise<boolean> {
    try {
      const oaidAddress = this.contractLoader.getContractAddress('OAID');
      if (!oaidAddress) {
        this.logger.warn('OAID contract address not found');
        return false;
      }

      const oaidAbi = this.contractLoader.getContractAbi('OAID');

      const isRegistered = await this.publicClient.readContract({
        address: oaidAddress as Address,
        abi: oaidAbi,
        functionName: 'isUserRegistered',
        args: [userAddress as Address],
      }) as boolean;

      return isRegistered;
    } catch (error) {
      this.logger.error(`Error checking OAID registration: ${error}`);
      return false;
    }
  }

  /**
   * Register user in OAID system (after KYC verification)
   * This creates initial registration, credit lines will be added when they deposit collateral
   */
  async registerUserInOAID(userAddress: string): Promise<{
    txHash: string;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    const oaidAddress = this.contractLoader.getContractAddress('OAID');
    
    if (!oaidAddress) {
      throw new Error('OAID contract address not found in deployed_contracts.json');
    }

    const oaidAbi = this.contractLoader.getContractAbi('OAID');

    this.logger.log(`Registering user ${userAddress} in OAID system...`);

    // Register user
    const hash = await this.retryWithBackoff(() => wallet.writeContract({
      address: oaidAddress as Address,
      abi: oaidAbi,
      functionName: 'registerUser',
      args: [userAddress as Address],
    }));

    this.logger.log(`OAID registration transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
    });

    this.logger.log(`User registered in OAID at block ${receipt.blockNumber}`);

    return {
      txHash: hash,
    };
  }

  
  /**
   * Get all OAID credit lines for a user
   */
  async getOAIDCreditLines(userAddress: string): Promise<{
    totalCreditLimit: string;
    totalCreditUsed: string;
    totalAvailableCredit: string;
    creditLines: Array<{
      creditLineId: number;
      collateralToken: string;
      collateralAmount: string;
      creditLimit: string;
      creditUsed: string;
      availableCredit: string;
      solvencyPositionId: number;
      issuedAt: number;
      active: boolean;
    }>;
  }> {
    try {
      const oaidAddress = this.contractLoader.getContractAddress('OAID');
      if (!oaidAddress) {
        throw new Error('OAID contract address not found');
      }

      const oaidAbi = this.contractLoader.getContractAbi('OAID');

      // Get all credit line IDs for user
      const creditLineIds = await this.publicClient.readContract({
        address: oaidAddress as Address,
        abi: oaidAbi,
        functionName: 'getUserCreditLines',
        args: [userAddress as Address],
      }) as bigint[];

      this.logger.log(`Found ${creditLineIds.length} credit lines for ${userAddress}`);

      // Fetch details for each credit line
      const creditLines = await Promise.all(
        creditLineIds.map(async (id) => {
          const creditLine = await this.publicClient.readContract({
            address: oaidAddress as Address,
            abi: oaidAbi,
            functionName: 'getCreditLine',
            args: [id],
          }) as any;

          const availableCredit = creditLine.active
            ? BigInt(creditLine.creditLimit) - BigInt(creditLine.creditUsed)
            : BigInt(0);

          return {
            creditLineId: Number(id),
            collateralToken: creditLine.collateralToken,
            collateralAmount: creditLine.collateralAmount.toString(),
            creditLimit: creditLine.creditLimit.toString(),
            creditUsed: creditLine.creditUsed.toString(),
            availableCredit: availableCredit.toString(),
            solvencyPositionId: Number(creditLine.solvencyPositionId),
            issuedAt: Number(creditLine.issuedAt),
            active: creditLine.active,
          };
        })
      );

      // Calculate totals (only active lines)
      const activeLines = creditLines.filter(line => line.active);
      const totalCreditLimit = activeLines.reduce(
        (sum, line) => sum + BigInt(line.creditLimit),
        BigInt(0)
      );
      const totalCreditUsed = activeLines.reduce(
        (sum, line) => sum + BigInt(line.creditUsed),
        BigInt(0)
      );
      const totalAvailableCredit = totalCreditLimit - totalCreditUsed;

      return {
        totalCreditLimit: totalCreditLimit.toString(),
        totalCreditUsed: totalCreditUsed.toString(),
        totalAvailableCredit: totalAvailableCredit.toString(),
        creditLines,
      };
    } catch (error) {
      this.logger.error(`Error fetching OAID credit lines: ${error}`);
      throw error;
    }
  }

  /**
   * Admin purchases liquidated Private Asset collateral and settles position
   * Admin sends USDC, receives tokens, contract settles debt
   */
  async purchaseAndSettleLiquidation(
    positionId: number,
    purchaseAmountUSDC: string,
  ): Promise<{
    txHash: string;
    blockNumber: number;
    liquidationFee: string;
    userRefund: string;
  }> {
    const wallet = this.walletService.getPlatformWallet();
    const vaultAddress = this.contractLoader.getContractAddress('SolvencyVault');
    const vaultAbi = this.contractLoader.getContractAbi('SolvencyVault');
    const usdcAddress = this.contractLoader.getContractAddress('USDC');
    const usdcAbi = this.contractLoader.getContractAbi('USDC');

    this.logger.log(
      `Admin purchasing liquidated position ${positionId} for ${purchaseAmountUSDC} USDC`,
    );

    // Approve SolvencyVault to spend admin's USDC
    const approveHash = await this.retryWithBackoff(() => wallet.writeContract({
      address: usdcAddress as Address,
      abi: usdcAbi,
      functionName: 'approve',
      args: [vaultAddress, BigInt(purchaseAmountUSDC)],
    }));

    await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    this.logger.log(`USDC approval confirmed: ${approveHash}`);

    // Purchase and settle liquidation
    const hash = await this.retryWithBackoff(() => wallet.writeContract({
      address: vaultAddress as Address,
      abi: vaultAbi,
      functionName: 'purchaseAndSettleLiquidation',
      args: [BigInt(positionId), BigInt(purchaseAmountUSDC)],
    }));

    this.logger.log(`Purchase and settlement transaction submitted: ${hash}`);

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 300_000,
    });

    this.logger.log(
      `Private asset liquidation settled at block ${receipt.blockNumber}`,
    );

    // Parse event to get liquidation fee and user refund
    const logs = await this.publicClient.getLogs({
      address: vaultAddress as Address,
      event: {
        type: 'event',
        name: 'PrivateAssetLiquidationSettled',
        inputs: [
          { name: 'positionId', type: 'uint256', indexed: true },
          { name: 'purchaser', type: 'address', indexed: true },
          { name: 'purchaseAmount', type: 'uint256', indexed: false },
          { name: 'tokensTransferred', type: 'uint256', indexed: false },
          { name: 'debtRepaid', type: 'uint256', indexed: false },
          { name: 'liquidationFee', type: 'uint256', indexed: false },
          { name: 'userRefund', type: 'uint256', indexed: false },
        ],
      },
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    let liquidationFee = '0';
    let userRefund = '0';

    if (logs.length > 0 && logs[0] && logs[0].args) {
      const args = logs[0].args as any;
      liquidationFee = args.liquidationFee.toString();
      userRefund = args.userRefund.toString();
    }

    return {
      txHash: hash,
      blockNumber: Number(receipt.blockNumber),
      liquidationFee,
      userRefund,
    };
  }
}
