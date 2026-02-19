import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keypair,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  xdr,
  Asset,
  Operation,
} from '@stellar/stellar-sdk';
import { PaymentAdapter, PaymentTransferResult } from '../payment-adapter.interface';

/**
 * Stellar Payment Adapter
 * 
 * Handles USDC transfers on Stellar network using Soroban smart contracts.
 * Uses Stellar SDK for transaction building and submission.
 * 
 * Responsibilities:
 * - Transfer USDC from platform wallet to recipients via Soroban contract
 * - Query platform USDC balance from contract
 * - Format amounts for human readability
 * 
 * Configuration Required:
 * - STELLAR_PLATFORM_SECRET: Platform wallet secret key
 * - network.stellar.rpcUrl: Soroban RPC endpoint
 * - network.stellar.networkPassphrase: Network passphrase
 * - network.stellar.contracts.usdcContract: USDC Soroban contract ID
 * 
 * USDC on Stellar:
 * - Uses Circle's official USDC (testnet issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5)
 * - Automatically derives Stellar Asset Contract (SAC) ID from classic asset
 * - No configuration needed - works out of the box with Circle's testnet USDC
 * - Config override available via STELLAR_USDC_CONTRACT if needed
 * - Standard Soroban token interface: transfer(), balance(), decimals(), symbol()
 */
@Injectable()
export class StellarPaymentAdapter implements PaymentAdapter {
  private readonly logger = new Logger(StellarPaymentAdapter.name);
  private readonly USDC_DECIMALS = 7; // USDC on Stellar (SAC) has 7 decimals
  private readonly rpcServer: rpc.Server;
  private readonly networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
  ) {
    const rpcUrl = this.configService.get<string>('network.stellar.rpcUrl');
    const passphrase = this.configService.get<string>('network.stellar.networkPassphrase');

    if (!rpcUrl) {
      throw new Error('Stellar RPC URL not configured (network.stellar.rpcUrl)');
    }

    if (!passphrase) {
      throw new Error('Stellar network passphrase not configured (network.stellar.networkPassphrase)');
    }

    this.rpcServer = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.includes('localhost') });
    this.networkPassphrase = passphrase;
  }

  private getPlatformKeypair(): Keypair {
    const platformSecret = this.configService.get<string>('network.stellar.platformSecret');

    if (!platformSecret) {
      throw new Error('STELLAR_PLATFORM_SECRET not configured');
    }

    return Keypair.fromSecret(platformSecret);
  }

  private getUsdcContractId(): string {
    // Try explicit config first (optional override)
    let usdcContractId = this.configService.get<string>('network.stellar.contracts.usdcContract');

    if (!usdcContractId) {
      // Default: Derive SAC (Stellar Asset Contract) from Circle's official USDC
      // Circle USDC issuer on Stellar testnet: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
      // This automatically generates the Soroban contract ID for the wrapped classic asset
      const circleUSDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
      usdcContractId = circleUSDC.contractId(this.networkPassphrase);
      this.logger.log(`Using Circle's USDC SAC (auto-derived): ${usdcContractId}`);
    } else {
      this.logger.log(`Using configured USDC contract: ${usdcContractId}`);
    }

    return usdcContractId;
  }

  async transferStablecoin(
    recipient: string,
    amount: string | bigint,
  ): Promise<PaymentTransferResult> {
    const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
    
    this.logger.log(`💸 Preparing USDC transfer (Stellar):`);
    this.logger.log(`   Recipient: ${recipient}`);
    this.logger.log(`   Amount: ${amountBigInt.toString()} (${Number(amountBigInt) / 10 ** this.USDC_DECIMALS} USDC)`);

    const platformKeypair = this.getPlatformKeypair();
    const usdcContractId = this.getUsdcContractId();
    const usdcContract = new Contract(usdcContractId);

    // Check platform balance first
    const balance = await this.getPlatformStablecoinBalance();
    const balanceBigInt = BigInt(balance);

    this.logger.log(`   Platform Balance: ${balance} (${Number(balanceBigInt) / 10 ** this.USDC_DECIMALS} USDC)`);

    if (balanceBigInt < amountBigInt) {
      const balanceFormatted = (Number(balanceBigInt) / 10 ** this.USDC_DECIMALS).toFixed(2);
      const neededFormatted = (Number(amountBigInt) / 10 ** this.USDC_DECIMALS).toFixed(2);
      throw new Error(
        `Insufficient USDC balance. Have: ${balanceFormatted} USDC, Need: ${neededFormatted} USDC`
      );
    }

    // Build transfer transaction
    // Soroban token interface: transfer(from: Address, to: Address, amount: i128)
    this.logger.log(`   Building transfer transaction...`);

    const source = await this.rpcServer.getAccount(platformKeypair.publicKey());

    const transferTx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      usdcContract.call(
        'transfer',
        new Address(platformKeypair.publicKey()).toScVal(), // from
        new Address(recipient).toScVal(), // to
        xdr.ScVal.scvI128(
          new xdr.Int128Parts({
            lo: xdr.Uint64.fromString(amountBigInt.toString()),
            hi: xdr.Int64.fromString('0'),
          })
        ), // amount as i128
      )
    )
    .setTimeout(60)
    .build();

    // Simulate to get auth and resource costs
    this.logger.log(`   Simulating transaction...`);
    const simResponse = await this.rpcServer.simulateTransaction(transferTx);

    if (rpc.Api.isSimulationError(simResponse)) {
      throw new Error(`Transfer simulation failed: ${JSON.stringify(simResponse)}`);
    }

    // Prepare transaction with simulation results
    const preparedTx = rpc.assembleTransaction(transferTx, simResponse).build();
    preparedTx.sign(platformKeypair);

    // Submit transaction
    this.logger.log(`   Submitting transfer transaction...`);
    const sendResponse = await this.rpcServer.sendTransaction(preparedTx);

    if (sendResponse.status === 'ERROR') {
      throw new Error(`Transfer submission failed: ${JSON.stringify(sendResponse)}`);
    }

    const txHash = sendResponse.hash;
    this.logger.log(`   Transaction submitted: ${txHash}`);

    // Poll for transaction result
    this.logger.log(`   Waiting for confirmation...`);
    let getResponse = await this.rpcServer.getTransaction(txHash);
    
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max
    
    while (getResponse.status === 'NOT_FOUND' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      getResponse = await this.rpcServer.getTransaction(txHash);
      attempts++;
    }

    if (getResponse.status === 'NOT_FOUND') {
      throw new Error(`Transfer transaction not found after ${maxAttempts} seconds`);
    }

    if (getResponse.status === 'FAILED') {
      throw new Error(`Transfer transaction failed: ${JSON.stringify(getResponse)}`);
    }

    const ledgerSequence = getResponse.ledger;
    this.logger.log(`   ✅ Transaction confirmed in ledger ${ledgerSequence}`);

    const amountFormatted = `${(Number(amountBigInt) / 10 ** this.USDC_DECIMALS).toFixed(2)} USDC`;

    return {
      txId: txHash,
      blockNumber: ledgerSequence,
      amount: amountBigInt.toString(),
      amountFormatted,
      recipient,
      timestamp: Math.floor(Date.now() / 1000),
      tokenSymbol: 'USDC',
    };
  }

  async getPlatformStablecoinBalance(): Promise<string> {
    const platformKeypair = this.getPlatformKeypair();
    const usdcContractId = this.getUsdcContractId();
    const usdcContract = new Contract(usdcContractId);

    // Build balance query transaction
    // Soroban token interface: balance(address: Address) -> i128
    const source = await this.rpcServer.getAccount(platformKeypair.publicKey());

    const balanceTx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
    .addOperation(
      usdcContract.call(
        'balance',
        new Address(platformKeypair.publicKey()).toScVal(),
      )
    )
    .setTimeout(60)
    .build();

    // Simulate to get result
    const simResponse = await this.rpcServer.simulateTransaction(balanceTx);

    if (rpc.Api.isSimulationError(simResponse)) {
      throw new Error(`Balance query simulation failed: ${JSON.stringify(simResponse)}`);
    }

    // Parse result from simulation
    const result = simResponse.result?.retval;
    if (!result) {
      throw new Error('No result returned from balance query');
    }

    // Result is i128 - parse it
    const i128 = result.i128();
    const balance = i128.lo().toString(); // For typical USDC amounts, lo is sufficient

    return balance;
  }

  async getStablecoinSymbol(): Promise<string> {
    return 'USDC';
  }

  async getStablecoinIdentifier(): Promise<string> {
    return this.getUsdcContractId();
  }

  async getStablecoinDecimals(): Promise<number> {
    return this.USDC_DECIMALS;
  }
}
