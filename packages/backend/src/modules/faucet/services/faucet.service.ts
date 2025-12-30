import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, Address } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { WalletService } from '../../blockchain/services/wallet.service';

@Injectable()
export class FaucetService {
  private readonly logger = new Logger(FaucetService.name);
  private publicClient;
  private readonly FIXED_AMOUNT = '1000'; // Fixed 1000 USDC
  private requestQueue: Promise<any> = Promise.resolve(); // Mutex for serializing requests

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    private walletService: WalletService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  async requestUsdc(receiverAddress: string): Promise<{ hash: string; amount: string; receiverAddress: string }> {
    // Serialize all faucet requests using a queue to prevent nonce conflicts
    return this.requestQueue = this.requestQueue.then(
      () => this.executeRequest(receiverAddress),
      () => this.executeRequest(receiverAddress), // Execute even if previous request failed
    );
  }

  private async executeRequest(receiverAddress: string): Promise<{ hash: string; amount: string; receiverAddress: string }> {
    try {
      const wallet = this.walletService.getAdminWallet();
      const faucetAddress = this.contractLoader.getContractAddress('Faucet');
      const faucetAbi = this.contractLoader.getContractAbi('Faucet');
      const usdcAddress = this.contractLoader.getContractAddress('USDC');
      const usdcAbi = this.contractLoader.getContractAbi('USDC');

      this.logger.log(`Requesting ${this.FIXED_AMOUNT} USDC for ${receiverAddress}`);
      this.logger.log(`Faucet contract: ${faucetAddress}`);
      this.logger.log(`USDC contract: ${usdcAddress}`);
      this.logger.log(`Admin wallet: ${wallet.account.address}`);

      // Get receiver's USDC balance before
      const balanceBefore = await this.publicClient.readContract({
        address: usdcAddress as Address,
        abi: usdcAbi,
        functionName: 'balanceOf',
        args: [receiverAddress as Address],
      }) as bigint;

      this.logger.log(`Receiver balance before: ${Number(balanceBefore) / 1e6} USDC`);

      // Get current nonce explicitly to avoid conflicts
      const currentNonce = await this.publicClient.getTransactionCount({
        address: wallet.account.address as Address,
        blockTag: 'pending', // Use pending to include pending transactions
      });

      this.logger.log(`Current nonce: ${currentNonce}`);

      // Step 1: Call requestUSDC on the Faucet contract (mints to admin wallet)
      this.logger.log(`Step 1: Requesting ${this.FIXED_AMOUNT} USDC from faucet to admin wallet...`);
      const requestHash = await wallet.writeContract({
        address: faucetAddress as Address,
        abi: faucetAbi,
        functionName: 'requestUSDC',
        args: [this.FIXED_AMOUNT],
        nonce: currentNonce, // Explicit nonce
      });

      this.logger.log(`Request transaction submitted: ${requestHash} (nonce: ${currentNonce})`);
      await this.publicClient.waitForTransactionReceipt({
        hash: requestHash,
        timeout: 180_000,
        pollingInterval: 2_000,
      });
      this.logger.log(`USDC minted to admin wallet`);

      // Step 2: Transfer USDC from admin wallet to receiver
      const amountWei = BigInt(this.FIXED_AMOUNT) * BigInt(10 ** 6); // Convert to 6 decimals
      this.logger.log(`Step 2: Transferring ${this.FIXED_AMOUNT} USDC to ${receiverAddress}...`);

      // Use next nonce (currentNonce + 1)
      const transferHash = await wallet.writeContract({
        address: usdcAddress as Address,
        abi: usdcAbi,
        functionName: 'transfer',
        args: [receiverAddress as Address, amountWei],
        nonce: currentNonce + 1, // Explicit nonce for second transaction
      });

      this.logger.log(`Transfer transaction submitted: ${transferHash} (nonce: ${currentNonce + 1})`);
      await this.publicClient.waitForTransactionReceipt({
        hash: transferHash,
        timeout: 180_000,
        pollingInterval: 2_000,
      });

      this.logger.log(`Transfer confirmed`);

      // Get receiver's USDC balance after
      const balanceAfter = await this.publicClient.readContract({
        address: usdcAddress as Address,
        abi: usdcAbi,
        functionName: 'balanceOf',
        args: [receiverAddress as Address],
      }) as bigint;

      const received = Number(balanceAfter - balanceBefore) / 1e6;
      this.logger.log(`Receiver balance after: ${Number(balanceAfter) / 1e6} USDC`);
      this.logger.log(`Received: ${received} USDC`);

      return {
        hash: transferHash, // Return the transfer transaction hash
        amount: this.FIXED_AMOUNT,
        receiverAddress,
      };
    } catch (error: any) {
      this.logger.error(`Failed to request USDC for ${receiverAddress}`);
      this.logger.error(error);
      throw error;
    }
  }
}
