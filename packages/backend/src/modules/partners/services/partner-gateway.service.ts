import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { Address, createPublicClient, http, PublicClient, keccak256, toBytes } from 'viem';
import {
  PartnerLoan,
  PartnerLoanDocument,
} from '../../../database/schemas/partner-loan.schema';
import { Partner, PartnerDocument } from '../../../database/schemas/partner.schema';
import { SolvencyPositionService } from '../../solvency/services/solvency-position.service';
import { SolvencyBlockchainService } from '../../solvency/services/solvency-blockchain.service';
import { WalletService } from '../../blockchain/services/wallet.service';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { CreditScoreService } from '@/src/modules/credit-score/credit-score.service';
import { PartnerLoanStatus, RepaymentSource } from '@openassets/types';
import { GatewayBorrowDto, GatewayRepayDto } from '../dto/partner-gateway.dto';
import { getActiveChain } from '@/src/config/active-chain';
import { NetworkContextService } from '../../blockchain/services/network-context.service';

const DEFAULT_LTV = 7000;

@Injectable()
export class PartnerGatewayService {
  private readonly logger = new Logger(PartnerGatewayService.name);
  private publicClient: PublicClient;

  constructor(
    @InjectModel(PartnerLoan.name) private partnerLoanModel: Model<PartnerLoanDocument>,
    @InjectModel(Partner.name) private partnerModel: Model<PartnerDocument>,
    private solvencyPositionService: SolvencyPositionService,
    private solvencyBlockchainService: SolvencyBlockchainService,
    private walletService: WalletService,
    private contractLoader: ContractLoaderService,
    private networkContextService: NetworkContextService,
    private creditScoreService: CreditScoreService,
    private configService: ConfigService,
  ) {
    this.publicClient = createPublicClient({
      chain: getActiveChain(),
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  private getExplorerBase(): string {
    const network = this.networkContextService.getNetwork();
    const baseByNetwork: Record<string, string> = {
      bnb: 'https://testnet.bscscan.com',
      mantle: 'https://explorer.testnet.mantle.xyz',
      arbitrum: 'https://sepolia.arbiscan.io',
      creditcoin: 'https://creditcoin-testnet.blockscout.com',
      stellar: 'https://stellar.expert/explorer/testnet',
    };

    return baseByNetwork[network] || baseByNetwork.bnb;
  }

  /**
   * User (JWT authenticated) borrows USDC via a partner protocol.
   *
   * Flow:
   *  1. Find user's first active solvency position
   *  2. Get credit score → effective LTV
   *  3. Validate requested amount ≤ credit-adjusted max
   *  4. SolvencyVault.borrowUSDC()
   *  5. USDC.transfer(partnerContract, amount)
   *  6. MockPartnerProtocol.recordLoan(user, amount, loanId)
   *  7. Save PartnerLoan to DB
   *  8. Return all three tx hashes + explorer links
   */
  async borrowViaPartner(userWallet: string, dto: GatewayBorrowDto) {
    this.logger.log(`Gateway borrow: user=${userWallet} partner=${dto.partnerId} amount=${dto.amount}`);

    // 1. Look up the partner
    const partner = await this.partnerModel.findOne({ partnerId: dto.partnerId, status: 'ACTIVE' });
    if (!partner) throw new NotFoundException('Partner not found or not active');

    // 2. Resolve the solvency position to borrow against
    const positions = await this.solvencyPositionService.getUserActivePositions(userWallet);
    if (!positions.length) {
      throw new BadRequestException('No active solvency position. Deposit collateral first to unlock partner borrowing.');
    }

    let position: (typeof positions)[0];
    if (dto.positionId !== undefined) {
      const found = positions.find(p => p.positionId === dto.positionId);
      if (!found) {
        throw new BadRequestException(
          `Solvency position ${dto.positionId} not found or does not belong to your account.`,
        );
      }
      position = found;
    } else {
      position = positions[0]!;
    }

    // 2b. Verify position is active on-chain (DB may be stale)
    // NOTE: getPositionFromChain() calls the `positions` mapping getter (correct).
    // getPosition() calls `getPosition()` which does NOT exist in deployed SolvencyVault
    // and returns empty bytes → decoded as active=false for ALL positions.
    try {
      const onChainPosition = await this.solvencyBlockchainService.getPositionFromChain(position.positionId);
      if (!onChainPosition.active) {
        throw new BadRequestException(
          `Solvency position ${position.positionId} is not active on-chain. It may have been closed or liquidated. Please select a different position or deposit collateral to create a new one.`,
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        `Could not verify solvency position ${position.positionId} on-chain: ${err.message}`,
      );
    }

    // 3. Credit score → effective LTV
    let effectiveLtv = DEFAULT_LTV;
    let scoreInfo: { score: number; tier: string; hasBoost: boolean; standardLtv: number } = {
      score: 0, tier: 'STANDARD', hasBoost: false, standardLtv: DEFAULT_LTV,
    };
    try {
      const terms = await this.creditScoreService.getBorrowTerms(userWallet);
      effectiveLtv = terms.effectiveLtv;
      scoreInfo = {
        score: terms.compositeScore,
        tier: terms.tier,
        hasBoost: terms.hasBoost,
        standardLtv: terms.standardLtv,
      };
    } catch (_err) {
      this.logger.warn(`Credit score lookup failed for ${userWallet}, using default LTV ${DEFAULT_LTV}`);
    }

    // The vault borrow was already executed by the user directly on-chain.
    // SolvencyVault.borrowUSDC() enforces msg.sender == position.user, so the
    // platform wallet cannot call it — the user must sign it from the frontend.
    // The frontend provides the resulting vaultTxHash here.
    const borrowTxHash = dto.vaultTxHash;
    this.logger.log(`Step 1/2: Vault borrow confirmed by user. txHash=${borrowTxHash}`);

    // USDC.transfer is skipped: when user calls vault.borrowUSDC(), USDC goes directly
    // to the user's wallet (msg.sender). The platform wallet holds no USDC to forward.

    // 2. MockPartnerProtocol.recordLoan(user, amount, loanId) — platform wallet records the loan
    const partnerContractAddress = this.contractLoader.getContractAddress('MockPartnerProtocol') as Address;
    const partnerContractAbi = this.contractLoader.getContractAbi('MockPartnerProtocol');
    const platformWallet = this.walletService.getPlatformWallet();

    const internalLoanId = uuidv4();
    const partnerLoanId = `aave_${internalLoanId.replace(/-/g, '').slice(0, 8)}`;
    const onChainLoanId = keccak256(toBytes(partnerLoanId)) as `0x${string}`;

    this.logger.log(`Step 2/2: MockPartnerProtocol.recordLoan(${userWallet}, ${dto.amount}, ${onChainLoanId})`);
    const recordHash = await platformWallet.writeContract({
      address: partnerContractAddress,
      abi: partnerContractAbi,
      functionName: 'recordLoan',
      args: [userWallet as Address, BigInt(dto.amount), onChainLoanId],
      account: platformWallet.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash: recordHash });

    // 3. Save loan to DB
    await this.partnerLoanModel.create({
      partnerLoanId,
      internalLoanId,
      partnerId: partner.partnerId,
      partnerName: partner.partnerName,
      userWallet,
      solvencyPositionId: position.positionId,
      principalAmount: dto.amount,
      remainingDebt: dto.amount,
      interestRate: 0,
      borrowedAt: new Date(),
      totalRepaid: '0',
      repaymentHistory: [],
      status: PartnerLoanStatus.ACTIVE,
      borrowTxHash,
      platformFeeCharged: '0',
      platformFeePaid: false,
      metadata: { onChainLoanId, recordTxHash: recordHash },
    });

    this.logger.log(`Gateway borrow complete. internalLoanId=${internalLoanId}`);

    return {
      success: true,
      internalLoanId,
      partnerLoanId,
      partnerName: partner.partnerName,
      principalAmount: dto.amount,
      borrowTxHash,
      recordTxHash: recordHash,
      explorerLinks: {
        borrow: `${this.getExplorerBase()}/tx/${borrowTxHash}`,
        record: `${this.getExplorerBase()}/tx/${recordHash}`,
      },
      creditBoost: {
        score: scoreInfo.score,
        tier: scoreInfo.tier,
        appliedLtv: effectiveLtv,
        standardLtv: scoreInfo.standardLtv,
        boosted: scoreInfo.hasBoost,
      },
    };
  }

  /**
   * User (JWT authenticated) repays their partner loan.
   *
   * Flow:
   *  1. Find loan by internalLoanId, verify caller owns it
   *  2. MockPartnerProtocol.repay(onChainLoanId)
   *  3. SolvencyVault.repayLoan()
   *  4. Update loan record in DB
   *  5. Return both tx hashes + explorer links
   */
  async repayViaPartner(userWallet: string, dto: GatewayRepayDto) {
    this.logger.log(`Gateway repay: user=${userWallet} loan=${dto.internalLoanId} amount=${dto.amount}`);

    // 1. Find loan
    const loan = await this.partnerLoanModel.findOne({ internalLoanId: dto.internalLoanId });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.userWallet.toLowerCase() !== userWallet.toLowerCase()) {
      throw new BadRequestException('Not authorised to repay this loan');
    }
    if (loan.status === PartnerLoanStatus.REPAID) {
      throw new BadRequestException('Loan already fully repaid');
    }

    const repayAmount = BigInt(dto.amount);
    const remainingDebt = BigInt(loan.remainingDebt);
    if (repayAmount > remainingDebt) {
      throw new BadRequestException(`Repayment exceeds remaining debt of ${remainingDebt.toString()}`);
    }

    const partnerContractAddress = this.contractLoader.getContractAddress('MockPartnerProtocol') as Address;
    const partnerContractAbi = this.contractLoader.getContractAbi('MockPartnerProtocol');
    const platformWallet = this.walletService.getPlatformWallet();
    const onChainLoanId = loan.metadata?.onChainLoanId as `0x${string}`;

    if (!onChainLoanId) {
      throw new BadRequestException('Loan has no on-chain loan ID — was not created via gateway');
    }

    // 2. MockPartnerProtocol.repay(onChainLoanId)
    this.logger.log(`Step 1/2: MockPartnerProtocol.repay(${onChainLoanId})`);
    const partnerRepayHash = await platformWallet.writeContract({
      address: partnerContractAddress,
      abi: partnerContractAbi,
      functionName: 'repay',
      args: [onChainLoanId],
      account: platformWallet.account!,
    });
    await this.publicClient.waitForTransactionReceipt({ hash: partnerRepayHash });

    // 3. SolvencyVault.repayLoan
    this.logger.log(`Step 2/2: SolvencyVault.repayLoan for position ${loan.solvencyPositionId}`);
    const vaultRepayResult = await this.solvencyBlockchainService.repayLoan(
      loan.solvencyPositionId,
      dto.amount,
    );

    // 4. Update loan record
    const newRemainingDebt = remainingDebt - repayAmount;
    const newStatus = newRemainingDebt === 0n ? PartnerLoanStatus.REPAID : PartnerLoanStatus.ACTIVE;

    loan.remainingDebt = newRemainingDebt.toString();
    loan.totalRepaid = (BigInt(loan.totalRepaid) + repayAmount).toString();
    loan.lastRepaymentAt = new Date();
    loan.status = newStatus;
    loan.repayTxHash = vaultRepayResult.txHash;
    loan.repaymentHistory.push({
      amount: dto.amount,
      timestamp: new Date(),
      txHash: vaultRepayResult.txHash,
      repaidBy: RepaymentSource.PARTNER,
    });
    loan.metadata = {
      ...loan.metadata,
      partnerRepayTxHash: partnerRepayHash,
    };
    await loan.save();

    this.logger.log(`Gateway repay complete. status=${newStatus}`);

    return {
      success: true,
      internalLoanId: loan.internalLoanId,
      partnerName: loan.partnerName,
      repaymentAmount: dto.amount,
      remainingDebt: newRemainingDebt.toString(),
      status: newStatus,
      partnerRepayTxHash: partnerRepayHash,
      vaultRepayTxHash: vaultRepayResult.txHash,
      explorerLinks: {
        partnerRepay: `${this.getExplorerBase()}/tx/${partnerRepayHash}`,
        vaultRepay: `${this.getExplorerBase()}/tx/${vaultRepayResult.txHash}`,
      },
    };
  }
}
