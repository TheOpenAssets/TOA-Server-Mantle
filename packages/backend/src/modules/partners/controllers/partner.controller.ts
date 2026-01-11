import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { PartnerLoanService } from '../services/partner-loan.service';
import { PartnerApiKeyGuard } from '../guards/partner-api-key.guard';
import { PartnerBorrowDto, PartnerRepayDto, PartnerRepayWithTransferDto } from '../dto/partner-loan.dto';
import { PartnerLoanStatus } from '../../../database/schemas/partner-loan.schema';
import { SolvencyBlockchainService } from '../../solvency/services/solvency-blockchain.service';

@ApiTags('Partners')
@Controller('partners')
export class PartnerController {
  constructor(
    private readonly partnerLoanService: PartnerLoanService,
    private readonly solvencyBlockchainService: SolvencyBlockchainService,
  ) {}

  // ═══════════════════════════════════════════════════════
  // PUBLIC ENDPOINTS (No Auth)
  // ═══════════════════════════════════════════════════════

  @Get('public/oaid/:oaidTokenId/credit-line')
  @ApiOperation({ summary: 'Get OAID credit line details (Public)' })
  @ApiParam({ name: 'oaidTokenId', type: 'number' })
  async getCreditLine(@Param('oaidTokenId') oaidTokenId: string) {
    // This doesn't strictly need the user wallet if we just want to check the line by ID
    // but getOAIDCreditLines requires a userAddress.
    // However, we can use the SolvencyBlockchainService to get details for a specific credit line ID
    // We'll need to know which user it belongs to, or use a general view function if available.
    
    // For now, let's assume we need to know the user wallet to check their credit lines
    // Alternatively, we could add a getCreditLine(tokenId) to SolvencyBlockchainService
    return {
      message: 'This endpoint requires knowledge of the user wallet for now. Use on-chain view functions directly or provide user wallet in query.',
    };
  }

  @Get('public/position/:positionId/details')
  @ApiOperation({ summary: 'Get position details (Public)' })
  @ApiParam({ name: 'positionId', type: 'number' })
  async getPositionDetails(@Param('positionId') positionId: string) {
    return this.solvencyBlockchainService.getPosition(Number(positionId));
  }

  // ═══════════════════════════════════════════════════════
  // AUTHENTICATED ENDPOINTS (Partner API Key)
  // ═══════════════════════════════════════════════════════

  @Post('borrow')
  @UseGuards(PartnerApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Borrow USDC on behalf of a user' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Loan successfully processed' })
  async borrow(@Req() req: any, @Body() borrowDto: PartnerBorrowDto) {
    return this.partnerLoanService.borrow(req.partner, borrowDto);
  }

  @Post('repay')
  @UseGuards(PartnerApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Repay a loan (platform wallet must have USDC)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Repayment successfully processed' })
  async repay(@Req() req: any, @Body() repayDto: PartnerRepayDto) {
    return this.partnerLoanService.repay(req.partner, repayDto);
  }

  @Post('repay-with-transfer')
  @UseGuards(PartnerApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Repay a loan with user USDC transfer',
    description: 'User sends USDC to platform wallet, partner provides tx hash for verification. This is the recommended method for partner integrations.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Repayment successfully processed with transfer verification' })
  async repayWithTransfer(@Req() req: any, @Body() repayDto: PartnerRepayWithTransferDto) {
    return this.partnerLoanService.repayWithTransfer(req.partner, repayDto);
  }

  @Get('loan/:partnerLoanId')
  @UseGuards(PartnerApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get loan details' })
  @ApiParam({ name: 'partnerLoanId', type: 'string' })
  async getLoan(@Req() req: any, @Param('partnerLoanId') partnerLoanId: string) {
    return this.partnerLoanService.getLoanDetails(req.partner, partnerLoanId);
  }

  @Get('user/:userWallet/loans')
  @UseGuards(PartnerApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all loans for a user through this partner' })
  @ApiParam({ name: 'userWallet', type: 'string' })
  @ApiQuery({ name: 'status', enum: PartnerLoanStatus, required: false })
  async getUserLoans(
    @Req() req: any,
    @Param('userWallet') userWallet: string,
    @Query('status') status?: PartnerLoanStatus,
  ) {
    return this.partnerLoanService.getUserLoans(req.partner, userWallet, status);
  }

  @Get('my/stats')
  @UseGuards(PartnerApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get partner statistics' })
  async getMyStats(@Req() req: any) {
    return this.partnerLoanService.getPartnerStats(req.partner);
  }
}
