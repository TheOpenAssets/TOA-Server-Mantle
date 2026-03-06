import { Controller, Post, Get, Body, UseGuards, Request, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PartnerGatewayService } from '../services/partner-gateway.service';
import { PartnerService } from '../services/partner.service';
import { GatewayBorrowDto, GatewayRepayDto } from '../dto/partner-gateway.dto';
import { PartnerStatus } from '@openassets/types';

@ApiTags('Partner Gateway')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('partners/gateway')
export class PartnerGatewayController {
  constructor(
    private readonly partnerGatewayService: PartnerGatewayService,
    private readonly partnerService: PartnerService,
  ) {}

  /**
   * GET /partners/gateway/list
   *
   * Public (JWT only) list of active partner protocols.
   * Returns only safe display fields — no API keys, no internal limits.
   */
  @Get('list')
  @ApiOperation({
    summary: 'List available partner protocols',
    description: 'Returns active partners with display-safe fields. No admin access required.',
  })
  @ApiQuery({ name: 'status', enum: PartnerStatus, required: false })
  @ApiResponse({
    status: 200,
    description: 'List of active partners',
    schema: {
      example: [
        {
          partnerId: 'partner_aave_5aceed8c',
          partnerName: 'Aave Demo',
          tier: 'PREMIUM',
          status: 'ACTIVE',
          contactEmail: 'demo@aave-test.com',
        },
      ],
    },
  })
  async listPartners(@Query('status') status?: PartnerStatus) {
    const filter = { status: status ?? PartnerStatus.ACTIVE };
    const partners = await this.partnerService.listPartners(filter);
    return partners.map((p) => ({
      partnerId: p.partnerId,
      partnerName: p.partnerName,
      tier: p.tier,
      status: p.status,
      contactEmail: p.contactEmail,
    }));
  }

  /**
   * POST /partners/gateway/borrow
   *
   * User borrows USDC via a partner protocol ("Aave Demo").
   * The user first calls SolvencyVault.borrowUSDC() directly from their wallet (user signs),
   * then passes the resulting vaultTxHash to this endpoint. The server records the loan
   * in the partner protocol via the platform wallet (recordLoan on-chain).
   *
   * Returns borrow tx hash, partner record tx hash,
   * plus credit score metadata showing the applied LTV boost.
   */
  @Post('borrow')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Borrow via partner protocol',
    description:
      'Records a partner loan after the user has already called SolvencyVault.borrowUSDC() directly on-chain. ' +
      'The frontend must perform the vault borrow (user signs) and pass the resulting vaultTxHash. ' +
      'Server then calls partnerContract.recordLoan() via the platform wallet. ' +
      'Returns two on-chain tx hashes with Creditcoin explorer links. ' +
      'User must have an active solvency position (deposited collateral).',
  })
  @ApiBody({ type: GatewayBorrowDto })
  @ApiResponse({
    status: 200,
    description: 'Loan disbursed successfully',
    schema: {
      example: {
        success: true,
        internalLoanId: 'uuid',
        partnerLoanId: 'aave_xxxxxxxx',
        partnerName: 'Aave Demo',
        principalAmount: '5000000000',
        borrowTxHash: '0xabc...',
        recordTxHash: '0xghi...',
        explorerLinks: {
          borrow: 'https://creditcoin-testnet.blockscout.com/tx/0xabc...',
          record: 'https://creditcoin-testnet.blockscout.com/tx/0xghi...',
        },
        creditBoost: {
          score: 720,
          tier: 'PREMIUM',
          appliedLtv: 8000,
          standardLtv: 7000,
          boosted: true,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'No active solvency position or borrow amount exceeds limit' })
  @ApiResponse({ status: 404, description: 'Partner not found or not active' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async borrow(@Request() req: any, @Body() dto: GatewayBorrowDto) {
    return this.partnerGatewayService.borrowViaPartner(req.user.walletAddress, dto);
  }

  /**
   * POST /partners/gateway/repay
   *
   * User repays their partner loan.
   * Calls MockPartnerProtocol.repay on-chain then SolvencyVault.repayLoan.
   * User never signs anything — all transactions execute via platform wallet.
   */
  @Post('repay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Repay a partner loan',
    description:
      'Executes partnerContract.repay → SolvencyVault.repayLoan. ' +
      'Returns two on-chain tx hashes with Creditcoin explorer links. ' +
      'Use internalLoanId from the borrow response or from GET /solvency/partner-loans/my.',
  })
  @ApiBody({ type: GatewayRepayDto })
  @ApiResponse({
    status: 200,
    description: 'Loan repaid successfully',
    schema: {
      example: {
        success: true,
        internalLoanId: 'uuid',
        partnerName: 'Aave Demo',
        repaymentAmount: '5000000000',
        remainingDebt: '0',
        status: 'REPAID',
        partnerRepayTxHash: '0xjkl...',
        vaultRepayTxHash: '0xmno...',
        explorerLinks: {
          partnerRepay: 'https://creditcoin-testnet.blockscout.com/tx/0xjkl...',
          vaultRepay: 'https://creditcoin-testnet.blockscout.com/tx/0xmno...',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Loan already repaid or repayment exceeds remaining debt' })
  @ApiResponse({ status: 404, description: 'Loan not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async repay(@Request() req: any, @Body() dto: GatewayRepayDto) {
    return this.partnerGatewayService.repayViaPartner(req.user.walletAddress, dto);
  }
}
