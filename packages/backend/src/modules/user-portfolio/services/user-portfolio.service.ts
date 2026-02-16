import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserPortfolio, UserPortfolioDocument, HoldingType, HoldingStatus } from '../schemas/user-portfolio.schema';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Settlement, SettlementDocument } from '../../../database/schemas/settlement.schema';
import { UserYieldClaim, UserYieldClaimDocument } from '../../../database/schemas/user-yield-claim.schema';
import { LeveragePosition } from '../../../database/schemas/leverage-position.schema';
import { SolvencyPosition } from '../../../database/schemas/solvency-position.schema';
import { PortfolioResponseDto, RuntimeHoldingDto, RecentActivityDto, PortfolioSummaryDto } from '../dto/portfolio-response.dto';

@Injectable()
export class UserPortfolioService {
  private readonly logger = new Logger(UserPortfolioService.name);

  constructor(
    @InjectModel(UserPortfolio.name) private portfolioModel: Model<UserPortfolioDocument>,
    @InjectModel(Purchase.name) private purchaseModel: Model<PurchaseDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Settlement.name) private settlementModel: Model<SettlementDocument>,
    @InjectModel(UserYieldClaim.name) private yieldClaimModel: Model<UserYieldClaimDocument>,
    @InjectModel(LeveragePosition.name) private leveragePositionModel: Model<any>,
    @InjectModel(SolvencyPosition.name) private solvencyPositionModel: Model<any>,
  ) {}

  /**
   * Get full enriched portfolio for a user
   */
  async getPortfolio(walletAddress: string, network: string): Promise<PortfolioResponseDto> {
    const investorWallet = walletAddress.toLowerCase();
    let portfolio = await this.portfolioModel.findOne({ walletAddress: investorWallet, network });

    if (!portfolio) {
      // Return an empty portfolio structure if none exists yet
      return {
        summary: {
          walletAddress: investorWallet,
          totalUSDCInvested: '$0.00',
          totalYieldReceived: '$0.00',
          totalActivePositions: 0,
          totalCompletedPositions: 0,
          networks: [network],
          lastUpdated: new Date(),
        },
        holdings: [],
        activityFeed: [],
        networkContext: network,
      };
    }

    // 1. Batch fetch all referenced assets
    const assetIds = portfolio.holdings.map(h => h.assetId);
    const assets = await this.assetModel.find({ assetId: { $in: assetIds } });
    const assetMap = new Map(assets.map(a => [a.assetId, a]));

    // 2. Batch fetch all referenced settlements
    const settlements = await this.settlementModel.find({ assetId: { $in: assetIds } }).sort({ createdAt: -1 });
    const settlementMap = new Map(settlements.map(s => [s.assetId, s]));

    // 3. Enrich holdings
    const enrichedHoldings = await Promise.all(
      portfolio.holdings.map(async (holding) => {
        const asset = assetMap.get(holding.assetId);
        const settlement = settlementMap.get(holding.assetId);
        
        const runtimeHolding = new RuntimeHoldingDto();
        runtimeHolding.assetId = holding.assetId;
        runtimeHolding.tokenIdentifier = holding.tokenIdentifier;
        runtimeHolding.network = holding.network;
        runtimeHolding.holdingType = holding.holdingType;
        runtimeHolding.status = holding.status;
        runtimeHolding.tokenBalance = holding.tokenBalance;
        runtimeHolding.tokenBalanceFormatted = `${(Number(holding.tokenBalance) / 1e18).toFixed(2)} tokens`;
        runtimeHolding.totalInvested = holding.totalInvested;
        runtimeHolding.totalInvestedFormatted = `$${(Number(holding.totalInvested) / 1e6).toFixed(2)} USDC`;
        
        runtimeHolding.assetMetadata = asset ? {
          assetName: `${asset.metadata?.invoiceNumber || 'N/A'} - ${asset.metadata?.buyerName || 'N/A'}`,
          industry: asset.metadata?.industry,
          riskTier: asset.metadata?.riskTier,
          assetType: asset.metadata?.type,
        } : {};

        // Domain specific enrichment
        if (holding.holdingType === HoldingType.STATIC) {
          runtimeHolding.details = await this.enrichStaticHolding(holding, asset, settlement, investorWallet);
          // Update status based on settlement if ACTIVE
          if (runtimeHolding.status === HoldingStatus.ACTIVE && settlement) {
             runtimeHolding.status = HoldingStatus.YIELD_CLAIMABLE;
          }
        } else if (holding.holdingType === HoldingType.LEVERAGE) {
          runtimeHolding.details = await this.enrichLeverageHolding(holding);
        } else if (holding.holdingType === HoldingType.SOLVENCY) {
          runtimeHolding.details = await this.enrichSolvencyHolding(holding);
        }

        return runtimeHolding;
      })
    );

    return {
      summary: {
        walletAddress: portfolio.walletAddress,
        totalUSDCInvested: `$${(Number(portfolio.totals.totalUSDCInvested) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        totalYieldReceived: `$${(Number(portfolio.totals.totalYieldReceived) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        totalActivePositions: portfolio.totals.totalActivePositions,
        totalCompletedPositions: portfolio.totals.totalCompletedPositions,
        networks: portfolio.totals.networks,
        lastUpdated: portfolio.lastUpdated,
      },
      holdings: enrichedHoldings,
      activityFeed: portfolio.recentActivity.map(act => ({
        txHash: act.txHash,
        label: this.getActivityLabel(act.source, BigInt(act.amount)),
        assetId: act.assetId,
        amount: act.amount,
        timestamp: act.timestamp,
      })),
      networkContext: network,
    };
  }

  private async enrichStaticHolding(holding: any, asset: any, settlement: any, investorWallet: string) {
    const purchases = await this.purchaseModel.find({ _id: { $in: holding.purchaseIds } }).sort({ createdAt: 1 });
    
    // Running balance calculation (from original PurchaseTrackerService)
    let runningTokens = 0n;
    let runningInvestment = 0n;

    const history = purchases.map(p => {
      const amount = BigInt(p.amount);
      const totalPayment = BigInt(p.totalPayment);
      
      let investmentDelta = 0n;
      if (p.source === 'PRIMARY_MARKET' || p.source === 'AUCTION') {
        investmentDelta = totalPayment;
      } else if (p.source === 'SECONDARY_MARKET') {
        investmentDelta = amount < 0n ? -totalPayment : totalPayment;
      } else if (p.source === 'P2P_ORDER_CANCELLED') {
        investmentDelta = -totalPayment;
      }

      runningTokens += amount;
      runningInvestment += investmentDelta;

      return {
        date: p.createdAt,
        type: p.source,
        amount: p.amount,
        amountFormatted: `${(Number(amount) / 1e18).toFixed(2)} tokens`,
        price: p.price,
        priceFormatted: `$${(Number(p.price) / 1e6).toFixed(2)}`,
        totalValue: p.totalPayment,
        totalValueFormatted: `$${(Number(p.totalPayment) / 1e6).toFixed(2)}`,
        investmentDelta: investmentDelta.toString(),
        runningTokenBalance: (Number(runningTokens) / 1e18).toFixed(2),
        runningInvestment: (Number(runningInvestment) / 1e6).toFixed(2),
        txHash: p.txHash,
      };
    });

    // Yield info
    let yieldInfo = {
      settlementDistributed: false,
      claimableYield: '0',
      claimableYieldFormatted: '0.00 USDC',
    } as any;

    if (settlement && settlement.usdcAmount) {
      const soldAmount = BigInt(asset?.listing?.sold || '0');
      const userBalance = BigInt(holding.tokenBalance);
      const settlementUSDC = BigInt(settlement.usdcAmount);

      const claimableYieldRaw = soldAmount > 0n ? (userBalance * settlementUSDC) / soldAmount : 0n;

      yieldInfo = {
        settlementDistributed: true,
        claimableYield: claimableYieldRaw.toString(),
        claimableYieldFormatted: `${(Number(claimableYieldRaw) / 1e6).toFixed(2)} USDC`,
        settlementDate: settlement.settlementDate,
        settlementId: settlement._id,
      };

      if (holding.status === HoldingStatus.CLAIMED && holding.latestYieldClaimId) {
        const claim = await this.yieldClaimModel.findById(holding.latestYieldClaimId);
        if (claim) {
          yieldInfo.yieldClaimTxHash = claim.transactionHash;
        }
      }
    }

    return {
      transactionHistory: history,
      yieldInfo,
    };
  }

  private async enrichLeverageHolding(holding: any) {
    if (!holding.leveragePositionId) return {};
    const position = await this.leveragePositionModel.findById(holding.leveragePositionId);
    if (!position) return {};

    // Format like original getLeveragePositionsForPortfolio
    return {
      mETHCollateral: position.mETHCollateral,
      mETHCollateralFormatted: `${(Number(position.mETHCollateral) / 1e18).toFixed(4)} mETH`,
      usdcBorrowed: position.usdcBorrowed,
      usdcBorrowedFormatted: `${(Number(position.usdcBorrowed) / 1e6).toFixed(2)} USDC`,
      healthFactor: (position.currentHealthFactor / 10000).toFixed(2) + '%',
      healthStatus: position.healthStatus,
      totalInterestPaid: position.totalInterestPaid,
      totalInterestPaidFormatted: `$${(Number(position.totalInterestPaid) / 1e6).toFixed(2)} USDC`,
      harvestHistory: (position.harvestHistory || []).map((h: any) => ({
        timestamp: h.timestamp,
        mETHSwappedFormatted: `${(Number(h.mETHSwapped) / 1e18).toFixed(4)} mETH`,
        usdcReceivedFormatted: `${(Number(h.usdcReceived) / 1e6).toFixed(2)} USDC`,
        interestPaidFormatted: `${(Number(h.interestPaid) / 1e6).toFixed(2)} USDC`,
      })),
      settlementTxHash: position.settlementTxHash,
      liquidationTxHash: position.liquidationTxHash,
    };
  }

  private async enrichSolvencyHolding(holding: any) {
    if (!holding.solvencyPositionId) return {};
    const position = await this.solvencyPositionModel.findById(holding.solvencyPositionId);
    if (!position) return {};

    return {
      loanAmount: position.loanAmount,
      loanAmountFormatted: `$${(Number(position.loanAmount) / 1e6).toFixed(2)} USDC`,
      repaidAmount: position.repaidAmount,
      repaidAmountFormatted: `$${(Number(position.repaidAmount) / 1e6).toFixed(2)} USDC`,
      remainingDebt: (BigInt(position.loanAmount) - BigInt(position.repaidAmount)).toString(),
      healthFactor: (position.healthFactor / 100).toFixed(2) + '%',
      nextRepaymentDate: position.nextRepaymentDate,
      status: position.status,
    };
  }

  /**
   * Update or create portfolio on new purchase
   */
  async updateOnPurchase(purchase: PurchaseDocument, network: string) {
    this.logger.log(`Updating portfolio for ${purchase.investorWallet} on ${network} for purchase ${purchase.txHash}`);

    const investorWallet = purchase.investorWallet.toLowerCase();
    const assetId = purchase.assetId;
    
    let portfolio = await this.portfolioModel.findOne({ walletAddress: investorWallet, network });
    if (!portfolio) {
      portfolio = new this.portfolioModel({
        walletAddress: investorWallet,
        network,
        holdings: [],
        totals: {
          totalUSDCInvested: '0',
          totalYieldReceived: '0',
          totalActivePositions: 0,
          totalCompletedPositions: 0,
          totalActiveLeveragePositions: 0,
          totalActiveSolvencyPositions: 0,
          networks: [network],
        },
        recentActivity: [],
      });
    }

    let holding = portfolio.holdings.find(h => h.assetId === assetId && h.holdingType === HoldingType.STATIC);
    if (!holding) {
      const newHolding = {
        assetId,
        tokenIdentifier: purchase.tokenAddress,
        network,
        holdingType: HoldingType.STATIC,
        status: HoldingStatus.ACTIVE,
        tokenBalance: '0',
        totalInvested: '0',
        purchaseIds: [],
        firstEntryAt: new Date(),
        lastActivityAt: new Date(),
      };
      portfolio.holdings.push(newHolding as any);
      holding = portfolio.holdings[portfolio.holdings.length - 1];
    }

    const amount = BigInt(purchase.amount);
    const totalPayment = BigInt(purchase.totalPayment);
    
    let investmentDelta = 0n;
    if (purchase.source === 'PRIMARY_MARKET' || purchase.source === 'AUCTION') {
      investmentDelta = totalPayment;
    } else if (purchase.source === 'SECONDARY_MARKET') {
      investmentDelta = amount < 0n ? -totalPayment : totalPayment;
    } else if (purchase.source === 'P2P_ORDER_CANCELLED') {
       investmentDelta = -totalPayment;
    }

    holding.tokenBalance = (BigInt(holding.tokenBalance) + amount).toString();
    holding.totalInvested = (BigInt(holding.totalInvested) + investmentDelta).toString();
    holding.lastActivityAt = new Date();
    
    if (!holding.purchaseIds) holding.purchaseIds = [];
    if (!holding.purchaseIds.some(id => id.toString() === purchase._id.toString())) {
      holding.purchaseIds.push(purchase._id as any);
    }

    if (BigInt(holding.tokenBalance) > 0n && holding.status === HoldingStatus.CLAIMED) {
      holding.status = HoldingStatus.ACTIVE;
    }

    const activityStub = {
      txHash: purchase.txHash,
      source: purchase.source,
      assetId: purchase.assetId,
      amount: purchase.amount,
      timestamp: purchase.createdAt || new Date(),
    };
    
    portfolio.recentActivity.unshift(activityStub);
    if (portfolio.recentActivity.length > 20) {
      portfolio.recentActivity.pop();
    }

    this.recalculateTotals(portfolio);
    
    portfolio.lastUpdated = new Date();
    portfolio.version += 1;

    await portfolio.save();
  }

  /**
   * Update portfolio on yield claim
   */
  async updateOnYieldClaim(claim: any, network: string) {
    const investorWallet = (claim.userAddress || claim.investorWallet).toLowerCase();
    const portfolio = await this.portfolioModel.findOne({ walletAddress: investorWallet, network });
    if (!portfolio) return;

    const holding = portfolio.holdings.find(h => h.assetId === claim.assetId && h.holdingType === HoldingType.STATIC);
    if (holding) {
      holding.status = HoldingStatus.CLAIMED;
      holding.latestYieldClaimId = claim._id as any;
      holding.tokenBalance = '0'; // Tokens are burned on claim
      holding.lastActivityAt = new Date();
      
      const usdcReceived = claim.usdcReceived;
      portfolio.totals.totalYieldReceived = (BigInt(portfolio.totals.totalYieldReceived) + BigInt(usdcReceived)).toString();
      
      const activityStub = {
        txHash: claim.transactionHash || claim.txHash,
        source: 'YIELD_CLAIM',
        assetId: claim.assetId,
        amount: usdcReceived,
        timestamp: claim.claimTimestamp || claim.createdAt || new Date(),
      };
      portfolio.recentActivity.unshift(activityStub);
      if (portfolio.recentActivity.length > 20) portfolio.recentActivity.pop();

      this.recalculateTotals(portfolio);
      portfolio.lastUpdated = new Date();
      portfolio.version += 1;
      await portfolio.save();
    }
  }

  private recalculateTotals(portfolio: UserPortfolioDocument) {
    let totalUSDCInvested = 0n;
    let totalActivePositions = 0;
    let totalCompletedPositions = 0;
    let totalActiveLeveragePositions = 0;
    let totalActiveSolvencyPositions = 0;
    const networks = new Set<string>();

    for (const holding of portfolio.holdings) {
      networks.add(holding.network);
      
      if (holding.holdingType !== HoldingType.SOLVENCY) {
        totalUSDCInvested += BigInt(holding.totalInvested);
      }

      const isActive = [HoldingStatus.ACTIVE, HoldingStatus.YIELD_CLAIMABLE].includes(holding.status);
      if (isActive) {
        totalActivePositions++;
        if (holding.holdingType === HoldingType.LEVERAGE) totalActiveLeveragePositions++;
        if (holding.holdingType === HoldingType.SOLVENCY) totalActiveSolvencyPositions++;
      } else {
        totalCompletedPositions++;
      }
    }

    portfolio.totals.totalUSDCInvested = totalUSDCInvested.toString();
    portfolio.totals.totalActivePositions = totalActivePositions;
    portfolio.totals.totalCompletedPositions = totalCompletedPositions;
    portfolio.totals.totalActiveLeveragePositions = totalActiveLeveragePositions;
    portfolio.totals.totalActiveSolvencyPositions = totalActiveSolvencyPositions;
    portfolio.totals.networks = Array.from(networks);
  }

  private getActivityLabel(source: string, amount: bigint): string {
    if (source === 'PRIMARY_MARKET') return 'Primary Purchase';
    if (source === 'AUCTION') return 'Auction Settlement';
    if (source === 'SECONDARY_MARKET') return amount > 0n ? 'Secondary Buy' : 'Secondary Sell';
    if (source === 'P2P_SELL_ORDER') return 'Order Locked';
    if (source === 'P2P_ORDER_CANCELLED') return 'Order Cancelled';
    if (source === 'YIELD_CLAIM') return 'Yield Claimed';
    if (source === 'LEVERAGE_OPEN') return 'Leverage Position Opened';
    if (source === 'LEVERAGE_HARVEST') return 'Leverage Yield Harvested';
    if (source === 'SOLVENCY_OPEN') return 'Solvency Loan Opened';
    if (source === 'SOLVENCY_REPAYMENT') return 'Solvency Repayment';
    return source;
  }

  /**
   * Rebuild portfolio from scratch (Admin/Recovery)
   */
  async rebuildPortfolio(walletAddress: string, network: string) {
    const investorWallet = walletAddress.toLowerCase();
    this.logger.log(`Rebuilding portfolio for ${investorWallet} on ${network}`);

    // 1. Fetch all source data
    const purchases = await this.purchaseModel.find({ investorWallet }).sort({ createdAt: 1 });
    const yieldClaims = await this.yieldClaimModel.find({ userAddress: investorWallet }).sort({ claimTimestamp: 1 });
    const leveragePositions = await this.leveragePositionModel.find({ userAddress: investorWallet }).sort({ createdAt: 1 });
    const solvencyPositions = await this.solvencyPositionModel.find({ userAddress: investorWallet }).sort({ createdAt: 1 });

    // 2. Initialize new portfolio document
    const portfolio = new this.portfolioModel({
      walletAddress: investorWallet,
      network,
      holdings: [],
      totals: {
        totalUSDCInvested: '0',
        totalYieldReceived: '0',
        totalActivePositions: 0,
        totalCompletedPositions: 0,
        totalActiveLeveragePositions: 0,
        totalActiveSolvencyPositions: 0,
        networks: [network],
      },
      recentActivity: [],
      version: 1,
    });

    // 3. Process purchases to build static holdings
    for (const purchase of purchases) {
       await this.updateOnPurchaseInternal(portfolio, purchase, network);
    }

    // 4. Process yield claims
    for (const claim of yieldClaims) {
      const holding = portfolio.holdings.find(h => h.assetId === claim.assetId && h.holdingType === HoldingType.STATIC);
      if (holding) {
        holding.status = HoldingStatus.CLAIMED;
        holding.latestYieldClaimId = claim._id as any;
        holding.tokenBalance = '0';
        portfolio.totals.totalYieldReceived = (BigInt(portfolio.totals.totalYieldReceived) + BigInt(claim.usdcReceived)).toString();
      }
    }

    // 5. Process leverage positions
    for (const pos of leveragePositions) {
      portfolio.holdings.push({
        assetId: pos.assetId,
        tokenIdentifier: pos.rwaTokenAddress,
        network,
        holdingType: HoldingType.LEVERAGE,
        status: pos.status === 'ACTIVE' ? HoldingStatus.ACTIVE : HoldingStatus.SETTLED,
        tokenBalance: pos.rwaTokenAmount,
        totalInvested: '0', // Leverage doesn't count as direct investment in this model
        leveragePositionId: pos._id,
        firstEntryAt: pos.createdAt,
        lastActivityAt: pos.updatedAt || pos.createdAt,
      } as any);
    }

    // 6. Process solvency positions
    for (const pos of solvencyPositions) {
      portfolio.holdings.push({
        assetId: pos.assetId,
        tokenIdentifier: '', // Not a token-based holding in the same way
        network,
        holdingType: HoldingType.SOLVENCY,
        status: pos.status === 'ACTIVE' ? HoldingStatus.ACTIVE : HoldingStatus.SETTLED,
        tokenBalance: '0',
        totalInvested: pos.loanAmount,
        solvencyPositionId: pos._id,
        firstEntryAt: pos.createdAt,
        lastActivityAt: pos.updatedAt || pos.createdAt,
      } as any);
    }

    this.recalculateTotals(portfolio);
    
    // 7. Update activity tail (last 20 items from all sources)
    // Simplified: just take last 20 purchases for now, or we could merge all
    const allActivity = [
      ...purchases.map(p => ({ txHash: p.txHash, source: p.source, assetId: p.assetId, amount: p.amount, timestamp: p.createdAt })),
      ...yieldClaims.map(c => ({ txHash: c.transactionHash, source: 'YIELD_CLAIM', assetId: c.assetId, amount: c.usdcReceived, timestamp: c.claimTimestamp })),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 20);

    portfolio.recentActivity = allActivity as any;

    await this.portfolioModel.findOneAndDelete({ walletAddress: investorWallet, network });
    await portfolio.save();
    return portfolio;
  }

  // Internal helper for rebuild to avoid redundant saves
  private async updateOnPurchaseInternal(portfolio: UserPortfolioDocument, purchase: PurchaseDocument, network: string) {
    const assetId = purchase.assetId;
    let holding = portfolio.holdings.find(h => h.assetId === assetId && h.holdingType === HoldingType.STATIC);
    if (!holding) {
      const newHolding = {
        assetId,
        tokenIdentifier: purchase.tokenAddress,
        network,
        holdingType: HoldingType.STATIC,
        status: HoldingStatus.ACTIVE,
        tokenBalance: '0',
        totalInvested: '0',
        purchaseIds: [],
        firstEntryAt: purchase.createdAt || new Date(),
        lastActivityAt: purchase.createdAt || new Date(),
      };
      portfolio.holdings.push(newHolding as any);
      holding = portfolio.holdings[portfolio.holdings.length - 1];
    }

    const amount = BigInt(purchase.amount);
    const totalPayment = BigInt(purchase.totalPayment);
    
    let investmentDelta = 0n;
    if (purchase.source === 'PRIMARY_MARKET' || purchase.source === 'AUCTION') {
      investmentDelta = totalPayment;
    } else if (purchase.source === 'SECONDARY_MARKET') {
      investmentDelta = amount < 0n ? -totalPayment : totalPayment;
    } else if (purchase.source === 'P2P_ORDER_CANCELLED') {
       investmentDelta = -totalPayment;
    }

    holding.tokenBalance = (BigInt(holding.tokenBalance) + amount).toString();
    holding.totalInvested = (BigInt(holding.totalInvested) + investmentDelta).toString();
    if (purchase.createdAt && purchase.createdAt > holding.lastActivityAt) {
      holding.lastActivityAt = purchase.createdAt;
    }
    
    if (!holding.purchaseIds) holding.purchaseIds = [];
    holding.purchaseIds.push(purchase._id as any);
  }

  /**
   * Update portfolio on leverage event
   */
  async updateOnLeverageEvent(positionId: number, network: string) {
    const position = await this.leveragePositionModel.findOne({ positionId });
    if (!position) return;

    const investorWallet = position.userAddress.toLowerCase();
    let portfolio = await this.portfolioModel.findOne({ walletAddress: investorWallet, network });
    if (!portfolio) {
      portfolio = new this.portfolioModel({
        walletAddress: investorWallet,
        network,
        holdings: [],
        totals: {
          totalUSDCInvested: '0',
          totalYieldReceived: '0',
          totalActivePositions: 0,
          totalCompletedPositions: 0,
          totalActiveLeveragePositions: 0,
          totalActiveSolvencyPositions: 0,
          networks: [network],
        },
        recentActivity: [],
      });
    }

    let holding = portfolio.holdings.find(h => h.leveragePositionId?.toString() === position._id.toString());
    if (!holding) {
      const newHolding = {
        assetId: position.assetId,
        tokenIdentifier: position.rwaTokenAddress,
        network,
        holdingType: HoldingType.LEVERAGE,
        status: HoldingStatus.ACTIVE,
        tokenBalance: position.rwaTokenAmount,
        totalInvested: '0',
        leveragePositionId: position._id,
        firstEntryAt: position.createdAt || new Date(),
        lastActivityAt: new Date(),
      };
      portfolio.holdings.push(newHolding as any);
    } else {
      holding.status = position.status === 'ACTIVE' ? HoldingStatus.ACTIVE : 
                       (position.status === 'SETTLED' ? HoldingStatus.SETTLED : HoldingStatus.LIQUIDATED);
      holding.tokenBalance = position.rwaTokenAmount;
      holding.lastActivityAt = new Date();
    }

    this.recalculateTotals(portfolio);
    portfolio.lastUpdated = new Date();
    portfolio.version += 1;
    await portfolio.save();
  }

  /**
   * Update portfolio on solvency event
   */
  async updateOnSolvencyEvent(positionId: number, network: string) {
    const position = await this.solvencyPositionModel.findOne({ positionId });
    if (!position) return;

    const investorWallet = position.userAddress.toLowerCase();
    let portfolio = await this.portfolioModel.findOne({ walletAddress: investorWallet, network });
    if (!portfolio) {
      portfolio = new this.portfolioModel({
        walletAddress: investorWallet,
        network,
        holdings: [],
        totals: {
          totalUSDCInvested: '0',
          totalYieldReceived: '0',
          totalActivePositions: 0,
          totalCompletedPositions: 0,
          totalActiveLeveragePositions: 0,
          totalActiveSolvencyPositions: 0,
          networks: [network],
        },
        recentActivity: [],
      });
    }

    let holding = portfolio.holdings.find(h => h.solvencyPositionId?.toString() === position._id.toString());
    if (!holding) {
       // Look up assetId by token address
       const asset = await this.assetModel.findOne({ 'token.address': new RegExp(`^${position.collateralTokenAddress}$`, 'i') });
       
       const newHolding = {
        assetId: asset?.assetId || 'UNKNOWN',
        tokenIdentifier: position.collateralTokenAddress,
        network,
        holdingType: HoldingType.SOLVENCY,
        status: position.status === 'ACTIVE' ? HoldingStatus.ACTIVE : HoldingStatus.SETTLED,
        tokenBalance: '0',
        totalInvested: position.usdcBorrowed,
        solvencyPositionId: position._id,
        firstEntryAt: position.createdAt || new Date(),
        lastActivityAt: new Date(),
      };
      portfolio.holdings.push(newHolding as any);
    } else {
      holding.status = position.status === 'ACTIVE' ? HoldingStatus.ACTIVE : HoldingStatus.SETTLED;
      holding.totalInvested = position.usdcBorrowed;
      holding.lastActivityAt = new Date();
    }

    this.recalculateTotals(portfolio);
    portfolio.lastUpdated = new Date();
    portfolio.version += 1;
    await portfolio.save();
  }
}
