import { createPublicClient, http, parseAbi } from 'viem';
import { mantleSepoliaTestnet } from 'viem/chains';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const LEVERAGE_VAULT = '0x5EC05eBFA8AD682d09C8Ef99c1f15844Abe415BF';
const USER_ADDRESS = '0x580F5b09765E71D64613c8F4403234f8790DD7D3';
const EXPECTED_METH = '0x4Ade8aAa0143526393EcadA836224EF21aBC6ac6';

const client = createPublicClient({
  chain: mantleSepoliaTestnet,
  transport: http(RPC_URL)
});

const VAULT_ABI = parseAbi([
  'function mETH() view returns (address)',
  'function primaryMarket() view returns (address)',
  'function usdc() view returns (address)'
]);

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)'
]);

async function main() {
  console.log('🔍 Debugging LeverageVault State...\n');

  // 1. Check configured addresses in LeverageVault
  console.log('1️⃣  Checking LeverageVault configuration...');
  const [methAddress, primaryMarket, usdcAddress] = await Promise.all([
    client.readContract({ address: LEVERAGE_VAULT, abi: VAULT_ABI, functionName: 'mETH' }),
    client.readContract({ address: LEVERAGE_VAULT, abi: VAULT_ABI, functionName: 'primaryMarket' }),
    client.readContract({ address: LEVERAGE_VAULT, abi: VAULT_ABI, functionName: 'usdc' })
  ]);

  console.log(`   mETH Address:      ${methAddress}`);
  console.log(`   Expected mETH:     ${EXPECTED_METH}`);
  console.log(`   Match?             ${methAddress.toLowerCase() === EXPECTED_METH.toLowerCase() ? '✅ Yes' : '❌ NO'}`);
  
  console.log(`   PrimaryMarket:     ${primaryMarket}`);
  console.log(`   USDC Address:      ${usdcAddress}`);

  // 2. Check User Allowance for mETH
  console.log('\n2️⃣  Checking User mETH Allowance...');
  
  if (methAddress.toLowerCase() !== EXPECTED_METH.toLowerCase()) {
    console.log('   ⚠️  Vault uses different mETH. Checking that one...');
  }

  const allowance = await client.readContract({
    address: methAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [USER_ADDRESS, LEVERAGE_VAULT]
  });

  const balance = await client.readContract({
    address: methAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [USER_ADDRESS]
  });

  console.log(`   User:              ${USER_ADDRESS}`);
  console.log(`   Spender (Vault):   ${LEVERAGE_VAULT}`);
  console.log(`   Allowance:         ${allowance.toString()} wei (${Number(allowance) / 1e18} mETH)`);
  console.log(`   User Balance:      ${balance.toString()} wei (${Number(balance) / 1e18} mETH)`);
  
  const required = 7045000000000000n; // 0.007045 mETH from logs
  console.log(`   Required:          ${required.toString()} wei`);

  if (allowance < required) {
    console.log(`   ❌ INSUFFICIENT ALLOWANCE!`);
    console.log(`      User needs to approve LeverageVault to spend mETH.`);
  } else {
    console.log(`   ✅ Allowance is sufficient.`);
  }

  // 3. Check USDC Allowance (Vault -> PrimaryMarket) just in case
  // Although Vault approves during the transaction, it's good to know if PrimaryMarket address is sane.
  // We can't check transient allowance inside the tx, but we can verify PrimaryMarket address is likely correct.
  // 0x034... is PrimaryMarketplace in deployed_contracts.json.

  const DEPLOYED_PRIMARY_MARKET = '0x034Ca27695555CEeB44CB62d59c4E3f95F4Ef504';
  console.log(`\n3️⃣  Checking PrimaryMarket Address...`);
  console.log(`   Vault PrimaryMarket: ${primaryMarket}`);
  console.log(`   Deployed JSON:       ${DEPLOYED_PRIMARY_MARKET}`);
  
  if (primaryMarket.toLowerCase() !== DEPLOYED_PRIMARY_MARKET.toLowerCase()) {
    console.log(`   ⚠️  MISMATCH! Vault might be pointing to wrong PrimaryMarket.`);
    if (primaryMarket === '0x0000000000000000000000000000000000000000') {
      console.log(`   ❌ PrimaryMarket is NOT SET (address 0). This requires admin setup.`);
    }
  } else {
    console.log(`   ✅ PrimaryMarket matches deployed address.`);
  }

}

main().catch(console.error);
