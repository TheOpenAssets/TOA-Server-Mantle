import AttestationRegistry from '../../artifacts/contracts/core/AttestationRegistry.sol/AttestationRegistry.json';
import IdentityRegistry from '../../artifacts/contracts/core/IdentityRegistry.sol/IdentityRegistry.json';
import TokenFactory from '../../artifacts/contracts/core/TokenFactory.sol/TokenFactory.json';
import YieldVault from '../../artifacts/contracts/core/YieldVault.sol/YieldVault.json';
import PrimaryMarket from '../../artifacts/contracts/marketplace/PrimaryMarket.sol/PrimaryMarket.json';
import SecondaryMarket from '../../artifacts/contracts/marketplace/SecondaryMarket.sol/SecondaryMarket.json';
import TrustedIssuersRegistry from '../../artifacts/contracts/core/TrustedIssuersRegistry.sol/TrustedIssuersRegistry.json';
import SolvencyVault from '../../artifacts/contracts/core/SolvencyVault.sol/SolvencyVault.json';
import BNBLeverageVault from '../../artifacts/contracts/core/BNBLeverageVault.sol/BNBLeverageVault.json';
import SeniorPool from '../../artifacts/contracts/core/SeniorPool.sol/SeniorPool.json';
import OAID from '../../artifacts/contracts/integrations/OAID.sol/OAID.json';
import MockUSDC from '../../artifacts/contracts/test/MockUSDC.sol/MockUSDC.json';
import BNBSwapIntegration from '../../artifacts/contracts/integrations/BNBSwapIntegration.sol/BNBSwapIntegration.json';
import MockBNBDEX from '../../artifacts/contracts/test/MockBNBDEX.sol/MockBNBDEX.json';
import AnkrBNB from '../../artifacts/contracts/test/AnkrBNB.sol/AnkrBNB.json';
import RWAToken from '../../artifacts/contracts/core/RWAToken.sol/RWAToken.json';
import PrivateAssetToken from '../../artifacts/contracts/core/PrivateAssetToken.sol/PrivateAssetToken.json';
import ComplianceModule from '../../artifacts/contracts/core/ComplianceModule.sol/ComplianceModule.json';

import { ContractName } from '@openassets/types';

export const BnbAbis: Partial<Record<ContractName, any>> = {
  AttestationRegistry: AttestationRegistry.abi,
  IdentityRegistry: IdentityRegistry.abi,
  TokenFactory: TokenFactory.abi,
  YieldVault: YieldVault.abi,
  PrimaryMarket: PrimaryMarket.abi,
  SecondaryMarket: SecondaryMarket.abi,
  TrustedIssuersRegistry: TrustedIssuersRegistry.abi,
  SolvencyVault: SolvencyVault.abi,
  BNBLeverageVault: BNBLeverageVault.abi,
  SeniorPool: SeniorPool.abi,
  OAID: OAID.abi,
  MockUSDC: MockUSDC.abi,
  BNBSwapIntegration: BNBSwapIntegration.abi,
  MockBNBDEX: MockBNBDEX.abi,
  AnkrBNB: AnkrBNB.abi,
  RWAToken: RWAToken.abi,
  PrivateAssetToken: PrivateAssetToken.abi,
  ComplianceModule: ComplianceModule.abi,
};
