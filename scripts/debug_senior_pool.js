import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
    const deployedPath = join(process.cwd(), 'packages/contracts/deployed_contracts.json');
    const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'));
    const contracts = deployed.contracts;
    
    const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    const seniorPoolAddress = contracts.SeniorPool;
    const solvencyVaultAddress = contracts.SolvencyVault;
    const leverageVaultAddress = contracts.LeverageVault;

    console.log('SeniorPool:', seniorPoolAddress);
    console.log('SolvencyVault (Local):', solvencyVaultAddress);
    console.log('LeverageVault (Local):', leverageVaultAddress);

    const SENIOR_POOL_ABI = [
        'function solvencyVault() view returns (address)',
        'function leverageVault() view returns (address)',
        'function owner() view returns (address)'
    ];

    const seniorPool = new ethers.Contract(seniorPoolAddress, SENIOR_POOL_ABI, provider);

    try {
        const owner = await seniorPool.owner();
        console.log('SeniorPool.owner():', owner);
        // Check if solvencyVault getter exists (it should if code matches)
        try {
            const svOnChain = await seniorPool.solvencyVault();
            console.log('SeniorPool.solvencyVault():', svOnChain);
            
            if (solvencyVaultAddress && svOnChain.toLowerCase() === solvencyVaultAddress.toLowerCase()) {
                console.log('✅ SolvencyVault address matches.');
            } else {
                console.log('❌ SolvencyVault address MISMATCH or not set.');
            }
        } catch (e) {
            console.log('❌ Could not read solvencyVault(). Function might not exist on deployed contract.');
        }

        try {
            const lvOnChain = await seniorPool.leverageVault();
            console.log('SeniorPool.leverageVault():', lvOnChain);
        } catch (e) {
             console.log('❌ Could not read leverageVault().');
        }
    } catch (e) {
        console.error('Error reading SeniorPool state:', e);
    }
}

main();