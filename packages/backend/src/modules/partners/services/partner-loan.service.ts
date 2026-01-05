import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import {
  PartnerLoan,
  PartnerLoanDocument,
  PartnerLoanStatus,
  RepaymentSource,
} from '../../../database/schemas/partner-loan.schema';
import { Partner, PartnerDocument } from '../../../database/schemas/partner.schema';
import { PartnerApiLog, PartnerApiLogDocument } from '../../../database/schemas/partner-api-log.schema';
import { SolvencyPositionService } from '../../solvency/services/solvency-position.service';
import { SolvencyBlockchainService } from '../../solvency/services/solvency-blockchain.service';
import { PartnerService } from './partner.service';
import { PartnerBorrowDto, PartnerRepayDto } from '../dto/partner-loan.dto';
import { WalletService } from '../../blockchain/services/wallet.service';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { Address, createPublicClient, http, PublicClient } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';

@Injectable()
export class PartnerLoanService {
  private readonly logger = new Logger(PartnerLoanService.name);
  private publicClient: PublicClient;

  constructor(
    @InjectModel(PartnerLoan.name) private partnerLoanModel: Model<PartnerLoanDocument>,
    @InjectModel(Partner.name) private partnerModel: Model<PartnerDocument>,
    @InjectModel(PartnerApiLog.name) private partnerApiLogModel: Model<PartnerApiLogDocument>,
    private solvencyPositionService: SolvencyPositionService,
    private solvencyBlockchainService: SolvencyBlockchainService,
    private partnerService: PartnerService,
    private configService: ConfigService,
    private walletService: WalletService,
    private contractLoader: ContractLoaderService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  async borrow(partner: PartnerDocument, borrowDto: PartnerBorrowDto) {
    this.logger.log(`Partner ${partner.partnerName} borrowing ${borrowDto.borrowAmount} for user ${borrowDto.userWallet}`);

    // 1. Validation
    // 1a. Check for duplicate loan ID
    const existingLoan = await this.partnerLoanModel.findOne({
      partnerId: partner.partnerId,
      partnerLoanId: borrowDto.partnerLoanId,
    });
    if (existingLoan) {
      throw new ConflictException('Partner loan ID already exists');
    }

    // 1b. Verify user owns the OAID (on-chain)
    const creditLines = await this.solvencyBlockchainService.getOAIDCreditLines(borrowDto.userWallet);
    const creditLine = creditLines.creditLines.find(l => l.creditLineId === borrowDto.oaidTokenId);

    if (!creditLine) {
      throw new NotFoundException('OAID credit line not found for this user');
    }

    if (!creditLine.active) {
      throw new BadRequestException('OAID credit line is not active');
    }

    // 1c. Check available credit
    const availableCredit = BigInt(creditLine.availableCredit);
    if (BigInt(borrowDto.borrowAmount) > availableCredit) {
      throw new BadRequestException(`Insufficient credit. Available: ${availableCredit.toString()}`);
    }

    // 1d. Check partner limits
    const totalRemaining = BigInt(partner.totalBorrowLimit) - BigInt(partner.currentOutstanding);
    if (BigInt(borrowDto.borrowAmount) > totalRemaining) {
      throw new ForbiddenException(`Partner total limit exceeded. Remaining: ${totalRemaining.toString()}`);
    }

    // ═══════════════════════════════════════════════════════
    // STEP 2: FIND BACKING POSITION
    // ═══════════════════════════════════════════════════════
    const position = await this.solvencyPositionService.findActivePositionByOAID(
      borrowDto.userWallet,
      borrowDto.oaidTokenId
    );
    if (!position) {
      throw new BadRequestException('No active collateral position found for this OAID in backend');
    }

    // ═══════════════════════════════════════════════════════
    // STEP 3: EXECUTE ON-CHAIN BORROW
    // ═══════════════════════════════════════════════════════
    const borrowResult = await this.solvencyBlockchainService.borrowUSDC(
      position.positionId,
      borrowDto.borrowAmount
    );

    // ═══════════════════════════════════════════════════════
    // STEP 4: CALCULATE AND TRANSFER USDC TO PARTNER
    // ═══════════════════════════════════════════════════════
    const platformWallet = this.walletService.getPlatformWallet();
    const usdcAddress = this.contractLoader.getContractAddress('USDC');
    const usdcAbi = this.contractLoader.getContractAbi('USDC');

    // Deduct platform fee
    const feeAmount = (BigInt(borrowDto.borrowAmount) * BigInt(partner.platformFeePercentage)) / BigInt(10000);
    const netAmount = BigInt(borrowDto.borrowAmount) - feeAmount;

    this.logger.log(`Transferring ${netAmount.toString()} USDC to partner ${partner.settlementAddress} (Fee: ${feeAmount.toString()})`);

    const transferHash = await platformWallet.writeContract({
      address: usdcAddress as Address,
      abi: usdcAbi,
      functionName: 'transfer',
      args: [partner.settlementAddress as Address, netAmount],
    });

    await this.publicClient.waitForTransactionReceipt({ hash: transferHash });

    // ═══════════════════════════════════════════════════════
    // STEP 5: CREATE DATABASE RECORDS
    // ═══════════════════════════════════════════════════════
    const internalLoanId = uuidv4();

    const partnerLoan = await this.partnerLoanModel.create({
      partnerLoanId: borrowDto.partnerLoanId,
      internalLoanId,
      partnerId: partner.partnerId,
      partnerName: partner.partnerName,
      userWallet: borrowDto.userWallet,
      oaidTokenId: borrowDto.oaidTokenId,
      solvencyPositionId: position.positionId,
      principalAmount: borrowDto.borrowAmount,
      remainingDebt: borrowDto.borrowAmount,
      interestRate: 0, // Should fetch from SeniorPool if possible
      borrowedAt: new Date(),
      totalRepaid: '0',
      repaymentHistory: [],
      status: PartnerLoanStatus.ACTIVE,
      borrowTxHash: borrowResult.txHash,
      platformFeeCharged: feeAmount.toString(),
      platformFeePaid: true,
      metadata: borrowDto.metadata,
    });

    // ═══════════════════════════════════════════════════════
    // STEP 6: UPDATE POSITION & PARTNER STATS
    // ═══════════════════════════════════════════════════════
    await this.solvencyPositionService.recordBorrow(position.positionId, borrowDto.borrowAmount);
    await this.solvencyPositionService.addPartnerLoan(position._id.toString(), {
      partnerId: partner.partnerId,
      partnerLoanId: internalLoanId,
      borrowedAmount: borrowDto.borrowAmount,
      active: true,
    });

    await this.partnerService.updateStats(partner.partnerId, BigInt(borrowDto.borrowAmount), 0n);

    // ═══════════════════════════════════════════════════════
    // STEP 7: LOG OPERATION
    // ═══════════════════════════════════════════════════════
    await this.logApiCall(partner, 'POST /partners/borrow', {
      userWallet: borrowDto.userWallet,
      oaidTokenId: borrowDto.oaidTokenId,
      amount: borrowDto.borrowAmount,
      success: true,
      loanId: internalLoanId,
      statusCode: 201,
      responseTime: 0, // TODO: calculate
    });

    return {
      success: true,
      internalLoanId,
      borrowedAmount: borrowDto.borrowAmount,
      netAmountTransferred: netAmount.toString(),
      platformFee: feeAmount.toString(),
      remainingCredit: (availableCredit - BigInt(borrowDto.borrowAmount)).toString(),
      txHash: borrowResult.txHash,
      message: 'Loan successfully processed',
    };
  }

  async repay(partner: PartnerDocument, repayDto: PartnerRepayDto) {
    this.logger.log(`Partner ${partner.partnerName} repaying ${repayDto.repaymentAmount} for loan ${repayDto.partnerLoanId}`);

    // 1. Find loan
    const loan = await this.partnerLoanModel.findOne({
      partnerId: partner.partnerId,
      partnerLoanId: repayDto.partnerLoanId,
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    if (loan.status === PartnerLoanStatus.REPAID) {
      throw new BadRequestException('Loan already fully repaid');
    }

    // 2. Validate repayment amount
    const repayAmount = BigInt(repayDto.repaymentAmount);
    const remainingDebt = BigInt(loan.remainingDebt);

    if (repayAmount > remainingDebt) {
      throw new BadRequestException(`Repayment exceeds remaining debt of ${remainingDebt.toString()}`);
    }

    // 3. Execute on-chain repayment
    // The partner platform is expected to have sent USDC to our settlement address or platform wallet
    // For now we assume the platform wallet has the USDC to execute the repayment
    const repayResult = await this.solvencyBlockchainService.repayLoan(
      loan.solvencyPositionId,
      repayDto.repaymentAmount
    );

    // 4. Update loan record
    const newRemainingDebt = remainingDebt - repayAmount;
    const newStatus = newRemainingDebt === 0n ? PartnerLoanStatus.REPAID : PartnerLoanStatus.ACTIVE;

    loan.remainingDebt = newRemainingDebt.toString();
    loan.totalRepaid = (BigInt(loan.totalRepaid) + repayAmount).toString();
    loan.lastRepaymentAt = new Date();
    loan.status = newStatus;
    loan.repayTxHash = repayResult.txHash;
    loan.repaymentHistory.push({
      amount: repayDto.repaymentAmount,
      timestamp: new Date(),
      txHash: repayResult.txHash,
      repaidBy: RepaymentSource.PARTNER,
    });

    await loan.save();

    // 5. Update position & partner stats
    await this.solvencyPositionService.recordRepayment(
      loan.solvencyPositionId,
      repayDto.repaymentAmount,
      repayResult.principal
    );

    if (newStatus === PartnerLoanStatus.REPAID) {
      await this.solvencyPositionService.markPartnerLoanRepaid(
        loan.solvencyPositionId,
        loan.internalLoanId
      );
    }

    await this.partnerService.updateStats(partner.partnerId, 0n, repayAmount);

    // 6. Log operation
    await this.logApiCall(partner, 'POST /partners/repay', {
      loanId: loan.partnerLoanId,
      amount: repayDto.repaymentAmount,
      success: true,
      statusCode: 200,
      responseTime: 0,
    });

    return {
      success: true,
      remainingDebt: newRemainingDebt.toString(),
      loanStatus: newStatus,
      txHash: repayResult.txHash,
      message: newStatus === PartnerLoanStatus.REPAID ? 'Loan fully repaid' : 'Partial repayment processed',
    };
  }

  async getLoanDetails(partner: PartnerDocument, partnerLoanId: string) {
    const loan = await this.partnerLoanModel.findOne({
      partnerId: partner.partnerId,
      partnerLoanId,
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    return loan;
  }

  async getUserLoans(partner: PartnerDocument, userWallet: string, status?: PartnerLoanStatus) {
    const query: any = {
      partnerId: partner.partnerId,
      userWallet,
    };

    if (status) {
      query.status = status;
    }

    return this.partnerLoanModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async getPartnerStats(partner: PartnerDocument) {
    return {
      partnerId: partner.partnerId,
      partnerName: partner.partnerName,
      tier: partner.tier,
      status: partner.status,
      limits: {
        dailyBorrowLimit: partner.dailyBorrowLimit,
        totalBorrowLimit: partner.totalBorrowLimit,
        currentOutstanding: partner.currentOutstanding,
      },
      lifetime: {
        totalBorrowed: partner.totalBorrowed,
        totalRepaid: partner.totalRepaid,
      },
    };
  }

  private async logApiCall(partner: PartnerDocument, endpoint: string, data: any) {
    await this.partnerApiLogModel.create({
      partnerId: partner.partnerId,
      partnerName: partner.partnerName,
      endpoint,
      method: data.method || 'POST',
      ipAddress: '0.0.0.0', // TODO: get from request
      statusCode: data.statusCode,
      responseTime: data.responseTime,
      success: data.success,
      userWallet: data.userWallet,
      oaidTokenId: data.oaidTokenId,
      loanId: data.loanId,
      timestamp: new Date(),
      requestPayload: data.payload,
    });
  }
}
