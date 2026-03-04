import AttestationRegistry from '../../artifacts/contracts/core/AttestationRegistry.sol/AttestationRegistry.json';
import IdentityRegistry from '../../artifacts/contracts/core/IdentityRegistry.sol/IdentityRegistry.json';
import TokenFactory from '../../artifacts/contracts/core/TokenFactory.sol/TokenFactory.json';
import YieldVault from '../../artifacts/contracts/core/YieldVault.sol/YieldVault.json';
import PrimaryMarket from '../../artifacts/contracts/marketplace/PrimaryMarket.sol/PrimaryMarket.json';
import SecondaryMarket from '../../artifacts/contracts/marketplace/SecondaryMarket.sol/SecondaryMarket.json';
import TrustedIssuersRegistry from '../../artifacts/contracts/core/TrustedIssuersRegistry.sol/TrustedIssuersRegistry.json';
import SolvencyVault from '../../artifacts/contracts/core/SolvencyVault.sol/SolvencyVault.json';
import CTCLeverageVault from '../../artifacts/contracts/core/CTCLeverageVault.sol/CTCLeverageVault.json';
import SeniorPool from '../../artifacts/contracts/core/SeniorPool.sol/SeniorPool.json';
import OAID from '../../artifacts/contracts/integrations/OAID.sol/OAID.json';
import MockUSDC from '../../artifacts/contracts/test/MockUSDC.sol/MockUSDC.json';
import CTCDEXIntegration from '../../artifacts/contracts/integrations/CTCDEXIntegration.sol/CTCDEXIntegration.json';
import MockCTCDEX from '../../artifacts/contracts/test/MockCTCDEX.sol/MockCTCDEX.json';
import MockCTC from '../../artifacts/contracts/test/MockCTC.sol/MockCTC.json';
import CTCFaucet from '../../artifacts/contracts/test/CTCFaucet.sol/CTCFaucet.json';
import Faucet from '../../artifacts/contracts/test/Faucet.sol/Faucet.json';
import RWAToken from '../../artifacts/contracts/core/RWAToken.sol/RWAToken.json';
import PrivateAssetToken from '../../artifacts/contracts/core/PrivateAssetToken.sol/PrivateAssetToken.json';
import ComplianceModule from '../../artifacts/contracts/core/ComplianceModule.sol/ComplianceModule.json';
import USCCreditVerifier from '../../artifacts/contracts/integrations/USCCreditVerifier.sol/USCCreditVerifier.json';

import { ContractName } from '@openassets/types';

export const CreditCoinAbis: Partial<Record<ContractName, any>> = {
  AttestationRegistry: AttestationRegistry.abi,
  IdentityRegistry: IdentityRegistry.abi,
  TokenFactory: TokenFactory.abi,
  YieldVault: YieldVault.abi,
  PrimaryMarket: PrimaryMarket.abi,
  SecondaryMarket: SecondaryMarket.abi,
  TrustedIssuersRegistry: TrustedIssuersRegistry.abi,
  SolvencyVault: SolvencyVault.abi,
  CTCLeverageVault: CTCLeverageVault.abi,
  SeniorPool: SeniorPool.abi,
  OAID: OAID.abi,
  MockUSDC: MockUSDC.abi,
  CTCDEXIntegration: CTCDEXIntegration.abi,
  MockCTCDEX: MockCTCDEX.abi,
  MockCTC: MockCTC.abi,
  CTCFaucet: CTCFaucet.abi,
  Faucet: Faucet.abi,
  RWAToken: RWAToken.abi,
  PrivateAssetToken: PrivateAssetToken.abi,
  ComplianceModule: ComplianceModule.abi,
  USCCreditVerifier: USCCreditVerifier.abi,
};
