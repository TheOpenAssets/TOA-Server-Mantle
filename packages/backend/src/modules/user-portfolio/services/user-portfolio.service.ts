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
import { toCanonical, fromCanonical } from '../../blockchain/utils/numeric-conversion';

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
        runtimeHolding.tokenBalanceFormatted = `${Number(holding.tokenBalance).toFixed(2)} tokens`;
        runtimeHolding.totalInvested = holding.totalInvested;
        runtimeHolding.totalInvestedFormatted = `$${Number(holding.totalInvested).toFixed(2)} USDC`;
        
        runtimeHolding.assetMetadata = asset ? {
          assetName: `${asset.metadata?.invoiceNumber || 'N/A'} - ${asset.metadata?.buyerName || 'N/A'}`,
          industry: asset.metadata?.industry,
          riskTier: asset.metadata?.riskTier,
          assetType: asset.assetType,
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
        totalUSDCInvested: `$${Number(portfolio.totals.totalUSDCInvested).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        totalYieldReceived: `$${Number(portfolio.totals.totalYieldReceived).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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
    
    // Running balance calculation using raw bigints for precision
    let runningTokensRaw = 0n;
    let runningInvestmentRaw = 0n;

    const history = purchases.map(p => {
      const amountCanonical = p.amount.includes('.') ? p.amount : toCanonical(p.amount, 18).value;
      const priceCanonical = p.price.includes('.') ? p.price : toCanonical(p.price, 6).value;
      const totalPaymentCanonical = p.totalPayment.includes('.') ? p.totalPayment : toCanonical(p.totalPayment, 6).value;

      const amountRaw = fromCanonical(amountCanonical, 18);
      const totalPaymentRaw = fromCanonical(totalPaymentCanonical, 6);
      
      let investmentDeltaRaw = 0n;
      if (p.source === 'PRIMARY_MARKET' || p.source === 'AUCTION') {
        investmentDeltaRaw = totalPaymentRaw;
      } else if (p.source === 'SECONDARY_MARKET') {
        investmentDeltaRaw = amountRaw < 0n ? -totalPaymentRaw : totalPaymentRaw;
      } else if (p.source === 'P2P_ORDER_CANCELLED') {
        investmentDeltaRaw = -totalPaymentRaw;
      }

      runningTokensRaw += amountRaw;
      runningInvestmentRaw += investmentDeltaRaw;

      return {
        date: p.createdAt,
        type: p.source,
        amount: amountCanonical,
        amountFormatted: `${amountCanonical} tokens`,
        price: priceCanonical,
        priceFormatted: `$${priceCanonical}`,
        totalValue: totalPaymentCanonical,
        totalValueFormatted: `$${totalPaymentCanonical}`,
        investmentDelta: toCanonical(investmentDeltaRaw, 6).value,
        runningTokenBalance: toCanonical(runningTokensRaw, 18).value,
        runningInvestment: toCanonical(runningInvestmentRaw, 6).value,
        txHash: p.txHash,
      };
    });

    // Yield info
    let yieldInfo = {
      settlementDistributed: false,
      claimableYield: '0.0000',
      claimableYieldFormatted: '0.0000 USDC',
    } as any;

    if (settlement && settlement.usdcAmount) {
      const totalSupplyCanonical = (asset?.listing?.sold || asset?.tokenParams?.totalSupply || '0').includes('.')
        ? (asset?.listing?.sold || asset?.tokenParams?.totalSupply || '0')
        : toCanonical(asset?.listing?.sold || asset?.tokenParams?.totalSupply || '0', 18).value;
      
      const soldAmountRaw = fromCanonical(totalSupplyCanonical, 18);
      const userBalanceRaw = fromCanonical(holding.tokenBalance, 18);
      
      const settlementUSDCCanonical = settlement.usdcAmount.includes('.') 
        ? settlement.usdcAmount 
        : toCanonical(settlement.usdcAmount, 6).value;
      const settlementUSDCRaw = fromCanonical(settlementUSDCCanonical, 6);

      const claimableYieldRaw = soldAmountRaw > 0n ? (userBalanceRaw * settlementUSDCRaw) / soldAmountRaw : 0n;
      const claimableYieldCanonical = toCanonical(claimableYieldRaw, 6).value;

      yieldInfo = {
        settlementDistributed: true,
        claimableYield: claimableYieldCanonical,
        claimableYieldFormatted: `${claimableYieldCanonical} USDC`,
        settlementDate: settlement.settlementDate,
        settlementId: settlement._id,
      };

      if (holding.status === HoldingStatus.CLAIMED && holding.latestYieldClaimId) {
        const claim = await this.yieldClaimModel.findById(holding.latestYieldClaimId);
        if (claim) {
          yieldInfo.yieldClaimTxHash = claim.transactionHash || (claim as any).txHash;
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

    const mETHCollateralCanonical = position.mETHCollateral; // already canonical
    const usdcBorrowedCanonical = toCanonical(position.usdcBorrowed, 6).value;
    const totalInterestPaidCanonical = toCanonical(position.totalInterestPaid, 6).value;

    // Format like original getLeveragePositionsForPortfolio
    return {
      mETHCollateral: mETHCollateralCanonical,
      mETHCollateralFormatted: `${mETHCollateralCanonical} mETH`,
      usdcBorrowed: usdcBorrowedCanonical,
      usdcBorrowedFormatted: `${usdcBorrowedCanonical} USDC`,
      healthFactor: (position.currentHealthFactor / 10000).toFixed(2) + '%',
      healthStatus: position.healthStatus,
      totalInterestPaid: totalInterestPaidCanonical,
      totalInterestPaidFormatted: `$${totalInterestPaidCanonical} USDC`,
      harvestHistory: (position.harvestHistory || []).map((h: any) => ({
        timestamp: h.timestamp,
        mETHSwappedFormatted: `${toCanonical(h.mETHSwapped, 18).value} mETH`,
        usdcReceivedFormatted: `${toCanonical(h.usdcReceived, 6).value} USDC`,
        interestPaidFormatted: `${toCanonical(h.interestPaid, 6).value} USDC`,
      })),
      settlementTxHash: position.settlementTxHash,
      liquidationTxHash: position.liquidationTxHash,
    };
  }

  private async enrichSolvencyHolding(holding: any) {
    if (!holding.solvencyPositionId) return {};
    const position = await this.solvencyPositionModel.findById(holding.solvencyPositionId);
    if (!position) return {};

    const loanAmountCanonical = toCanonical(position.loanAmount, 6).value;
    const repaidAmountCanonical = toCanonical(position.totalRepaid || position.repaidAmount || '0', 6).value;
    const remainingDebtRaw = fromCanonical(loanAmountCanonical, 6) - fromCanonical(repaidAmountCanonical, 6);
    const remainingDebtCanonical = toCanonical(remainingDebtRaw, 6).value;

    return {
      loanAmount: loanAmountCanonical,
      loanAmountFormatted: `$${loanAmountCanonical} USDC`,
      repaidAmount: repaidAmountCanonical,
      repaidAmountFormatted: `$${repaidAmountCanonical} USDC`,
      remainingDebt: remainingDebtCanonical,
      healthFactor: (position.currentHealthFactor / 100).toFixed(2) + '%',
      nextRepaymentDate: position.nextPaymentDueDate || position.nextRepaymentDate,
      status: position.status,
    };
  }

  /**
   * Initialize an empty portfolio for a newly registered investor
   * Called when KYC is approved and investor is registered on-chain
   */
  async initializePortfolio(walletAddress: string, network: string): Promise<UserPortfolioDocument> {
    const investorWallet = walletAddress.toLowerCase();
    
    // Check if portfolio already exists
    let portfolio = await this.portfolioModel.findOne({ walletAddress: investorWallet, network });
    if (portfolio) {
      this.logger.log(`Portfolio already exists for ${investorWallet} on ${network}`);
      return portfolio;
    }

    // Create new empty portfolio
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
      lastUpdated: new Date(),
      version: 1,
    });

    await portfolio.save();
    this.logger.log(`✅ Initialized portfolio for ${investorWallet} on ${network}`);
    return portfolio;
  }

  /**
   * Update or create portfolio on new purchase
   */
  async updateOnPurchase(purchase: PurchaseDocument, network: string) {
    try {
      this.logger.log(`🔄 Updating portfolio for ${purchase.investorWallet} on ${network} for purchase ${purchase.txHash}`);

      const investorWallet = purchase.investorWallet.toLowerCase();
      const assetId = purchase.assetId;

      this.logger.log(`Looking up portfolio: walletAddress=${investorWallet}, network=${network}`);
      let portfolio = await this.portfolioModel.findOne({ walletAddress: investorWallet, network });

      if (!portfolio) {
        this.logger.warn(`⚠️  No portfolio found for ${investorWallet} on ${network}. Creating new portfolio document.`);
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
      } else {
        this.logger.log(`✓ Found existing portfolio with ${portfolio.holdings.length} holdings`);
      }

      let holding = portfolio.holdings.find(h => h.assetId === assetId && h.holdingType === HoldingType.STATIC);
      if (!holding) {
        this.logger.log(`Creating new holding for assetId=${assetId}`);
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
      } else {
        this.logger.log(`Found existing holding for assetId=${assetId}, current balance: ${holding.tokenBalance}`);
      }

      const amountCanonical = purchase.amount.includes('.') ? purchase.amount : toCanonical(purchase.amount, 18).value;
      const priceCanonical = purchase.price.includes('.') ? purchase.price : toCanonical(purchase.price, 6).value;
      const totalPaymentCanonical = purchase.totalPayment.includes('.') ? purchase.totalPayment : toCanonical(purchase.totalPayment, 6).value;

      const amountRaw = fromCanonical(amountCanonical, 18);
      const totalPaymentRaw = fromCanonical(totalPaymentCanonical, 6);

      let investmentDeltaRaw = 0n;
      if (purchase.source === 'PRIMARY_MARKET' || purchase.source === 'AUCTION') {
        investmentDeltaRaw = totalPaymentRaw;
      } else if (purchase.source === 'SECONDARY_MARKET') {
        investmentDeltaRaw = amountRaw < 0n ? -totalPaymentRaw : totalPaymentRaw;
      } else if (purchase.source === 'P2P_ORDER_CANCELLED') {
         investmentDeltaRaw = -totalPaymentRaw;
      }

      const currentBalanceRaw = fromCanonical(holding?.tokenBalance || '0', 18);
      const currentInvestedRaw = fromCanonical(holding?.totalInvested || '0', 6);

      if (holding) {
        holding.tokenBalance = toCanonical(currentBalanceRaw + amountRaw, 18).value;
        holding.totalInvested = toCanonical(currentInvestedRaw + investmentDeltaRaw, 6).value;
        holding.lastActivityAt = new Date();

        if (!holding.purchaseIds) holding.purchaseIds = [];
        if (!holding.purchaseIds.some(id => id.toString() === purchase._id.toString())) {
          holding.purchaseIds.push(purchase._id as any);
        }

        if (fromCanonical(holding.tokenBalance, 18) > 0n && holding.status === HoldingStatus.CLAIMED) {
          holding.status = HoldingStatus.ACTIVE;
        }
      }

      const activityStub = {
        txHash: purchase.txHash,
        source: purchase.source,
        assetId: purchase.assetId,
        amount: amountCanonical,
        timestamp: purchase.createdAt || new Date(),
      };

      portfolio.recentActivity.unshift(activityStub);
      if (portfolio.recentActivity.length > 20) {
        portfolio.recentActivity.pop();
      }

      this.recalculateTotals(portfolio);

      portfolio.lastUpdated = new Date();
      portfolio.version += 1;

      this.logger.log(`💾 Saving portfolio: holdings=${portfolio.holdings.length}, totalInvested=${portfolio.totals.totalUSDCInvested}`);
      await portfolio.save();
      this.logger.log(`✅ Portfolio saved successfully for ${investorWallet}`);
    } catch (error: any) {
      this.logger.error(`❌ Error in updateOnPurchase: ${error.message}`);
      this.logger.error(`Stack trace: ${error.stack}`);
      throw error; // Re-throw to be caught by caller
    }
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
      holding.tokenBalance = '0.0000'; // Tokens are burned on claim
      holding.lastActivityAt = new Date();
      
      const usdcReceivedCanonical = claim.usdcReceived.toString().includes('.') 
        ? claim.usdcReceived.toString() 
        : toCanonical(claim.usdcReceived, 6).value;
      
      const currentYieldRaw = fromCanonical(portfolio.totals.totalYieldReceived, 6);
      const claimYieldRaw = fromCanonical(usdcReceivedCanonical, 6);
      
      portfolio.totals.totalYieldReceived = toCanonical(currentYieldRaw + claimYieldRaw, 6).value;
      
      const activityStub = {
        txHash: claim.transactionHash || claim.txHash,
        source: 'YIELD_CLAIM',
        assetId: claim.assetId,
        amount: usdcReceivedCanonical,
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
    let totalUSDCInvestedRaw = 0n;
    let totalActivePositions = 0;
    let totalCompletedPositions = 0;
    let totalActiveLeveragePositions = 0;
    let totalActiveSolvencyPositions = 0;
    const networks = new Set<string>();

    for (const holding of portfolio.holdings) {
      networks.add(holding.network);
      
      if (holding.holdingType !== HoldingType.SOLVENCY) {
        totalUSDCInvestedRaw += fromCanonical(holding.totalInvested, 6);
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

    portfolio.totals.totalUSDCInvested = toCanonical(totalUSDCInvestedRaw, 6).value;
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
        totalUSDCInvested: '0.0000',
        totalYieldReceived: '0.0000',
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
        holding.tokenBalance = '0.0000';
        const claimYieldRaw = fromCanonical(toCanonical(claim.usdcReceived, 6).value, 6);
        const currentYieldRaw = fromCanonical(portfolio.totals.totalYieldReceived, 6);
        portfolio.totals.totalYieldReceived = toCanonical(currentYieldRaw + claimYieldRaw, 6).value;
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
        totalInvested: '0.0000',
        leveragePositionId: pos._id,
        firstEntryAt: pos.createdAt,
        lastActivityAt: pos.updatedAt || pos.createdAt,
      } as any);
    }

    // 6. Process solvency positions
    for (const pos of solvencyPositions) {
      portfolio.holdings.push({
        assetId: pos.assetId,
        tokenIdentifier: pos.collateralTokenAddress || '', 
        network,
        holdingType: HoldingType.SOLVENCY,
        status: pos.status === 'ACTIVE' ? HoldingStatus.ACTIVE : HoldingStatus.SETTLED,
        tokenBalance: '0.0000',
        totalInvested: toCanonical(pos.usdcBorrowed || pos.loanAmount, 6).value,
        solvencyPositionId: pos._id,
        firstEntryAt: pos.createdAt,
        lastActivityAt: pos.updatedAt || pos.createdAt,
      } as any);
    }

    this.recalculateTotals(portfolio);
    
    // 7. Update activity tail (last 20 items from all sources)
    const allActivity = [
      ...purchases.map(p => ({ 
        txHash: p.txHash, 
        source: p.source, 
        assetId: p.assetId, 
        amount: p.amount.includes('.') ? p.amount : toCanonical(p.amount, 18).value, 
        timestamp: p.createdAt 
      })),
      ...yieldClaims.map(c => ({ 
        txHash: (c as any).transactionHash || (c as any).txHash, 
        source: 'YIELD_CLAIM', 
        assetId: (c as any).assetId, 
        amount: (c as any).usdcReceived.toString().includes('.') ? (c as any).usdcReceived.toString() : toCanonical((c as any).usdcReceived, 6).value, 
        timestamp: (c as any).claimTimestamp || (c as any).createdAt || new Date()
      })),
    ].sort((a, b) => {
      const timeA = (a.timestamp ? (a.timestamp instanceof Date ? a.timestamp : new Date(a.timestamp)) : new Date(0)).getTime();
      const timeB = (b.timestamp ? (b.timestamp instanceof Date ? b.timestamp : new Date(b.timestamp)) : new Date(0)).getTime();
      return timeB - timeA;
    }).slice(0, 20);

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
        tokenBalance: '0.0000',
        totalInvested: '0.0000',
        purchaseIds: [],
        firstEntryAt: purchase.createdAt || new Date(),
        lastActivityAt: purchase.createdAt || new Date(),
      };
      portfolio.holdings.push(newHolding as any);
      holding = portfolio.holdings[portfolio.holdings.length - 1];
    }

    const amountCanonical = purchase.amount.includes('.') ? purchase.amount : toCanonical(purchase.amount, 18).value;
    const totalPaymentCanonical = purchase.totalPayment.includes('.') ? purchase.totalPayment : toCanonical(purchase.totalPayment, 6).value;

    const amountRaw = fromCanonical(amountCanonical, 18);
    const totalPaymentRaw = fromCanonical(totalPaymentCanonical, 6);
    
    let investmentDeltaRaw = 0n;
    if (purchase.source === 'PRIMARY_MARKET' || purchase.source === 'AUCTION') {
      investmentDeltaRaw = totalPaymentRaw;
    } else if (purchase.source === 'SECONDARY_MARKET') {
      investmentDeltaRaw = amountRaw < 0n ? -totalPaymentRaw : totalPaymentRaw;
    } else if (purchase.source === 'P2P_ORDER_CANCELLED') {
       investmentDeltaRaw = -totalPaymentRaw;
    }

    const currentBalanceRaw = fromCanonical(holding?.tokenBalance || '0.0000', 18);
    const currentInvestedRaw = fromCanonical(holding?.totalInvested || '0.0000', 6);

    if (holding) {
      holding.tokenBalance = toCanonical(currentBalanceRaw + amountRaw, 18).value;
      holding.totalInvested = toCanonical(currentInvestedRaw + investmentDeltaRaw, 6).value;
      if (purchase.createdAt && purchase.createdAt > holding.lastActivityAt) {
        holding.lastActivityAt = purchase.createdAt;
      }
      
      if (!holding.purchaseIds) holding.purchaseIds = [];
      holding.purchaseIds.push(purchase._id as any);
    }
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
        totalInvested: '0.0000',
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
        tokenBalance: '0.0000',
        totalInvested: toCanonical(position.usdcBorrowed, 6).value,
        solvencyPositionId: position._id,
        firstEntryAt: position.createdAt || new Date(),
        lastActivityAt: new Date(),
      };
      portfolio.holdings.push(newHolding as any);
    } else {
      holding.status = position.status === 'ACTIVE' ? HoldingStatus.ACTIVE : HoldingStatus.SETTLED;
      holding.totalInvested = toCanonical(position.usdcBorrowed, 6).value;
      holding.lastActivityAt = new Date();
    }

    this.recalculateTotals(portfolio);
    portfolio.lastUpdated = new Date();
    portfolio.version += 1;
    await portfolio.save();
  }

  /**
   * Add assetId to requested_trustlines array for Stellar assets
   */
  async addRequestedTrustline(walletAddress: string, network: string, assetId: string): Promise<void> {
    const investorWallet = walletAddress.toLowerCase();
    
    await this.portfolioModel.updateOne(
      { walletAddress: investorWallet, network },
      {
        $addToSet: { requested_trustlines: assetId },
        $setOnInsert: {
          walletAddress: investorWallet,
          network,
          holdings: [],
          totals: {},
          recentActivity: [],
          lastUpdated: new Date(),
          version: 1,
        },
      },
      { upsert: true }
    );

    this.logger.log(`Added assetId ${assetId} to requested_trustlines for wallet ${investorWallet} on ${network}`);
  }

  /**
   * Move assetId from requested_trustlines to approved_trustlines
   */
  async approveTrustline(walletAddress: string, network: string, assetId: string): Promise<void> {
    const investorWallet = walletAddress.toLowerCase();

    await this.portfolioModel.updateOne(
      { walletAddress: investorWallet, network },
      {
        $pull: { requested_trustlines: assetId },
        $addToSet: { approved_trustlines: assetId },
      }
    );

    this.logger.log(`Moved assetId ${assetId} from requested to approved trustlines for wallet ${investorWallet} on ${network}`);
  }

  /**
   * Check if investor has approved trustline for an asset
   */
  async hasTrustlineApproved(walletAddress: string, network: string, assetId: string): Promise<boolean> {
    const investorWallet = walletAddress.toLowerCase();

    const portfolio = await this.portfolioModel.findOne({
      walletAddress: investorWallet,
      network,
    }).lean();

    if (!portfolio) {
      return false;
    }

    return portfolio.approved_trustlines?.includes(assetId) || false;
  }

  /**
   * Validate portfolio sync - compares portfolio data with actual purchases and bids
   * Returns discrepancies for debugging
   */
  async validatePortfolioSync(walletAddress: string, network: string) {
    const investorWallet = walletAddress.toLowerCase();

    this.logger.log(`🔍 Validating portfolio sync for ${investorWallet} on ${network}`);

    // Get portfolio document
    const portfolio = await this.portfolioModel.findOne({ walletAddress: investorWallet, network });

    // Get all purchases for this wallet
    const purchases = await this.purchaseModel.find({
      investorWallet,
      status: { $in: ['CONFIRMED', 'CLAIMED'] },
    }).sort({ createdAt: 1 });

    // Get all bids for this wallet (from Bid model if available)
    let bids = [];
    try {
      const BidModel = this.purchaseModel.db.model('Bid');
      bids = await BidModel.find({
        bidder: investorWallet,
        status: { $in: ['SETTLED', 'PLACED'] },
      }).sort({ createdAt: 1 });
    } catch (error) {
      this.logger.warn('Bid model not available for validation');
    }

    const issues: any[] = [];
    const summary = {
      portfolioExists: !!portfolio,
      portfolioNetwork: portfolio?.network,
      purchaseCount: purchases.length,
      bidCount: bids.length,
      holdingsCount: portfolio?.holdings.length || 0,
      issues: [] as string[],
    };

    if (!portfolio && purchases.length > 0) {
      issues.push({
        severity: 'CRITICAL',
        message: `Portfolio document missing but ${purchases.length} purchases exist`,
        action: 'Run rebuild endpoint to create portfolio from purchases',
      });
      summary.issues.push('MISSING_PORTFOLIO');
    }

    if (portfolio) {
      // Group purchases by assetId
      const purchasesByAsset = new Map<string, any[]>();
      for (const purchase of purchases) {
        if (!purchasesByAsset.has(purchase.assetId)) {
          purchasesByAsset.set(purchase.assetId, []);
        }
        purchasesByAsset.get(purchase.assetId)!.push(purchase);
      }

      // Check if each asset with purchases has a corresponding holding
      for (const [assetId, assetPurchases] of purchasesByAsset) {
        const holding = portfolio.holdings.find(h => h.assetId === assetId && h.holdingType === HoldingType.STATIC);

        if (!holding) {
          issues.push({
            severity: 'HIGH',
            assetId,
            message: `Asset has ${assetPurchases.length} purchases but no holding in portfolio`,
            purchaseIds: assetPurchases.map(p => p._id.toString()),
            action: 'Run rebuild endpoint to sync holdings',
          });
          summary.issues.push(`MISSING_HOLDING_${assetId}`);
        } else {
          // Calculate expected balance from purchases
          let expectedBalanceRaw = 0n;
          let expectedInvestedRaw = 0n;

          for (const purchase of assetPurchases) {
            const amountCanonical = purchase.amount.includes('.') ? purchase.amount : toCanonical(purchase.amount, 18).value;
            const totalPaymentCanonical = purchase.totalPayment.includes('.') ? purchase.totalPayment : toCanonical(purchase.totalPayment, 6).value;

            const amountRaw = fromCanonical(amountCanonical, 18);
            const totalPaymentRaw = fromCanonical(totalPaymentCanonical, 6);

            expectedBalanceRaw += amountRaw;

            if (purchase.source === 'PRIMARY_MARKET' || purchase.source === 'AUCTION') {
              expectedInvestedRaw += totalPaymentRaw;
            } else if (purchase.source === 'SECONDARY_MARKET') {
              expectedInvestedRaw += amountRaw < 0n ? -totalPaymentRaw : totalPaymentRaw;
            } else if (purchase.source === 'P2P_ORDER_CANCELLED') {
              expectedInvestedRaw -= totalPaymentRaw;
            }
          }

          const expectedBalance = toCanonical(expectedBalanceRaw, 18).value;
          const expectedInvested = toCanonical(expectedInvestedRaw, 6).value;

          const actualBalanceRaw = fromCanonical(holding.tokenBalance, 18);
          const actualInvestedRaw = fromCanonical(holding.totalInvested, 6);

          if (actualBalanceRaw !== expectedBalanceRaw) {
            issues.push({
              severity: 'HIGH',
              assetId,
              message: 'Token balance mismatch',
              expected: expectedBalance,
              actual: holding.tokenBalance,
              difference: toCanonical(actualBalanceRaw - expectedBalanceRaw, 18).value,
            });
            summary.issues.push(`BALANCE_MISMATCH_${assetId}`);
          }

          if (actualInvestedRaw !== expectedInvestedRaw) {
            issues.push({
              severity: 'MEDIUM',
              assetId,
              message: 'Total invested mismatch',
              expected: expectedInvested,
              actual: holding.totalInvested,
              difference: toCanonical(actualInvestedRaw - expectedInvestedRaw, 6).value,
            });
            summary.issues.push(`INVESTED_MISMATCH_${assetId}`);
          }

          // Check if purchaseIds match
          const expectedPurchaseIds = new Set(assetPurchases.map(p => p._id.toString()));
          const actualPurchaseIds = new Set((holding.purchaseIds || []).map(id => id.toString()));

          const missingPurchaseIds = [...expectedPurchaseIds].filter(id => !actualPurchaseIds.has(id));
          if (missingPurchaseIds.length > 0) {
            issues.push({
              severity: 'LOW',
              assetId,
              message: `${missingPurchaseIds.length} purchase IDs not linked to holding`,
              missingPurchaseIds,
            });
            summary.issues.push(`MISSING_PURCHASE_IDS_${assetId}`);
          }
        }
      }
    }

    return {
      walletAddress: investorWallet,
      network,
      timestamp: new Date(),
      summary,
      issues,
      recommendations: issues.length > 0
        ? ['Run /portfolio/rebuild/:walletAddress endpoint to fix sync issues']
        : ['Portfolio is in sync with purchases'],
    };
  }
}

