import { NetworkType } from '@openassets/types';
import { ContractAdapter } from '../adapters/contract-adapter.interface';
import { BlockchainAdapter } from '../adapters/blockchain-adapter.interface';
import { PaymentAdapter } from '../adapters/payment-adapter.interface';
import { WalletAdapter } from '../adapters/wallet-adapter.interface';

export interface ChainManager {
  getType(): NetworkType;
  getContractAdapter(): ContractAdapter;
  getBlockchainAdapter(): BlockchainAdapter;
  getPaymentAdapter(): PaymentAdapter;
  getWalletAdapter(): WalletAdapter;
  getAdminWallet(): any; // Returns a viem WalletClient or similar for the network admin
  startBackgroundOperations(): Promise<void>;
  stopBackgroundOperations(): Promise<void>;
}

