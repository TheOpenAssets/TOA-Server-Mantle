import { registerAs } from '@nestjs/config';

export enum NetworkType {
  MANTLE = 'mantle',
  STELLAR = 'stellar',
  ARBITRUM = 'arbitrum',
}

export default registerAs('network', () => {
  const networkType = (process.env.NETWORK_TYPE as NetworkType) || NetworkType.MANTLE;

  const isMantle = networkType === NetworkType.MANTLE;
  const isStellar = networkType === NetworkType.STELLAR;
  const isArbitrum = networkType === NetworkType.ARBITRUM;

  return {
    networkType,
    networkName: isMantle ? 'Mantle Sepolia' : isArbitrum ? 'Arbitrum Sepolia' : 'Stellar Testnet',
    isTestnet: true, // For now all are testnets

    // Feature Availability Map
    features: {
      leverage: isMantle || isArbitrum,
      faucet: isMantle || isArbitrum,
      solvency: isMantle || isArbitrum,
      secondaryMarket: isMantle || isArbitrum, // Initially false for Stellar , will be true for all later
      oaid: isMantle || isArbitrum, // will be true for all later
      collateralPrice: isMantle || isArbitrum, // Replaces methPrice - works for both mETH and stARB
      collateralDex: isMantle || isArbitrum, // Replaces fluxionDex - works for both DEXs
      marketplace: true, // All support marketplace
      partners: isMantle || isArbitrum,
      yield: true, // All support yield distribution
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
      adminPublic: process.env.STELLAR_ADMIN_PUBLIC,
      platformSecret: process.env.STELLAR_PLATFORM_SECRET,
      contracts: {
        attestationRegistry: process.env.STELLAR_ATTESTATION_REGISTRY_CONTRACT_ID,
        identityRegistry: process.env.STELLAR_IDENTITY_REGISTRY_CONTRACT_ID,
        assetCoordinator: process.env.STELLAR_ASSET_COORDINATOR_CONTRACT_ID,
        primaryMarket: process.env.STELLAR_PRIMARY_MARKET_CONTRACT_ID,
        yieldVault: process.env.STELLAR_YIELD_VAULT_CONTRACT_ID,
        trustedIssuersRegistry: process.env.STELLAR_TRUSTED_ISSUERS_REGISTRY_CONTRACT_ID,
        // Circle USDC SAC address on Stellar testnet (used for auction bid deposits)
        usdcContract: process.env.STELLAR_USDC_CONTRACT,
      },
    } : null,
  };
});
