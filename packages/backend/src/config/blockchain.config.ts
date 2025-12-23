import { registerAs } from '@nestjs/config';

export default registerAs('blockchain', () => ({
  rpcUrl: process.env.MANTLE_RPC_URL || 'https://rpc.sepolia.mantle.xyz',
  chainId: parseInt(process.env.CHAIN_ID, 10) || 5003, // Mantle Sepolia
  
  // Wallets
  adminPrivateKey: process.env.ADMIN_PRIVATE_KEY,
  platformPrivateKey: process.env.PLATFORM_PRIVATE_KEY,
  custodyAddress: process.env.CUSTODY_WALLET_ADDRESS,

  // Contract Addresses (Env overrides or defaults from deployed_contracts.json)
  contracts: {
    attestationRegistry: process.env.ATTESTATION_REGISTRY_ADDRESS,
    identityRegistry: process.env.IDENTITY_REGISTRY_ADDRESS,
    tokenFactory: process.env.TOKEN_FACTORY_ADDRESS,
    yieldVault: process.env.YIELD_VAULT_ADDRESS,
    primaryMarketplace: process.env.PRIMARY_MARKETPLACE_ADDRESS,
  }
}));
