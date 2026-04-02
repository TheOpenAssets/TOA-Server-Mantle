import { ethers } from 'hardhat';
import deployed from '../../deployed_contracts_bnb.json';

const DEFAULT_SELLER = '0x836706b3ba32cda21029a8285399a031b6079041';
const DEFAULT_TOKEN = '0x05737c3b3Fdf29d02c172A8D537Fba85D990df38';
const DEFAULT_REQUIRED_AMOUNT = '1000000000000000000';

async function main() {
  const seller = (process.env.SELLER_WALLET || DEFAULT_SELLER) as `0x${string}`;
  const tokenAddress = (process.env.TOKEN_ADDRESS || DEFAULT_TOKEN) as `0x${string}`;
  const requiredAmount = BigInt(process.env.REQUIRED_AMOUNT || DEFAULT_REQUIRED_AMOUNT);

  const identityRegistryAddress = deployed.contracts.IdentityRegistry as `0x${string}`;
  const secondaryMarketAddress = deployed.contracts.SecondaryMarket as `0x${string}`;

  const [admin] = await ethers.getSigners();
  console.log(`Admin signer: ${admin.address}`);
  console.log(`IdentityRegistry: ${identityRegistryAddress}`);
  console.log(`SecondaryMarket: ${secondaryMarketAddress}`);

  const identityRegistry = await ethers.getContractAt('IdentityRegistry', identityRegistryAddress, admin);

  const isSecondaryVerifiedBefore = await identityRegistry.isVerified(secondaryMarketAddress);
  console.log(`SecondaryMarket verified (before): ${isSecondaryVerifiedBefore}`);

  if (!isSecondaryVerifiedBefore) {
    const tx = await identityRegistry.registerIdentity(secondaryMarketAddress);
    console.log(`registerIdentity(SecondaryMarket) tx: ${tx.hash}`);
    await tx.wait();
  }

  const isSecondaryVerifiedAfter = await identityRegistry.isVerified(secondaryMarketAddress);
  console.log(`SecondaryMarket verified (after): ${isSecondaryVerifiedAfter}`);

  const isSellerVerified = await identityRegistry.isVerified(seller);
  console.log(`Seller verified: ${isSellerVerified} (${seller})`);

  const erc20 = await ethers.getContractAt('IERC20', tokenAddress);
  const balance = await erc20.balanceOf(seller);
  const allowance = await erc20.allowance(seller, secondaryMarketAddress);

  console.log(`Token: ${tokenAddress}`);
  console.log(`Required amount: ${requiredAmount.toString()}`);
  console.log(`Seller balance: ${balance.toString()} (${ethers.formatUnits(balance, 18)} tokens)`);
  console.log(`Seller allowance->SecondaryMarket: ${allowance.toString()} (${ethers.formatUnits(allowance, 18)} tokens)`);
  console.log(`Has required balance: ${balance >= requiredAmount}`);
  console.log(`Has required allowance: ${allowance >= requiredAmount}`);

  if (!isSecondaryVerifiedAfter) {
    process.exitCode = 1;
    throw new Error('SecondaryMarket is still not verified in IdentityRegistry');
  }

  if (balance < requiredAmount || allowance < requiredAmount) {
    console.warn('⚠️ Seller still needs sufficient token balance/allowance for sell order.');
  } else {
    console.log('✅ Seller balance/allowance checks passed for requested sell amount.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
