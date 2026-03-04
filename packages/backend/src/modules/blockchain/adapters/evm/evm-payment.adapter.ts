import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { PaymentAdapter, PaymentTransferResult } from '../payment-adapter.interface';
import * as fs from 'fs';
import * as path from 'path';

/**
 * EVM Payment Adapter
 * 
 * Handles USDC transfers on EVM-compatible chains (Mantle, Ethereum, etc.)
 * Uses ethers.js for ERC-20 token interactions.
 * 
 * Responsibilities:
 * - Transfer USDC from platform wallet to recipients
 * - Query platform USDC balance
 * - Format amounts for human readability
 * 
 * Configuration Required:
 * - PLATFORM_PRIVATE_KEY: Platform wallet private key
 * - blockchain.rpcUrl: EVM RPC endpoint
 * - deployed_contracts.json: Must contain 'USDC' contract address
 */
@Injectable()
export class EvmPaymentAdapter implements PaymentAdapter {
  private readonly logger = new Logger(EvmPaymentAdapter.name);
  private readonly USDC_DECIMALS = 6; // USDC has 6 decimals
  
  private readonly USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
  ];

  constructor(
    private readonly configService: ConfigService,
  ) {}

  private getUsdcContract(): { contract: ethers.Contract; wallet: ethers.Wallet; address: string } {
    const platformPrivateKey = this.configService.get<string>('PLATFORM_PRIVATE_KEY');
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl');

    if (!platformPrivateKey) {
      throw new Error('PLATFORM_PRIVATE_KEY not configured');
    }

    if (!rpcUrl) {
      throw new Error('blockchain.rpcUrl not configured');
    }

    // Read deployed contracts for USDC address
    const deployedContractsPath = path.join(process.cwd(), '../contracts/deployed_contracts.json');
    
    if (!fs.existsSync(deployedContractsPath)) {
      throw new Error(`deployed_contracts.json not found at ${deployedContractsPath}`);
    }

    const deployedContracts = JSON.parse(fs.readFileSync(deployedContractsPath, 'utf-8'));
    const usdcAddress = deployedContracts.contracts?.USDC;

    if (!usdcAddress) {
      throw new Error('USDC address not found in deployed_contracts.json');
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(platformPrivateKey, provider);
    const contract = new ethers.Contract(usdcAddress, this.USDC_ABI, wallet);

    return { contract, wallet, address: usdcAddress };
  }

  async transferStablecoin(
    recipient: string,
    amount: string | bigint,
  ): Promise<PaymentTransferResult> {
    const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
    
    this.logger.log(`💸 Preparing USDC transfer:`);
    this.logger.log(`   Recipient: ${recipient}`);
    this.logger.log(`   Amount: ${amountBigInt.toString()} (${Number(amountBigInt) / 10 ** this.USDC_DECIMALS} USDC)`);

    const { contract, wallet } = this.getUsdcContract();

    // Check platform balance
    const balance = (await contract.balanceOf!(wallet.address)) as bigint;
    this.logger.log(`   Platform Balance: ${balance.toString()} (${Number(balance) / 10 ** this.USDC_DECIMALS} USDC)`);

    if (balance < amountBigInt) {
      const balanceFormatted = (Number(balance) / 10 ** this.USDC_DECIMALS).toFixed(2);
      const neededFormatted = (Number(amountBigInt) / 10 ** this.USDC_DECIMALS).toFixed(2);
      throw new Error(
        `Insufficient USDC balance. Have: ${balanceFormatted} USDC, Need: ${neededFormatted} USDC`
      );
    }

    // Execute transfer
    this.logger.log(`   Executing USDC transfer...`);
    const tx = (await contract.transfer!(recipient, amountBigInt)) as any;
    this.logger.log(`   Transaction submitted: ${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait();
    this.logger.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}`);

    const amountFormatted = `${(Number(amountBigInt) / 10 ** this.USDC_DECIMALS).toFixed(2)} USDC`;

    return {
      txId: tx.hash,
      blockNumber: Number(receipt.blockNumber),
      amount: amountBigInt.toString(),
      amountFormatted,
      recipient,
      timestamp: Math.floor(Date.now() / 1000),
      tokenSymbol: 'USDC',
    };
  }

  async getPlatformStablecoinBalance(): Promise<string> {
    const { contract, wallet } = this.getUsdcContract();
    const balance = (await contract.balanceOf!(wallet.address)) as bigint;
    return balance.toString();
  }

  async getStablecoinSymbol(): Promise<string> {
    return 'USDC';
  }

  async getStablecoinIdentifier(): Promise<string> {
    const { address } = this.getUsdcContract();
    return address;
  }

  async getStablecoinDecimals(): Promise<number> {
    return this.USDC_DECIMALS;
  }
}
