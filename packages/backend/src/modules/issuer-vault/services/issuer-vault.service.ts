import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, type Address, parseUnits, encodeFunctionData } from 'viem';
import { getActiveChain } from '@/src/config/active-chain';
import {
  IssuerVaultPosition,
  IssuerVaultPositionDocument,
  IssuerVaultStatus,
} from '../../../database/schemas/issuer-vault-position.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { NetworkRegistryService } from '../../blockchain/services/network-registry.service';
import { CreateIssuerVaultDto, WithdrawLiquidityDto, RepayDebtDto, DebtSummaryResponse } from '../dto/issuer-vault.dto';
import { NetworkType } from '@openassets/types';

// Minimal ABI for on-chain reads/writes we need
const ISSUER_VAULT_ABI = [
  {
    name: 'registerAsset',
    type: 'function',
    inputs: [
      { name: 'assetId', type: 'bytes32' },
      { name: 'rwaTokenAddress', type: 'address' },
      { name: 'issuerAddress', type: 'address' },
      { name: 'agreedRateBps', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getDebtSummary',
    type: 'function',
    inputs: [{ name: 'assetId', type: 'bytes32' }],
    outputs: [
      { name: 'principalHeld', type: 'uint256' },
      { name: 'amountWithdrawn', type: 'uint256' },
      { name: 'outstandingDebt', type: 'uint256' },
      { name: 'interestOwed', type: 'uint256' },
      { name: 'totalOwed', type: 'uint256' },
      { name: 'agreedRateBps', type: 'uint256' },
      { name: 'withdrawalTimestamp', type: 'uint256' },
      { name: 'isFullyRepaid', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

const PRIMARY_MARKET_ABI = [
  {
    name: 'registerIssuerVault',
    type: 'function',
    inputs: [
      { name: 'assetId', type: 'bytes32' },
      { name: 'vault', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

@Injectable()
export class IssuerVaultService implements OnModuleInit {
  private readonly logger = new Logger(IssuerVaultService.name);
  private publicClient: any;

  constructor(
    @InjectModel(IssuerVaultPosition.name)
    private readonly vaultModel: Model<IssuerVaultPositionDocument>,
    @InjectModel(Asset.name)
    private readonly assetModel: Model<AssetDocument>,
    private readonly networkRegistryService: NetworkRegistryService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl')!;
    this.publicClient = createPublicClient({
      chain: getActiveChain(),
      transport: http(rpcUrl),
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private assetIdToBytes32(assetId: string): `0x${string}` {
    return ('0x' + assetId.replace(/-/g, '').padEnd(64, '0')) as `0x${string}`;
  }

  private getIssuerVaultAddress(): Address {
    const adapter = this.networkRegistryService.getContractAdapter();
    return adapter.getContractAddress('IssuerVault') as Address;
  }

  private getPrimaryMarketAddress(): Address {
    const adapter = this.networkRegistryService.getContractAdapter();
    return adapter.getContractAddress('PrimaryMarket') as Address;
  }

  // ─── Admin actions ────────────────────────────────────────────────────────────

  /**
   * Create a vault record for an asset and register it on-chain.
   * Must be called before createListing() so PrimaryMarket routing is ready.
   */
  async createVaultForAsset(dto: CreateIssuerVaultDto): Promise<IssuerVaultPosition> {
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);
    if (!asset.token?.address) throw new BadRequestException('Asset must be tokenized before vault creation');

    const existingVault = await this.vaultModel.findOne({ assetId: dto.assetId });
    if (existingVault) throw new BadRequestException('IssuerVault already exists for this asset');

    const assetIdBytes32 = this.assetIdToBytes32(dto.assetId);
    const issuerVaultAddress = this.getIssuerVaultAddress();
    const primaryMarketAddress = this.getPrimaryMarketAddress();

    // 1. Register asset slot in IssuerVault contract (admin wallet signs)
    const adminWallet = this.networkRegistryService.getAdminWallet();

    const registerTxHash = await (adminWallet as any).writeContract({
      address: issuerVaultAddress,
      abi: ISSUER_VAULT_ABI,
      functionName: 'registerAsset',
      args: [
        assetIdBytes32,
        asset.token.address as Address,
        asset.originator as Address,
        BigInt(dto.agreedRateBps),
      ],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: registerTxHash });

    // 2. Register vault routing on PrimaryMarket so USDC goes directly to IssuerVault
    const routeTxHash = await (adminWallet as any).writeContract({
      address: primaryMarketAddress,
      abi: PRIMARY_MARKET_ABI,
      functionName: 'registerIssuerVault',
      args: [assetIdBytes32, issuerVaultAddress],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: routeTxHash });

    // 3. Persist to DB — the canonical source of truth synced with on-chain
    const position = await this.vaultModel.create({
      assetId: dto.assetId,
      assetIdBytes32,
      tokenAddress: asset.token.address,
      issuerAddress: asset.originator,
      agreedRateBps: dto.agreedRateBps,
      principalHeld: '0',
      amountWithdrawn: '0',
      outstandingDebt: '0',
      totalInterestPaid: '0',
      withdrawalTimestamp: 0,
      status: IssuerVaultStatus.PENDING_LISTING,
      network: this.configService.get<string>('NETWORK_TYPE') as NetworkType || NetworkType.HASHKEY,
      contractAddress: issuerVaultAddress,
    });

    this.logger.log(`IssuerVault created for asset ${dto.assetId}, registerTx=${registerTxHash}, routeTx=${routeTxHash}`);
    return position;
  }

  // ─── Sync from chain ──────────────────────────────────────────────────────────

  /**
   * Pull current debt state from chain and update DB.
   * Called by the event listener on DepositReceived / DebtRepaid events,
   * and by getDebtSummary for on-demand reconciliation.
   */
  async syncFromChain(assetId: string): Promise<void> {
    const position = await this.vaultModel.findOne({ assetId });
    if (!position) return;

    const assetIdBytes32 = this.assetIdToBytes32(assetId);
    const issuerVaultAddress = this.getIssuerVaultAddress();

    try {
      const [
        principalHeld,
        amountWithdrawn,
        outstandingDebt,
        interestOwed,
        ,
        agreedRateBps,
        withdrawalTimestamp,
        isFullyRepaid,
      ] = await this.publicClient.readContract({
        address: issuerVaultAddress,
        abi: ISSUER_VAULT_ABI,
        functionName: 'getDebtSummary',
        args: [assetIdBytes32],
      }) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];

      // Determine status based on chain state
      let status = position.status;
      if (isFullyRepaid) {
        status = IssuerVaultStatus.REPAID;
      } else if (Number(outstandingDebt) > 0) {
        status = Number(position.totalInterestPaid) > 0
          ? IssuerVaultStatus.REPAYING
          : IssuerVaultStatus.DEBT_ACTIVE;
      } else if (Number(amountWithdrawn) === 0 && Number(principalHeld) > 0) {
        status = IssuerVaultStatus.SALE_COMPLETE;
      }

      await this.vaultModel.updateOne(
        { assetId },
        {
          $set: {
            principalHeld: principalHeld.toString(),
            amountWithdrawn: amountWithdrawn.toString(),
            outstandingDebt: outstandingDebt.toString(),
            agreedRateBps: Number(agreedRateBps),
            withdrawalTimestamp: Number(withdrawalTimestamp),
            status,
          },
        },
      );
    } catch (err: any) {
      this.logger.error(`syncFromChain failed for ${assetId}: ${err.message}`);
    }
  }

  // ─── Read ─────────────────────────────────────────────────────────────────────

  async getDebtSummary(assetId: string): Promise<DebtSummaryResponse> {
    const position = await this.vaultModel.findOne({ assetId });
    if (!position) throw new NotFoundException(`IssuerVault not found for asset ${assetId}`);

    // Sync from chain for live interest figure
    await this.syncFromChain(assetId);
    const fresh = await this.vaultModel.findOne({ assetId });

    // Interest is live-read from chain (not stored, to avoid stale value)
    const assetIdBytes32 = this.assetIdToBytes32(assetId);
    let interestOwed = '0';
    try {
      const result = await this.publicClient.readContract({
        address: this.getIssuerVaultAddress(),
        abi: ISSUER_VAULT_ABI,
        functionName: 'getDebtSummary',
        args: [assetIdBytes32],
      }) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];
      interestOwed = result[3].toString();
    } catch (_) {}

    const outstandingDebt = BigInt(fresh!.outstandingDebt);
    const totalOwed = (outstandingDebt + BigInt(interestOwed)).toString();

    return {
      assetId,
      principalHeld: fresh!.principalHeld,
      amountWithdrawn: fresh!.amountWithdrawn,
      outstandingDebt: fresh!.outstandingDebt,
      interestOwed,
      totalOwed,
      agreedRateBps: fresh!.agreedRateBps,
      withdrawalTimestamp: fresh!.withdrawalTimestamp,
      isFullyRepaid: fresh!.status === IssuerVaultStatus.REPAID,
      status: fresh!.status,
      contractAddress: fresh!.contractAddress,
    };
  }

  async getAllVaults(): Promise<IssuerVaultPosition[]> {
    return this.vaultModel.find().sort({ createdAt: -1 }).lean();
  }

  async getVaultByAsset(assetId: string): Promise<IssuerVaultPosition> {
    const v = await this.vaultModel.findOne({ assetId });
    if (!v) throw new NotFoundException(`IssuerVault not found for asset ${assetId}`);
    return v;
  }

  // ─── Event-driven DB updates (called by event listener) ──────────────────────

  async handleDepositReceived(assetId: string, amount: string): Promise<void> {
    await this.vaultModel.updateOne(
      { assetId },
      {
        $inc: { principalHeld: 0 }, // trigger syncFromChain instead of manual math
        $set: { status: IssuerVaultStatus.SALE_ACTIVE },
      },
    );
    // Authoritative sync from chain to avoid any arithmetic drift
    await this.syncFromChain(assetId);
    this.logger.log(`DepositReceived synced for asset ${assetId}: +${amount}`);
  }

  async handleLiquidityWithdrawn(assetId: string): Promise<void> {
    await this.syncFromChain(assetId);
    this.logger.log(`LiquidityWithdrawn synced for asset ${assetId}`);
  }

  async handleDebtRepaid(assetId: string): Promise<void> {
    await this.syncFromChain(assetId);
    this.logger.log(`DebtRepaid synced for asset ${assetId}`);
  }

  async handleVaultFullyRepaid(assetId: string, txHash: string): Promise<void> {
    await this.vaultModel.updateOne(
      { assetId },
      {
        $set: {
          status: IssuerVaultStatus.REPAID,
          yieldDistributionTxHash: txHash,
        },
      },
    );
    await this.syncFromChain(assetId);
    this.logger.log(`VaultFullyRepaid for asset ${assetId}, yieldTx=${txHash}`);
  }
}
