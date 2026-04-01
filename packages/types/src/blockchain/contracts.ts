export const ContractNameRegistry = {
  // Cross-network
  AttestationRegistry: 'AttestationRegistry',
  IdentityRegistry: 'IdentityRegistry',
  TokenFactory: 'TokenFactory',
  YieldVault: 'YieldVault',
  PrimaryMarket: 'PrimaryMarket',
  SecondaryMarket: 'SecondaryMarket',
  TrustedIssuersRegistry: 'TrustedIssuersRegistry',

  // EVM-shared
  SolvencyVault: 'SolvencyVault',
  LeverageVault: 'LeverageVault',
  SeniorPool: 'SeniorPool',
  OAID: 'OAID',
  MockUSDC: 'MockUSDC',

  // Mantle-only
  FluxionIntegration: 'FluxionIntegration',
  MockFluxionDEX: 'MockFluxionDEX',
  MockMETH: 'MockMETH',
  METHFaucet: 'METHFaucet',
  Faucet: 'Faucet',
  RWAToken: 'RWAToken',
  PrivateAssetToken: 'PrivateAssetToken',
  ComplianceModule: 'ComplianceModule',

  // BNB leverage
  BNBLeverageVault: 'BNBLeverageVault',
  BNBSwapIntegration: 'BNBSwapIntegration',
  MockBNBDEX: 'MockBNBDEX',
  AnkrBNB: 'AnkrBNB',

  // Legacy aliases (kept for backward compatibility)
  StARBLeverageVault: 'StARBLeverageVault',
  ArbitrumSwapIntegration: 'ArbitrumSwapIntegration',
  MockStARB: 'MockStARB',
  MockArbitrumDEX: 'MockArbitrumDEX',

  // Credit Coin-only
  CTCLeverageVault: 'CTCLeverageVault',
  CTCDEXIntegration: 'CTCDEXIntegration',
  MockCTC: 'MockCTC',
  MockCTCDEX: 'MockCTCDEX',
  CTCFaucet: 'CTCFaucet',

  // Stellar-only
  AssetRegistry: 'AssetRegistry',

  // Creditcoin USC
  USCCreditVerifier: 'USCCreditVerifier',

  // Creditcoin Partner Gateway
  MockPartnerProtocol: 'MockPartnerProtocol',
} as const;

export type ContractName = keyof typeof ContractNameRegistry;
