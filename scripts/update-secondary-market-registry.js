#!/usr/bin/env node
/**
 * Update IdentityRegistry with new SecondaryMarket Contract Address
 * This script registers a NEW SecondaryMarket address in the IdentityRegistry.
 * 
 * Usage: node scripts/update-secondary-market-registry.js <NEW_SECONDARY_MARKET_ADDRESS>
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend package
dotenv.config({ path: join(__dirname, '../packages/backend/.env') });

const MANTLE_RPC = process.env.MANTLE_RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const IDENTITY_REGISTRY_ADDRESS = process.env.IDENTITY_REGISTRY_ADDRESS;

const IDENTITY_REGISTRY_ABI = [
    'function registerIdentity(address wallet) external',
    'function isVerified(address wallet) external view returns (bool)',
];

async function main() {
    // 1. Get new address from CLI args
    const newAddress = process.argv[2];

    if (!newAddress || !ethers.isAddress(newAddress)) {
        console.error('❌ Please provide a valid contract address as an argument.');
        console.error('Usage: node scripts/update-secondary-market-registry.js <NEW_ADDRESS>');
        process.exit(1);
    }

    if (!ADMIN_PRIVATE_KEY) {
        console.error('❌ ADMIN_PRIVATE_KEY not set in .env');
        process.exit(1);
    }

    if (!IDENTITY_REGISTRY_ADDRESS) {
        console.error('❌ IDENTITY_REGISTRY_ADDRESS not set in .env');
        process.exit(1);
    }

    console.log('🔐 Updating IdentityRegistry with new SecondaryMarket address...');
    console.log('New SecondaryMarket:', newAddress);
    console.log('IdentityRegistry:', IDENTITY_REGISTRY_ADDRESS);

    const provider = new ethers.JsonRpcProvider(MANTLE_RPC);
    const admin = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

    console.log('Admin wallet:', admin.address);

    const identityRegistry = new ethers.Contract(
        IDENTITY_REGISTRY_ADDRESS,
        IDENTITY_REGISTRY_ABI,
        admin,
    );

    // Check if already registered
    const isVerified = await identityRegistry.isVerified(newAddress);

    if (isVerified) {
        console.log('✅ This address is already registered and verified!');
        return;
    }

    console.log('📝 Submitting registration transaction for new address...');
    try {
        const tx = await identityRegistry.registerIdentity(newAddress);
        console.log('Transaction hash:', tx.hash);

        console.log('⏳ Waiting for confirmation...');
        await tx.wait();

        console.log('✅ New SecondaryMarket registered successfully!');
        console.log('The new contract can now hold and transfer RWA tokens.');
    } catch (error) {
        console.error('❌ Transaction failed:', error.message);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
    });
