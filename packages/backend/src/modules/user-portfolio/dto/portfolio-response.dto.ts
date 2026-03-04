import { ApiProperty } from '@nestjs/swagger';

export class PortfolioSummaryDto {
  @ApiProperty({ description: 'The wallet address of the portfolio owner' })
  walletAddress!: string;

  @ApiProperty({ description: 'Formatted total USDC invested', example: '$12,500.00' })
  totalUSDCInvested!: string;

  @ApiProperty({ description: 'Formatted total yield received', example: '$750.00' })
  totalYieldReceived!: string;

  @ApiProperty({ description: 'Count of active positions' })
  totalActivePositions!: number;

  @ApiProperty({ description: 'Count of completed positions' })
  totalCompletedPositions!: number;

  @ApiProperty({ description: 'List of networks where the user has holdings' })
  networks!: string[];

  @ApiProperty({ description: 'Timestamp of the last update' })
  lastUpdated!: Date;
}

export class RecentActivityDto {
  @ApiProperty({ description: 'Transaction hash' })
  txHash!: string;

  @ApiProperty({ description: 'Human-readable label for the transaction type' })
  label!: string;

  @ApiProperty({ description: 'The asset ID associated with the transaction' })
  assetId!: string;

  @ApiProperty({ description: 'The amount involved in the transaction' })
  amount!: string;

  @ApiProperty({ description: 'Transaction timestamp' })
  timestamp!: Date;
}

export class RuntimeHoldingDto {
  @ApiProperty({ description: 'Asset UUID' })
  assetId!: string;

  @ApiProperty({ description: 'Enriched asset metadata (invoice info, industry, etc.)' })
  assetMetadata!: any;

  @ApiProperty({ description: 'Token address or Stellar asset string' })
  tokenIdentifier!: string;

  @ApiProperty({ description: 'Network where the holding exists' })
  network!: string;

  @ApiProperty({ description: 'Type of holding (STATIC, LEVERAGE, SOLVENCY)' })
  holdingType!: string;

  @ApiProperty({ description: 'Status of the holding' })
  status!: string;

  @ApiProperty({ description: 'Raw token balance (18 decimals)' })
  tokenBalance!: string;

  @ApiProperty({ description: 'Formatted token balance', example: '1,250.00 tokens' })
  tokenBalanceFormatted!: string;

  @ApiProperty({ description: 'Raw total invested USDC (6 decimals)' })
  totalInvested!: string;

  @ApiProperty({ description: 'Formatted total invested USDC', example: '$1,250.00 USDC' })
  totalInvestedFormatted!: string;

  @ApiProperty({ description: 'Domain-specific details (purchase history, leverage metrics, or solvency schedule)' })
  details!: any;
}

export class PortfolioResponseDto {
  @ApiProperty({ type: PortfolioSummaryDto })
  summary!: PortfolioSummaryDto;

  @ApiProperty({ type: [RuntimeHoldingDto] })
  holdings!: RuntimeHoldingDto[];

  @ApiProperty({ type: [RecentActivityDto] })
  activityFeed!: RecentActivityDto[];

  @ApiProperty({ description: 'The active network context for this response' })
  networkContext!: string;
}
