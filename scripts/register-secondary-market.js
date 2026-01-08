#!/usr/bin/env node
/**
 * Register SecondaryMarket Contract in IdentityRegistry
 * CRITICAL: The SecondaryMarket contract must be KYC verified to hold RWA tokens
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend package (where contracts addresses are stored)
dotenv.config({ path: join(__dirname, '../packages/backend/.env') });

const MANTLE_RPC = process.env.MANTLE_RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const IDENTITY_REGISTRY_ADDRESS = process.env.IDENTITY_REGISTRY_ADDRESS;
const SECONDARY_MARKET_ADDRESS = process.env.SecondaryMarket;

const IDENTITY_REGISTRY_ABI = [
    'function registerIdentity(address wallet) external',
    'function isVerified(address wallet) external view returns (bool)',
];

async function main() {
    if (!ADMIN_PRIVATE_KEY) {
        console.error('❌ ADMIN_PRIVATE_KEY not set in .env');
        process.exit(1);
    }

    if (!IDENTITY_REGISTRY_ADDRESS) {
        console.error('❌ IDENTITY_REGISTRY_ADDRESS not set in .env');
        process.exit(1);
    }

    if (!SECONDARY_MARKET_ADDRESS) {
        console.error('❌ SecondaryMarket address not set in .env');
        process.exit(1);
    }

    console.log('🔐 Registering SecondaryMarket in IdentityRegistry...');
    console.log('SecondaryMarket:', SECONDARY_MARKET_ADDRESS);
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
    const isVerified = await identityRegistry.isVerified(SECONDARY_MARKET_ADDRESS);

    if (isVerified) {
        console.log('✅ SecondaryMarket is already registered and verified!');
        return;
    }

    console.log('📝 Submitting registration transaction...');
    const tx = await identityRegistry.registerIdentity(SECONDARY_MARKET_ADDRESS);
    console.log('Transaction hash:', tx.hash);

    console.log('⏳ Waiting for confirmation...');
    await tx.wait();

    console.log('✅ SecondaryMarket registered successfully!');
    console.log('The contract can now hold and transfer RWA tokens.');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
    });
