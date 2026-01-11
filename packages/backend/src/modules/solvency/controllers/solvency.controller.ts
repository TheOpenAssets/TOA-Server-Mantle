import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SolvencyBlockchainService } from '../services/solvency-blockchain.service';
import { SolvencyPositionService } from '../services/solvency-position.service';
import { PrivateAssetService } from '../services/private-asset.service';
import { DepositCollateralDto } from '../dto/deposit-collateral.dto';
import { BorrowDto } from '../dto/borrow.dto';
import { RepayDto } from '../dto/repay.dto';
import { WithdrawCollateralDto } from '../dto/withdraw-collateral.dto';
import { UploadPrivateAssetRequestDto } from '../dto/upload-private-asset-request.dto';
import { NotifyLoanBorrowDto } from '../dto/notify-loan-borrow.dto';
import { NotifyLoanRepaymentDto } from '../dto/notify-loan-repayment.dto';
import { PartnerLoanService } from '../../partners/services/partner-loan.service';

@Controller('solvency')
@UseGuards(JwtAuthGuard)
export class SolvencyController {
  constructor(
    private blockchainService: SolvencyBlockchainService,
    private positionService: SolvencyPositionService,
    private privateAssetService: PrivateAssetService,
    private partnerLoanService: PartnerLoanService,
  ) {}

  /**
   * Deposit collateral to create position
   */
  @Post('deposit')
  @HttpCode(HttpStatus.CREATED)
  async depositCollateral(@Request() req: any, @Body() dto: DepositCollateralDto) {
    const userAddress = req.user.walletAddress;

    // Auto-detect token type if not provided
    const tokenType = dto.tokenType || await this.positionService.determineTokenType(dto.collateralTokenAddress);

    // Deposit collateral on-chain
    const result = await this.blockchainService.depositCollateral(
      userAddress,
      dto.collateralTokenAddress,
      dto.collateralAmount,
      dto.tokenValueUSD,
      tokenType,
      dto.issueOAID || false,
    );

    // Create database record
    const position = await this.positionService.createPosition(
      result.positionId,
      userAddress,
      dto.collateralTokenAddress,
      tokenType,
      dto.collateralAmount,
      dto.tokenValueUSD,
      result.txHash,
      result.blockNumber,
      dto.issueOAID || false,
    );

    // Update private asset collateral tracking if applicable
    if (tokenType === 'PRIVATE_ASSET') {
      await this.privateAssetService.updateCollateralTracking(
        dto.collateralTokenAddress,
        dto.collateralAmount,
        '0',
        1,
      );
    }

    return {
      success: true,
      positionId: result.positionId,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      position,
    };
  }

  /**
   * Borrow USDC against collateral
   */
  @Post('borrow')
  @HttpCode(HttpStatus.OK)
  async borrowUSDC(@Request() req: any, @Body() dto: BorrowDto) {
    const userAddress = req.user.walletAddress;
    const positionId = parseInt(dto.positionId);

    // Verify position belongs to user
    const position = await this.positionService.getPosition(positionId);
    if (position.userAddress !== userAddress) {
      throw new Error('Not authorized to borrow from this position');
    }

    // Borrow on-chain
    const result = await this.blockchainService.borrowUSDC(
      positionId,
      dto.amount,
      dto.loanDuration,
      dto.numberOfInstallments,
    );

    // Update database
    const updatedPosition = await this.positionService.recordBorrow(
      positionId, 
      dto.amount,
      dto.loanDuration,
      dto.numberOfInstallments
    );

    // Update private asset debt tracking if applicable
    if (updatedPosition.collateralTokenType === 'PRIVATE_ASSET') {
      await this.privateAssetService.updateCollateralTracking(
        updatedPosition.collateralTokenAddress,
        '0',
        dto.amount,
        0,
      );
    }

    return {
      success: true,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      position: updatedPosition,
    };
  }

  /**
   * Repay loan
   */
  @Post('repay')
  @HttpCode(HttpStatus.OK)
  async repayLoan(@Request() req: any, @Body() dto: RepayDto) {
    const userAddress = req.user.walletAddress;
    const positionId = parseInt(dto.positionId);

    // Verify position belongs to user
    const position = await this.positionService.getPosition(positionId);
    if (position.userAddress !== userAddress) {
      throw new Error('Not authorized to repay this position');
    }

    // Repay on-chain
    const result = await this.blockchainService.repayLoan(positionId, dto.amount);

    // Update database
    const updatedPosition = await this.positionService.recordRepayment(
      positionId,
      dto.amount,
      result.principal,
    );

    // Update private asset debt tracking if applicable
    if (updatedPosition.collateralTokenType === 'PRIVATE_ASSET') {
      const debtChange = '-' + result.principal; // Negative for repayment
      await this.privateAssetService.updateCollateralTracking(
        updatedPosition.collateralTokenAddress,
        '0',
        debtChange,
        0,
      );
    }

    return {
      success: true,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      principal: result.principal,
      interest: result.interest,
      position: updatedPosition,
    };
  }

  /**
   * Withdraw collateral (after full repayment)
   */
  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  async withdrawCollateral(@Request() req: any, @Body() dto: WithdrawCollateralDto) {
    const userAddress = req.user.walletAddress;
    const positionId = parseInt(dto.positionId);

    // Verify position belongs to user
    const position = await this.positionService.getPosition(positionId);
    if (position.userAddress !== userAddress) {
      throw new Error('Not authorized to withdraw from this position');
    }

    // Withdraw on-chain
    const result = await this.blockchainService.withdrawCollateral(positionId, dto.amount);

    // Update database
    const updatedPosition = await this.positionService.recordWithdrawal(positionId, dto.amount);

    // Update private asset collateral tracking if applicable
    if (updatedPosition.collateralTokenType === 'PRIVATE_ASSET') {
      const collateralChange = '-' + dto.amount; // Negative for withdrawal
      const positionDelta = updatedPosition.status === 'CLOSED' ? -1 : 0;
      await this.privateAssetService.updateCollateralTracking(
        updatedPosition.collateralTokenAddress,
        collateralChange,
        '0',
        positionDelta,
      );
    }

    return {
      success: true,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      position: updatedPosition,
    };
  }

  /**
   * Sync on-chain position with backend database
   * Called after investor deposits collateral directly via contract
   */
  @Post('sync-position')
  @HttpCode(HttpStatus.CREATED)
  async syncPosition(@Request() req: any, @Body() dto: { positionId: string; txHash: string; blockNumber: number }) {
    const userAddress = req.user.walletAddress;

    if (!dto.positionId || !dto.txHash) {
      throw new BadRequestException('Missing required fields: positionId, txHash');
    }

    // Fetch position details from chain
    const positionId = parseInt(dto.positionId);
    const positionData = await this.blockchainService.getPositionFromChain(positionId);

    // Verify position belongs to user
    if (positionData.user.toLowerCase() !== userAddress.toLowerCase()) {
      throw new BadRequestException('Position does not belong to authenticated user');
    }

    // Use token type directly from blockchain (0 = RWA, 1 = PRIVATE_ASSET)
    const tokenType = positionData.tokenType === 0 ? 'RWA' : 'PRIVATE_ASSET';

    // Sync database record (update if exists, create if not)
    const position = await this.positionService.syncPosition(
      positionId,
      positionData.user,
      positionData.collateralToken,
      tokenType as any,
      positionData.collateralAmount.toString(),
      positionData.tokenValueUSD.toString(),
      dto.txHash,
      dto.blockNumber || 0,
      false, // OAID issuance tracked separately
    );

    return {
      success: true,
      message: 'Position synced with backend',
      position,
    };
  }

  /**
   * Get my positions
   */
  @Get('positions/my')
  async getMyPositions(@Request() req: any) {
    const userAddress = req.user.walletAddress;
    const positions = await this.positionService.getUserPositions(userAddress);

    return {
      success: true,
      count: positions.length,
      positions,
    };
  }

  /**
   * Get my active positions
   */
  @Get('positions/my/active')
  async getMyActivePositions(@Request() req: any) {
    const userAddress = req.user.walletAddress;
    const positions = await this.positionService.getUserActivePositions(userAddress);

    return {
      success: true,
      count: positions.length,
      positions,
    };
  }

  /**
   * Get position details
   */
  @Get('position/:id')
  async getPositionDetails(@Request() req: any, @Param('id') id: string) {
    const userAddress = req.user.walletAddress;
    const positionId = parseInt(id);

    const stats = await this.positionService.getPositionStats(positionId);

    // Verify position belongs to user
    if (stats.position.userAddress !== userAddress) {
      throw new Error('Not authorized to view this position');
    }

    return {
      success: true,
      ...stats,
    };
  }

  /**
   * Get repayment schedule for position
   */
  @Get('position/:id/schedule')
  async getRepaymentSchedule(@Request() req: any, @Param('id') id: string) {
    const userAddress = req.user.walletAddress;
    const positionId = parseInt(id);

    // Verify position belongs to user
    const position = await this.positionService.getPosition(positionId);
    if (position.userAddress !== userAddress) {
      throw new Error('Not authorized to view this position');
    }

    const schedule = await this.blockchainService.getRepaymentPlan(positionId);
    const outstandingDebt = await this.blockchainService.getOutstandingDebt(positionId);

    return {
      success: true,
      positionId,
      schedule: {
        ...schedule,
        details: position.repaymentSchedule, // Include the detailed array with times
      },
      outstandingDebt,
    };
  }

  /**
   * Get my OAID credit line details
   */
  @Get('oaid/my-credit')
  async getMyOAIDCredit(@Request() req: any) {
    const userAddress = req.user.walletAddress;

    const creditData = await this.blockchainService.getOAIDCreditLines(userAddress);

    return {
      success: true,
      userAddress,
      totalCreditLimit: creditData.totalCreditLimit,
      totalCreditUsed: creditData.totalCreditUsed,
      totalAvailableCredit: creditData.totalAvailableCredit,
      creditLines: creditData.creditLines,
      summary: {
        activeCreditLines: creditData.creditLines.filter(line => line.active).length,
        totalCreditLines: creditData.creditLines.length,
        utilizationRate: creditData.totalCreditLimit !== '0'
          ? ((Number(creditData.totalCreditUsed) / Number(creditData.totalCreditLimit)) * 100).toFixed(2) + '%'
          : '0%',
      },
    };
  }

  /**
   * Get available private assets
   */
  @Get('private-assets')
  async getPrivateAssets() {
    const assets = await this.privateAssetService.getAllPrivateAssets(undefined, true);

    return {
      success: true,
      count: assets.length,
      assets,
    };
  }

  /**
   * Get private asset details
   */
  @Get('private-asset/:id')
  async getPrivateAssetDetails(@Param('id') id: string) {
    const asset = await this.privateAssetService.getPrivateAsset(id);
    const valuationHistory = await this.privateAssetService.getValuationHistory(id);

    return {
      success: true,
      asset,
      valuationHistory,
    };
  }

  /**
   * Upload private asset request
   * User submits deed/bond/invoice for admin verification
   */
  @Post('private-asset/upload-request')
  @HttpCode(HttpStatus.CREATED)
  async uploadPrivateAssetRequest(
    @Request() req: any,
    @Body() dto: UploadPrivateAssetRequestDto,
  ) {
    const userAddress = req.user.walletAddress;
    const userRole = req.user.role; // INVESTOR or ORIGINATOR

    const request = await this.privateAssetService.createAssetRequest(
      userAddress,
      userRole,
      {
        name: dto.name,
        assetType: dto.assetType,
        location: dto.location,
        claimedValuation: dto.claimedValuation,
        documentHash: dto.documentHash,
        documentUrl: dto.documentUrl,
        description: dto.description,
        metadata: dto.metadata,
      },
    );

    return {
      success: true,
      message: 'Private asset request submitted for admin review',
      requestId: request.requestId,
      request: {
        requestId: request.requestId,
        name: request.name,
        assetType: request.assetType,
        claimedValuation: request.claimedValuation,
        status: request.status,
        createdAt: request.createdAt,
      },
    };
  }

  /**
   * Get my private asset requests
   */
  @Get('private-asset/my-requests')
  async getMyPrivateAssetRequests(@Request() req: any) {
    const userAddress = req.user.walletAddress;
    const requests = await this.privateAssetService.getUserRequests(userAddress);

    return {
      success: true,
      count: requests.length,
      requests,
    };
  }

  /**
   * Get private asset request details
   */
  @Get('private-asset/request/:id')
  async getPrivateAssetRequestDetails(@Request() req: any, @Param('id') id: string) {
    const request = await this.privateAssetService.getRequest(id);

    // Verify user owns this request
    if (request.requesterAddress !== req.user.walletAddress.toLowerCase()) {
      throw new Error('Not authorized to view this request');
    }

    return {
      success: true,
      request,
    };
  }

  /**
   * Repay partner loan directly from user portfolio
   * User provides approval for USDC and we execute the repayment
   */
  @Post('partner-loan/repay')
  @HttpCode(HttpStatus.OK)
  async repayPartnerLoan(
    @Request() req: any,
    @Body() dto: { internalLoanId: string; amount: string; approvalTxHash: string }
  ) {
    if (!dto.internalLoanId || !dto.amount || !dto.approvalTxHash) {
      throw new BadRequestException('Missing required fields: internalLoanId, amount, approvalTxHash');
    }

    // This endpoint allows users to repay loans originated by partners directly from our platform
    // User must have approved our platform wallet to spend their USDC
    // We verify the approval and then execute the repayment

    // Note: This is a simplified version. In production, you might want to:
    // 1. Verify the approval transaction
    // 2. Execute transfer from user to platform wallet
    // 3. Then call the partner loan repay logic

    return {
      success: false,
      message: 'Direct portfolio repayment coming soon. For now, please repay through the partner platform or contact support.',
      userAddress: req.user.walletAddress,
    };
  }

  /**
   * Get all partner loans for the user
   */
  @Get('partner-loans/my')
  async getMyPartnerLoans(@Request() req: any) {
    const userAddress = req.user.walletAddress;

    // Get all partner loans across all partners for this user
    const loans = await this.partnerLoanService.getAllUserLoans(userAddress);

    return {
      success: true,
      count: loans.length,
      loans,
    };
  }

  /**
   * Notify backend of a loan borrow transaction
   * Frontend calls this after user borrows directly via contract
   */
  @Post('loan/borrow-notify')
  @HttpCode(HttpStatus.OK)
  async notifyLoanBorrow(@Request() req: any, @Body() dto: NotifyLoanBorrowDto) {
    const userAddress = req.user.walletAddress;

    return this.positionService.notifyLoanBorrow(
      userAddress,
      parseInt(dto.positionId),
      dto.txHash,
      dto.borrowAmount,
      dto.loanDuration,
      dto.numberOfInstallments,
      dto.blockNumber,
    );
  }

  /**
   * Notify backend of a loan repayment transaction
   * Frontend calls this after user repays directly via contract
   */
  @Post('loan/repay-notify')
  @HttpCode(HttpStatus.OK)
  async notifyLoanRepayment(@Request() req: any, @Body() dto: NotifyLoanRepaymentDto) {
    const userAddress = req.user.walletAddress;

    return this.positionService.notifyLoanRepayment(
      userAddress,
      parseInt(dto.positionId),
      dto.txHash,
      dto.repaymentAmount,
      dto.blockNumber,
    );
  }
}
