import { ContractName } from '@openassets/types';
import { BnbContracts } from './bnb.addresses';

export const BnbEvmContracts: Partial<Record<ContractName, string>> = {
  AttestationRegistry: '0xF0877f80C28613eB0a83AfE2d9D9Cd9b08fFa371',
  TrustedIssuersRegistry: '0x74512695334F45FaF93a8a0dAbb54f9D39fe9613',
  IdentityRegistry: '0xc19a39065e453b79C48CDd115c98d54B582c0efD',
  YieldVault: '0xb82A3aDFA1913Db64084569aaB55bB4223e28189',
  TokenFactory: '0x4AB03540a90A9C701049C7F75b16b58D83e6A272',
  PrimaryMarket: '0x47232472137C68AAE3f52E8f81F51FE4f4B6D89D',
  SecondaryMarket: '0xaaD379B3dE8dFa235813a68b24c9ab9E9B302BEB',
  MockUSDC: '0xa6887882e7430862150F7C4FF5AE192966c6e1d2',
  AnkrBNB: '0x3172772883A4CfD4013280CA95370017f4a863f9',
  SeniorPool: '0x2a2bfe500536BADf9657e50088f0F60F2A082664',
  MockBNBDEX: '0xd618e5D470Df53BBA73c98d415924a3467901bd5',
  BNBSwapIntegration: '0xE9d2d78eFfB816E6402b542A514197bB4448427d',
  BNBLeverageVault: '0x8DDD583FfA5b6A442c8D2bf277DffCE890e13DCc'
} as const;

export function getLeverageContractsByChainId(chainId: number | bigint): Partial<Record<ContractName, string>> {
  const normalizedChainId = typeof chainId === 'bigint' ? Number(chainId) : chainId;

  if (normalizedChainId === 97) {
    return BnbContracts;
  }

  return BnbEvmContracts;
}
