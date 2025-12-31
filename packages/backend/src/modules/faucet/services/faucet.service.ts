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
  private readonly USDC_AMOUNT = '1000'; // Fixed 1000 USDC
  private readonly METH_AMOUNT = '10'; // Fixed 10 mETH
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

      this.logger.log(`Requesting ${this.USDC_AMOUNT} USDC for ${receiverAddress}`);
      this.logger.log(`Faucet contract: ${faucetAddress}`);
      this.logger.log(`USDC contract: ${usdcAddress}`);

      // Get receiver's USDC balance before
      const balanceBefore = await this.publicClient.readContract({
        address: usdcAddress as Address,
        abi: usdcAbi,
        functionName: 'balanceOf',
        args: [receiverAddress as Address],
      }) as bigint;

      this.logger.log(`Receiver balance before: ${Number(balanceBefore) / 1e6} USDC`);

      // NEW: Single transaction - Call requestUSDC on Faucet contract with receiver address
      this.logger.log(`Calling Faucet.requestUSDC(${receiverAddress}, ${this.USDC_AMOUNT})...`);
      const requestHash = await wallet.writeContract({
        address: faucetAddress as Address,
        abi: faucetAbi,
        functionName: 'requestUSDC',
        args: [receiverAddress as Address, this.USDC_AMOUNT],
      });

      this.logger.log(`Faucet transaction submitted: ${requestHash}`);
      await this.publicClient.waitForTransactionReceipt({
        hash: requestHash,
        timeout: 180_000,
        pollingInterval: 2_000,
      });

      this.logger.log(`USDC minted directly to receiver`);

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
        hash: requestHash,
        amount: this.USDC_AMOUNT,
        receiverAddress,
      };
    } catch (error: any) {
      this.logger.error(`Failed to request USDC for ${receiverAddress}`, error);
      throw error;
    }
  }

  async requestMeth(receiverAddress: string): Promise<{ hash: string; amount: string; receiverAddress: string }> {
    try {
      const wallet = this.walletService.getAdminWallet();
      const methFaucetAddress = this.contractLoader.getContractAddress('METHFaucet');
      const methFaucetAbi = this.contractLoader.getContractAbi('METHFaucet');
      const methAddress = this.contractLoader.getContractAddress('MockMETH');
      const methAbi = this.contractLoader.getContractAbi('MockMETH');

      this.logger.log(`Requesting ${this.METH_AMOUNT} mETH for ${receiverAddress}`);
      this.logger.log(`METHFaucet contract: ${methFaucetAddress}`);
      this.logger.log(`MockMETH contract: ${methAddress}`);

      // Get receiver's mETH balance before
      const balanceBefore = await this.publicClient.readContract({
        address: methAddress as Address,
        abi: methAbi,
        functionName: 'balanceOf',
        args: [receiverAddress as Address],
      }) as bigint;

      this.logger.log(`Receiver balance before: ${Number(balanceBefore) / 1e18} mETH`);

      // Call requestMETH on METHFaucet contract with receiver address
      this.logger.log(`Calling METHFaucet.requestMETH(${receiverAddress}, ${this.METH_AMOUNT})...`);
      const requestHash = await wallet.writeContract({
        address: methFaucetAddress as Address,
        abi: methFaucetAbi,
        functionName: 'requestMETH',
        args: [receiverAddress as Address, this.METH_AMOUNT],
      });

      this.logger.log(`Faucet transaction submitted: ${requestHash}`);
      await this.publicClient.waitForTransactionReceipt({
        hash: requestHash,
        timeout: 180_000,
        pollingInterval: 2_000,
      });

      this.logger.log(`mETH minted directly to receiver`);

      // Get receiver's mETH balance after
      const balanceAfter = await this.publicClient.readContract({
        address: methAddress as Address,
        abi: methAbi,
        functionName: 'balanceOf',
        args: [receiverAddress as Address],
      }) as bigint;

      const received = Number(balanceAfter - balanceBefore) / 1e18;
      this.logger.log(`Receiver balance after: ${Number(balanceAfter) / 1e18} mETH`);
      this.logger.log(`Received: ${received} mETH`);

      return {
        hash: requestHash,
        amount: this.METH_AMOUNT,
        receiverAddress,
      };
    } catch (error: any) {
      this.logger.error(`Failed to request mETH for ${receiverAddress}`, error);
      throw error;
    }
  }
}
