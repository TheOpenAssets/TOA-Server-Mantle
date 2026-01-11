import { ethers } from 'ethers';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../packages/backend/.env') });

const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);

// Contract addresses
const SECONDARY_MARKET = '0x69d2e2B05eDdB11774A132e2b61B9D10486bd33A';
const IDENTITY_REGISTRY = '0x2E310C62A225033055E88B690F8d054ece8bcbC4';
const TOKEN_ADDRESS = '0xa5b1d2f52a304f97c8b51fbf124e464863b6118b'; // From failed tx
const USER_ADDRESS = '0x9D02DF5d5707AB8ea6C3bf1a82e155E2a97c09b8'; // From failed tx

const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function approve(address spender, uint256 amount) returns (bool)'
];

const IDENTITY_REGISTRY_ABI = [
    'function isVerified(address account) view returns (bool)'
];

const SECONDARY_MARKET_ABI = [
    'function usdc() view returns (address)',
    'function identityRegistry() view returns (address)'
];

async function debugSecondaryMarket() {
    console.log('=== Secondary Market Debug ===\n');

    console.log('User Address:', USER_ADDRESS);
    console.log('Token Address:', TOKEN_ADDRESS);
    console.log('SecondaryMarket:', SECONDARY_MARKET);
    console.log('IdentityRegistry:', IDENTITY_REGISTRY);
    console.log('\n');

    try {
        // 1. Check Token Balance
        const tokenContract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, provider);
        const balance = await tokenContract.balanceOf(USER_ADDRESS);
        const decimals = await tokenContract.decimals();
        const symbol = await tokenContract.symbol();

        console.log('✅ 1. Token Balance Check:');
        console.log(`   Symbol: ${symbol}`);
        console.log(`   Decimals: ${decimals}`);
        console.log(`   Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);
        console.log(`   Raw: ${balance.toString()}`);
        console.log('\n');

        // 2. Check Allowance
        const allowance = await tokenContract.allowance(USER_ADDRESS, SECONDARY_MARKET);
        console.log('✅ 2. Token Allowance Check:');
        console.log(`   Approved Amount: ${ethers.formatUnits(allowance, decimals)} ${symbol}`);
        console.log(`   Raw: ${allowance.toString()}`);

        if (allowance === 0n) {
            console.log('   ⚠️  WARNING: No allowance set! User must approve SecondaryMarket contract.');
        } else if (allowance < balance) {
            console.log('   ⚠️  WARNING: Allowance less than balance. May need more approval.');
        } else {
            console.log('   ✓ Sufficient allowance');
        }
        console.log('\n');

        // 3. Check KYC Verification
        const identityRegistry = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI, provider);
        const isVerified = await identityRegistry.isVerified(USER_ADDRESS);

        console.log('✅ 3. KYC Verification Check:');
        console.log(`   Is Verified: ${isVerified}`);

        if (!isVerified) {
            console.log('   ⚠️  WARNING: User is NOT verified in IdentityRegistry!');
            console.log('   This will cause "Maker not verified" revert.');
        } else {
            console.log('   ✓ User is verified');
        }
        console.log('\n');

        // 4. Check SecondaryMarket Configuration
        const secondaryMarket = new ethers.Contract(SECONDARY_MARKET, SECONDARY_MARKET_ABI, provider);
        const usdcAddress = await secondaryMarket.usdc();
        const registryAddress = await secondaryMarket.identityRegistry();

        console.log('✅ 4. SecondaryMarket Configuration:');
        console.log(`   USDC Address: ${usdcAddress}`);
        console.log(`   Identity Registry: ${registryAddress}`);
        console.log('\n');

        // 5. Summary
        console.log('=== DIAGNOSIS ===');
        let hasIssues = false;

        if (balance === 0n) {
            console.log('❌ ISSUE: User has ZERO tokens! Cannot create sell order.');
            hasIssues = true;
        }

        if (allowance === 0n) {
            console.log('❌ ISSUE: No token approval! User must call approve() on RWA token contract.');
            console.log('   Solution: token.approve(SecondaryMarket, amount)');
            hasIssues = true;
        }

        if (!isVerified) {
            console.log('❌ ISSUE: User not KYC verified!');
            console.log('   Solution: Register user in IdentityRegistry (admin only)');
            hasIssues = true;
        }

        if (!hasIssues) {
            console.log('✅ All checks passed! Transaction should work.');
            console.log('   If still failing, check:');
            console.log('   - Gas limit (try increasing)');
            console.log('   - Network congestion');
            console.log('   - Token contract restrictions');
        }

        console.log('\n=== ACTION REQUIRED ===');
        if (allowance === 0n) {
            console.log('Run this to approve tokens:');
            console.log(`node scripts/approve-secondary-market.js ${TOKEN_ADDRESS} ${ethers.formatUnits(balance, decimals)}`);
        }
        if (!isVerified) {
            console.log('Run this to verify user (as admin):');
            console.log(`node scripts/verify-user.js ${USER_ADDRESS}`);
        }

    } catch (error) {
        console.error('Error during debug:', error.message);
        throw error;
    }
}

debugSecondaryMarket()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
