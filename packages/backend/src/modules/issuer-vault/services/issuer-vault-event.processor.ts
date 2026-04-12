import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { IssuerVaultService } from './issuer-vault.service';

/**
 * Processes IssuerVault blockchain events from the shared BullMQ queue.
 * This keeps IssuerVaultService decoupled from BlockchainModule (no circular dep).
 *
 * Each handler calls syncFromChain() to keep the DB in authoritative sync
 * with on-chain state rather than doing manual arithmetic on the event args.
 */
@Processor('event-processing')
export class IssuerVaultEventProcessor extends WorkerHost {
  private readonly logger = new Logger(IssuerVaultEventProcessor.name);

  constructor(private readonly issuerVaultService: IssuerVaultService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'issuer-vault-deposit-received':
        await this.onDepositReceived(job.data);
        break;

      case 'issuer-vault-liquidity-withdrawn':
        await this.onLiquidityWithdrawn(job.data);
        break;

      case 'issuer-vault-debt-repaid':
        await this.onDebtRepaid(job.data);
        break;

      case 'issuer-vault-fully-repaid':
        await this.onFullyRepaid(job.data);
        break;

      default:
        // Not our job — let other processors handle it
        break;
    }
  }

  private async onDepositReceived(data: { assetId: string; amount: string; txHash: string }) {
    this.logger.log(`DepositReceived: asset=${data.assetId} amount=${data.amount} tx=${data.txHash}`);
    await this.issuerVaultService.handleDepositReceived(data.assetId, data.amount);
  }

  private async onLiquidityWithdrawn(data: { assetId: string; amount: string; txHash: string }) {
    this.logger.log(`LiquidityWithdrawn: asset=${data.assetId} amount=${data.amount} tx=${data.txHash}`);
    await this.issuerVaultService.handleLiquidityWithdrawn(data.assetId);
  }

  private async onDebtRepaid(data: { assetId: string; txHash: string }) {
    this.logger.log(`DebtRepaid: asset=${data.assetId} tx=${data.txHash}`);
    await this.issuerVaultService.handleDebtRepaid(data.assetId);
  }

  private async onFullyRepaid(data: { assetId: string; totalInterest: string; txHash: string }) {
    this.logger.log(`VaultFullyRepaid: asset=${data.assetId} interest=${data.totalInterest} tx=${data.txHash}`);
    await this.issuerVaultService.handleVaultFullyRepaid(data.assetId, data.txHash);
  }
}
