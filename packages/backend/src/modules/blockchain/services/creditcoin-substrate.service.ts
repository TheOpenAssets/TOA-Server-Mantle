import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { encodeAddress } from '@polkadot/util-crypto';

interface CreditHistory {
  totalDeals: number;
  completedDeals: number;
  defaultCount: number;
  totalRepayments: number;
}

interface CacheEntry {
  score: number;
  cachedAt: number;
}

@Injectable()
export class CreditcoinSubstrateService {
  private readonly logger = new Logger(CreditcoinSubstrateService.name);
  private api: ApiPromise | null = null;
  private scoreCache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(private readonly configService: ConfigService) {}

  private async getApi(): Promise<ApiPromise> {
    if (this.api && this.api.isConnected) {
      return this.api;
    }

    const wsUrl =
      this.configService.get<string>('blockchain.substrateRpcUrl') ??
      'wss://rpc.cc3-testnet.creditcoin.network';

    try {
      const provider = new WsProvider(wsUrl);
      this.api = await ApiPromise.create({ provider });
      this.logger.log(`Connected to Creditcoin Substrate node at ${wsUrl}`);
      return this.api;
    } catch (error) {
      this.logger.error(`Failed to connect to Creditcoin Substrate node at ${wsUrl}`, error);
      throw error;
    }
  }

  mapEvmToSubstrate(evmAddress: string): string {
    try {
      const stripped = evmAddress.replace('0x', '');
      // EVM address is 20 bytes (40 hex chars); pad to 32 bytes (64 hex chars) with 12 leading zero bytes
      const padded = '0'.repeat(24) + stripped;
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
      }
      return encodeAddress(bytes, 42);
    } catch (error) {
      this.logger.error(`Failed to map EVM address to Substrate SS58: ${evmAddress}`, error);
      return '';
    }
  }

  private async fetchCreditHistory(ss58Address: string): Promise<CreditHistory> {
    try {
      const api = await this.getApi();

      let totalDeals = 0;
      let completedDeals = 0;
      let defaultCount = 0;
      let totalRepayments = 0;

      try {
        const dealEntries = await (api.query as any).creditcoin.dealOrders.entries();
        for (const [, value] of dealEntries) {
          const deal = value.toHuman() as any;
          if (!deal) continue;
          const borrower = deal.borrower ?? deal.loanTerms?.borrower ?? '';
          const lender = deal.lender ?? deal.loanTerms?.lender ?? '';
          if (borrower !== ss58Address && lender !== ss58Address) continue;
          totalDeals++;
          const status: string = deal.status ?? '';
          if (status === 'Closed' || status === 'Repaid') {
            completedDeals++;
          } else if (status === 'FailedToComplete' || status === 'Defaulted') {
            defaultCount++;
          }
        }
      } catch (dealError) {
        this.logger.warn(
          `Could not query dealOrders from Creditcoin Substrate — falling back to zero deals`,
          dealError,
        );
      }

      try {
        const repaymentEntries = await (api.query as any).creditcoin.repaymentOrders.entries();
        for (const [, value] of repaymentEntries) {
          const repayment = value.toHuman() as any;
          if (!repayment) continue;
          const borrower = repayment.borrower ?? repayment.accountId ?? '';
          const lender = repayment.lender ?? '';
          if (borrower === ss58Address || lender === ss58Address) {
            totalRepayments++;
          }
        }
      } catch (repaymentError) {
        this.logger.warn(
          `Could not query repaymentOrders from Creditcoin Substrate — falling back to zero repayments`,
          repaymentError,
        );
      }

      return { totalDeals, completedDeals, defaultCount, totalRepayments };
    } catch (error) {
      this.logger.warn(
        `fetchCreditHistory failed for ${ss58Address} — returning zero history`,
        error,
      );
      return { totalDeals: 0, completedDeals: 0, defaultCount: 0, totalRepayments: 0 };
    }
  }

  async getProtocolScore(evmAddress: string): Promise<number> {
    try {
      const normalizedAddress = evmAddress.toLowerCase();

      const cached = this.scoreCache.get(normalizedAddress);
      if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
        return cached.score;
      }

      const ss58Address = this.mapEvmToSubstrate(evmAddress);
      if (!ss58Address) {
        return 0;
      }

      const { completedDeals, totalRepayments, defaultCount } =
        await this.fetchCreditHistory(ss58Address);

      const rawScore = completedDeals * 80 + totalRepayments * 30 - defaultCount * 200;
      const score = Math.max(0, Math.min(1000, rawScore));

      this.scoreCache.set(normalizedAddress, { score, cachedAt: Date.now() });
      return score;
    } catch (error) {
      this.logger.warn(
        `getProtocolScore failed for ${evmAddress} — returning 0`,
        error,
      );
      return 0;
    }
  }

  clearCache(walletAddress: string): void {
    this.scoreCache.delete(walletAddress.toLowerCase());
  }
}
