import { ContractName } from '@openassets/types';

// ─── HashKey Testnet (Chain ID 133) ──────────────────────────────────────────
export const HashkeyContracts: Partial<Record<ContractName, string>> = {
  AttestationRegistry:    '0xb1cA9a7E7B868ddeF6155162378a015E27A6A31f',
  TrustedIssuersRegistry: '0xFcC80BA006866BBeff8c725185C8865C681619E4',
  IdentityRegistry:       '0x017AE84aD2e5F554D61cc56d189C2782e1204cEF',
  YieldVault:             '0xe2F84b7Fd58e7e93b96822bE9949d00F664F9957',
  TokenFactory:           '0x27bCC249e76B6896cf0728818A9A1eF4dd7AfC3a',
  PrimaryMarket:          '0x5DA2DB688A19d8ca174D1555FE6796d65F820BF5',
  IssuerVault:            '0x77f1C34Da561Dd38252277a8f1aEb8E14583b398', // TODO: update after IssuerVault deploy
  MockUSDC:               '0x3942C93fcB4C9bAA251A2959F745621105a40e0B',
  MockMETH:               '0xb7aA4B194CAC761F4f4F8e267B4D6875666c839A',
  MockFluxionDEX:         '0xA5A7d685d04687281a97083D9121b883d2bE8f15',
  FluxionIntegration:     '0x9bE5A77D7bc12179c81a6b5f2B4207F06aEEeEdb',
  LeverageVault:          '0xe485F72dB0a74118Aeb2671307721E068cf4Ea2C',
  SeniorPool:             '0xe9eD009b7D7ea61E619A9FC44077Fd3A618aBB40',
  OAID:                   '0x721D8Ad6EC55DaC46612b7f3432Db6dc16EE056A',
  SolvencyVault:          '0x921a4D2D465f4Ee450d4E351663dBf3d0aD75b9D',
  SecondaryMarket:        '0x5D1D15626A0Ee5cF6D5417E6E336E44cAc3b6DEa',
} as const;

// ─── Mantle Sepolia Testnet ───────────────────────────────────────────────────
export const MantleContracts: Partial<Record<ContractName, string>> = {
  AttestationRegistry: '0x03FE7d3736402D140659e7bD92B64808E31C3f51',
  TrustedIssuersRegistry: '0xf63B563b6D438122cBC87f4356e60b8BB3Bc53E2',
  IdentityRegistry: '0x2E310C62A225033055E88B690F8d054ece8bcbC4',
  YieldVault: '0xa05bDf67483EB6ba5CcA0dc81543DeD5Ed845Da7',
  TokenFactory: '0x7C75795Cf41ee32fB4FEB89964d7591F0a44BcfE',
  PrimaryMarket: '0x7D8ac3ff7E7fd1a577ff778922Cc568be669beE0',
  MockUSDC: '0x9A54Bad93a00Bf1232D4e636f5e53055Dc0b8238',
  MockMETH: '0x4Ade8aAa0143526393EcadA836224EF21aBC6ac6',
  METHFaucet: '0xB50d0AC5D59E456C1f3EdB66403fd27eEbd155dB',
  MockFluxionDEX: '0x882eA0d81d445CF9e696869af4D007008281892D',
  SeniorPool: '0x9E5F4DD0178C08f27cC5Bd3E0e75Ed339385B346',
  FluxionIntegration: '0xBf74A4CE5B8D1Aad592A3776e10537Ad27dA28Eb',
  LeverageVault: '0x5EC05eBFA8AD682d09C8Ef99c1f15844Abe415BF',
  Faucet: '0x26Da2F1a2de3295302Fd95eBA1A183dc8Ffd77a3',
  OAID: '0xcc24b78Fa213304085684833597Fdc6CB5c8DfB0',
  SolvencyVault: '0x039cB576d9F7D77d6bE0269E0904B6ceFA845C6B',
  SecondaryMarket: '0x5D1D15626A0Ee5cF6D5417E6E336E44cAc3b6DEa'
} as const;
