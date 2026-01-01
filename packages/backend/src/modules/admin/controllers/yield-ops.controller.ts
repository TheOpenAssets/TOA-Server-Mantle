import { Controller, Post, Body, UseGuards, Get, Param, Logger } from '@nestjs/common';
import { YieldDistributionService } from '../../yield/services/yield-distribution.service';
import { RecordSettlementDto, ConfirmUSDCDto, DistributeDto } from '../../yield/dto/yield-ops.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { LeverageBlockchainService } from '../../leverage/services/leverage-blockchain.service';
import { LeveragePositionService } from '../../leverage/services/leverage-position.service';
import { ClaimYieldFromBurnDto, ProcessSettlementDto } from '../../leverage/dto/leverage.dto';

@Controller('admin/yield')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class YieldOpsController {
  private readonly logger = new Logger(YieldOpsController.name);

  constructor(
    private readonly yieldDistributionService: YieldDistributionService,
    private readonly leverageBlockchainService: LeverageBlockchainService,
    private readonly leveragePositionService: LeveragePositionService,
  ) {}

  @Post('settlement')
  async recordSettlement(@Body() dto: RecordSettlementDto) {
    return this.yieldDistributionService.recordSettlement(dto);
  }

  @Post('confirm-usdc')
  async confirmUSDC(@Body() dto: ConfirmUSDCDto) {
    return this.yieldDistributionService.confirmUSDCConversion(dto.settlementId, dto.usdcAmount);
  }

  @Post('distribute')
  async distribute(@Body() dto: DistributeDto) {
    return this.yieldDistributionService.distributeYield(dto.settlementId);
  }

  /**
   * POST /admin/yield/leverage/:positionId/claim-yield
   * Claim yield by burning RWA tokens held by LeverageVault
   */
  @Post('leverage/:positionId/claim-yield')
  async claimYieldFromBurn(
    @Param('positionId') positionId: string,
    @Body() dto: ClaimYieldFromBurnDto,
  ) {
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log(`🔥 Claim Yield From Burn - Position ${positionId}`);
    this.logger.log(`Token Amount to Burn: ${dto.tokenAmount}`);
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      const tokenAmount = BigInt(dto.tokenAmount);
      const positionIdNum = parseInt(positionId);

      // Get current position
      const position = await this.leveragePositionService.getPosition(positionIdNum);
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      this.logger.log(`📊 Position: ${position.assetId} (User: ${position.userAddress})`);

      // Call blockchain service to burn tokens and claim USDC
      this.logger.log(`🔗 Calling LeverageVault.claimYieldFromBurn()...`);
      const result = await this.leverageBlockchainService.claimYieldFromBurn(
        positionIdNum,
        tokenAmount,
      );

      this.logger.log(`✅ Transaction successful: ${result.hash}`);
      this.logger.log(`🔥 Tokens Burned: ${Number(result.tokensBurned) / 1e18} RWA`);
      this.logger.log(`💰 USDC Received: ${Number(result.usdcReceived) / 1e6} USDC`);

      // Update position record
      await this.leveragePositionService.recordYieldClaim(positionIdNum, {
        tokensBurned: result.tokensBurned.toString(),
        usdcReceived: result.usdcReceived.toString(),
        transactionHash: result.hash,
      });

      this.logger.log(`✅ Yield claim completed successfully!`);
      this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      return {
        success: true,
        transactionHash: result.hash,
        tokensBurned: result.tokensBurned.toString(),
        usdcReceived: result.usdcReceived.toString(),
        message: 'Yield claimed successfully via token burn',
      };
    } catch (error) {
      this.logger.error(`❌ Claim yield from burn failed: ${error}`);
      this.logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      throw error;
    }
  }

  /**
   * POST /admin/yield/leverage/:positionId/settle
   * Process settlement waterfall for leverage position
   */
  @Post('leverage/:positionId/settle')
  async processSettlement(
    @Param('positionId') positionId: string,
    @Body() dto: ProcessSettlementDto,
  ) {
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log(`💰 Process Settlement Waterfall - Position ${positionId}`);
    this.logger.log(`Settlement USDC: ${Number(BigInt(dto.settlementUSDC)) / 1e6} USDC`);
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      const settlementUSDC = BigInt(dto.settlementUSDC);
      const positionIdNum = parseInt(positionId);

      // Get current position
      const position = await this.leveragePositionService.getPosition(positionIdNum);
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      this.logger.log(`📊 Position: ${position.assetId} (User: ${position.userAddress})`);

      // Get outstanding debt to show waterfall breakdown
      const outstandingDebt = await this.leverageBlockchainService.getOutstandingDebt(positionIdNum);
      this.logger.log(`💸 Outstanding Debt: ${Number(outstandingDebt) / 1e6} USDC`);

      // Call blockchain service to process settlement waterfall
      this.logger.log(`🔗 Calling LeverageVault.processSettlement()...`);
      const result = await this.leverageBlockchainService.processSettlement(
        positionIdNum,
        settlementUSDC,
      );

      this.logger.log(`✅ Transaction successful: ${result.hash}`);
      this.logger.log(`━━━━━━━━━━━━━━ Settlement Waterfall ━━━━━━━━━━━━━━━`);
      this.logger.log(`💰 Total Settlement: ${Number(settlementUSDC) / 1e6} USDC`);
      this.logger.log(`1️⃣ Senior Pool Repayment: ${Number(result.seniorRepayment) / 1e6} USDC`);
      this.logger.log(`2️⃣ Interest Payment: ${Number(result.interestRepayment) / 1e6} USDC`);
      this.logger.log(`3️⃣ User Yield (Pushed): ${Number(result.userYield) / 1e6} USDC`);
      this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      // Update position record as settled
      await this.leveragePositionService.recordSettlement(positionIdNum, {
        settlementUSDC: settlementUSDC.toString(),
        seniorRepayment: result.seniorRepayment.toString(),
        interestRepayment: result.interestRepayment.toString(),
        userYield: result.userYield.toString(),
        transactionHash: result.hash,
      });

      this.logger.log(`✅ Settlement completed successfully!`);
      this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      return {
        success: true,
        transactionHash: result.hash,
        waterfall: {
          totalSettlement: settlementUSDC.toString(),
          seniorRepayment: result.seniorRepayment.toString(),
          interestRepayment: result.interestRepayment.toString(),
          userYield: result.userYield.toString(),
        },
        message: 'Settlement waterfall processed successfully - user yield pushed to wallet',
      };
    } catch (error) {
      this.logger.error(`❌ Settlement processing failed: ${error}`);
      this.logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      throw error;
    }
  }
}
