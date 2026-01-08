import { ethers } from 'ethers';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../packages/backend/.env') });

const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);

const SECONDARY_MARKET = '0x69d2e2B05eDdB11774A132e2b61B9D10486bd33A';

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
];

async function approveSecondaryMarket() {
    const tokenAddress = process.argv[2];
    const amountStr = process.argv[3];

    if (!tokenAddress) {
        console.log('Usage: node scripts/approve-secondary-market.js <TOKEN_ADDRESS> [AMOUNT]');
        console.log('Example: node scripts/approve-secondary-market.js 0xa5b1... 1000');
        console.log('\nIf AMOUNT is omitted, approves MAX_UINT256 (infinite approval)');
        process.exit(1);
    }

    console.log('=== Approve SecondaryMarket Contract ===\n');
    console.log('Token Address:', tokenAddress);
    console.log('Spender (SecondaryMarket):', SECONDARY_MARKET);
    console.log('Approver (Your Wallet):', wallet.address);
    console.log('\n');

    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    try {
        // Get token info
        const symbol = await tokenContract.symbol();
        const decimals = await tokenContract.decimals();
        const balance = await tokenContract.balanceOf(wallet.address);

        console.log(`Token: ${symbol} (${decimals} decimals)`);
        console.log(`Your Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);
        console.log('\n');

        // Check current allowance
        const currentAllowance = await tokenContract.allowance(wallet.address, SECONDARY_MARKET);
        console.log(`Current Allowance: ${ethers.formatUnits(currentAllowance, decimals)} ${symbol}`);
        console.log('\n');

        // Determine approval amount
        let approvalAmount;
        if (amountStr) {
            approvalAmount = ethers.parseUnits(amountStr, decimals);
            console.log(`Approving: ${amountStr} ${symbol}`);
        } else {
            approvalAmount = ethers.MaxUint256;
            console.log(`Approving: UNLIMITED (MaxUint256)`);
        }
        console.log('\n');

        // Send approval transaction
        console.log('Sending approval transaction...');
        const tx = await tokenContract.approve(SECONDARY_MARKET, approvalAmount);
        console.log('Transaction Hash:', tx.hash);
        console.log('Waiting for confirmation...');

        const receipt = await tx.wait();
        console.log('✅ Transaction confirmed!');
        console.log('Block Number:', receipt.blockNumber);
        console.log('Gas Used:', receipt.gasUsed.toString());
        console.log('\n');

        // Verify new allowance
        const newAllowance = await tokenContract.allowance(wallet.address, SECONDARY_MARKET);
        console.log('New Allowance:', ethers.formatUnits(newAllowance, decimals), symbol);
        console.log('\n');

        console.log('✅ SUCCESS! You can now create sell orders on SecondaryMarket.');
        console.log(`Transaction: https://sepolia.mantlescan.xyz/tx/${tx.hash}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

approveSecondaryMarket()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
