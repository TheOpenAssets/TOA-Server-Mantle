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
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SolvencyBlockchainService } from '../services/solvency-blockchain.service';
import { SolvencyPositionService } from '../services/solvency-position.service';
import { PrivateAssetService } from '../services/private-asset.service';
import { DepositCollateralDto } from '../dto/deposit-collateral.dto';
import { BorrowDto } from '../dto/borrow.dto';
import { RepayDto } from '../dto/repay.dto';
import { WithdrawCollateralDto } from '../dto/withdraw-collateral.dto';

@Controller('solvency')
@UseGuards(JwtAuthGuard)
export class SolvencyController {
  constructor(
    private blockchainService: SolvencyBlockchainService,
    private positionService: SolvencyPositionService,
    private privateAssetService: PrivateAssetService,
  ) {}

  /**
   * Deposit collateral to create position
   */
  @Post('deposit')
  @HttpCode(HttpStatus.CREATED)
  async depositCollateral(@Request() req: any, @Body() dto: DepositCollateralDto) {
    const userAddress = req.user.walletAddress;

    // Deposit collateral on-chain
    const result = await this.blockchainService.depositCollateral(
      userAddress,
      dto.collateralTokenAddress,
      dto.collateralAmount,
      dto.tokenValueUSD,
      dto.tokenType,
      dto.issueOAID || false,
    );

    // Create database record
    const position = await this.positionService.createPosition(
      result.positionId,
      userAddress,
      dto.collateralTokenAddress,
      dto.tokenType,
      dto.collateralAmount,
      dto.tokenValueUSD,
      result.txHash,
      result.blockNumber,
      dto.issueOAID || false,
    );

    // Update private asset collateral tracking if applicable
    if (dto.tokenType === 'PRIVATE_ASSET') {
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
    const result = await this.blockchainService.borrowUSDC(positionId, dto.amount);

    // Update database
    const updatedPosition = await this.positionService.recordBorrow(positionId, dto.amount);

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
}
