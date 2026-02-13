import { registerAs } from '@nestjs/config';

export enum NetworkType {
  MANTLE = 'mantle',
  STELLAR = 'stellar',
}

export default registerAs('network', () => {
  const networkType = (process.env.NETWORK_TYPE as NetworkType) || NetworkType.MANTLE;

  const isMantle = networkType === NetworkType.MANTLE;
  const isStellar = networkType === NetworkType.STELLAR;

  return {
    networkType,
    networkName: isMantle ? 'Mantle Sepolia' : 'Stellar Testnet',
    isTestnet: true, // For now both are testnets

    // Feature Availability Map
    features: {
      leverage: isMantle,
      faucet: isMantle,
      solvency: isMantle,
      secondaryMarket: isMantle, // Initially false for Stellar , will be true for both later
      oaid: isMantle, // will be tue for both later
      methPrice: isMantle,
      fluxionDex: isMantle,
      marketplace: true, // Both support marketplace
      partners: isMantle,
      yield: true, // Both support yield distribution
      kyc: true,
      assets: true,
      auth: true,
    },

    // Stellar specific connection params (only needed if networkType is stellar)
    stellar: isStellar ? {
      rpcUrl: process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
      horizonUrl: process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
      networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
      adminSecret: process.env.STELLAR_ADMIN_SECRET,
      platformSecret: process.env.STELLAR_PLATFORM_SECRET,
      contracts: {
        attestationRegistry: process.env.STELLAR_ATTESTATION_REGISTRY_CONTRACT_ID,
        identityRegistry: process.env.STELLAR_IDENTITY_REGISTRY_CONTRACT_ID,
        assetCoordinator: process.env.STELLAR_ASSET_COORDINATOR_CONTRACT_ID,
        primaryMarket: process.env.STELLAR_PRIMARY_MARKET_CONTRACT_ID,
        yieldVault: process.env.STELLAR_YIELD_VAULT_CONTRACT_ID,
        trustedIssuersRegistry: process.env.STELLAR_TRUSTED_ISSUERS_REGISTRY_CONTRACT_ID,
      },
    } : null,
  };
});
