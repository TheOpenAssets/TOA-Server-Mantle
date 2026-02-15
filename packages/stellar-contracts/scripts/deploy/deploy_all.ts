/**
 * Stellar Full System Deployment Orchestrator
 * ------------------------------------------
 *
 * This script deploys the complete OpenAssets protocol stack on Stellar:
 *
 * - Compliance Layer
 *   TrustedIssuersRegistry
 *   AttestationRegistry
 *   IdentityRegistry
 *
 * - Asset & Market Layer
 *   AssetRegistry
 *   PrimaryMarket
 *
 * Usage:
 * ------
 * npm run deploy:all
 * # OR with specific network
 * STELLAR_NETWORK=testnet npm run deploy:all
 *
 * Requirements:
 * -------------
 * - soroban CLI installed: https://soroban.stellar.org/docs/getting-started/setup
 * - Stellar account configured with soroban config identity
 * - deployed_contracts.json will be created/updated automatically
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Keypair } from '@stellar/stellar-sdk';

interface DeployedContracts {
  networks?: {
    [key: string]: {
      contracts: Record<string, string>;
      network: string;
      timestamp?: string;
    };
  };
  // Legacy format support
  contracts?: Record<string, string>;
  network?: string;
}

const STELLAR_NETWORK = process.env.STELLAR_NETWORK || 'testnet';
const STELLAR_ACCOUNT = process.env.STELLAR_ACCOUNT || 'default';
const WASM_DIR = path.join(__dirname, '../../target/wasm32-unknown-unknown/release');
const DEPLOY_PATH = path.join(__dirname, '../../deployed_contracts.json');

function log(message: string, level: 'info' | 'success' | 'error' | 'header' = 'info') {
  const icons = { info: '➜', success: '✔', error: '❌', header: '🚀' };
  const colors = {
    info: '\x1b[36m',    // Cyan
    success: '\x1b[32m', // Green
    error: '\x1b[31m',   // Red
    header: '\x1b[35m',  // Magenta
  };
  const reset = '\x1b[0m';
  console.log(`${colors[level]}${icons[level]} ${message}${reset}`);
}

function loadDeployedContracts(): DeployedContracts {
  if (fs.existsSync(DEPLOY_PATH)) {
    return JSON.parse(fs.readFileSync(DEPLOY_PATH, 'utf8'));
  }
  return { networks: {} };
}

function saveDeployedContracts(data: DeployedContracts) {
  fs.writeFileSync(DEPLOY_PATH, JSON.stringify(data, null, 2));
}

function getNetworkKey(): string {
  return `stellar-${STELLAR_NETWORK}`;
}

function execCommand(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (error: any) {
    log(`Command failed: ${cmd}`, 'error');
    log(error.message, 'error');
    throw error;
  }
}

function buildContracts() {
  log('Building all Soroban contracts...', 'info');
  try {
    execSync('cargo build --target wasm32-unknown-unknown --release', {
      cwd: path.join(__dirname, '../..'),
      stdio: 'inherit',
    });
    log('Build completed successfully', 'success');
  } catch (error) {
    log('Build failed', 'error');
    throw error;
  }
}

function optimizeWasm(wasmFile: string): string {
  log(`Optimizing ${path.basename(wasmFile)}...`, 'info');
  const optimizedFile = wasmFile.replace('.wasm', '_optimized.wasm');
  
  try {
    // Use stellar contract optimize if available
    execCommand(
      `stellar contract optimize --wasm ${wasmFile} --wasm-out ${optimizedFile}`
    );
    log(`Optimized: ${path.basename(optimizedFile)}`, 'success');
    return optimizedFile;
  } catch (error) {
    log('Optimization failed, using unoptimized WASM', 'info');
    return wasmFile;
  }
}

function deployContract(name: string, wasmFileName: string, initArgs?: string[]): string {
  const wasmPath = path.join(WASM_DIR, wasmFileName);
  
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM file not found: ${wasmPath}. Did you run build?`);
  }

  log(`Deploying ${name}...`, 'info');

  // Deploy the contract
  const deployCmd = [
    'stellar contract deploy',
    `--wasm ${wasmPath}`,
    `--source ${STELLAR_ACCOUNT}`,
    `--network ${STELLAR_NETWORK}`,
  ].join(' ');

  const contractId = execCommand(deployCmd);
  log(`${name} deployed: ${contractId}`, 'success');

  // Initialize if init args provided
  if (initArgs && initArgs.length > 0) {
    log(`Initializing ${name}...`, 'info');
    const initCmd = [
      'stellar contract invoke',
      `--id ${contractId}`,
      `--source ${STELLAR_ACCOUNT}`,
      `--network ${STELLAR_NETWORK}`,
      `-- init`,
      ...initArgs,
    ].join(' ');

    try {
      execCommand(initCmd);
      log(`${name} initialized`, 'success');
    } catch (error: any) {
      log(`FATAL: Initialization failed for ${name}: ${error.message}`, 'error');
      throw new Error(`Contract deployment incomplete: ${name} failed to initialize`);
    }
  }

  return contractId;
}

function setContractAddress(data: DeployedContracts, name: string, address: string) {
  const networkKey = getNetworkKey();
  if (!data.networks) {
    data.networks = {};
  }
  if (!data.networks[networkKey]) {
    data.networks[networkKey] = {
      contracts: {},
      network: STELLAR_NETWORK,
    };
  }
  data.networks[networkKey].contracts[name] = address;
  data.networks[networkKey].timestamp = new Date().toISOString();
  saveDeployedContracts(data);
}

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  log('OpenAssets Stellar Deployment', 'header');
  log(`Network: ${STELLAR_NETWORK}`, 'info');
  log(`Account: ${STELLAR_ACCOUNT}`, 'info');
  console.log('═══════════════════════════════════════════════\n');

  // Get deployer address to use as admin
  let deployerAddress: string;
  if (STELLAR_ACCOUNT.startsWith('S') && STELLAR_ACCOUNT.length === 56) {
    // It's a secret key
    try {
        const keypair = Keypair.fromSecret(STELLAR_ACCOUNT);
        deployerAddress = keypair.publicKey();
    } catch (e) {
        throw new Error('Invalid STELLAR_ACCOUNT secret key');
    }
  } else {
    // It's an alias
    deployerAddress = execCommand(`stellar keys address ${STELLAR_ACCOUNT}`);
  }
  
  log(`Deployer Address: ${deployerAddress}`, 'info');

  // Build all contracts
  buildContracts();

  const deployed = loadDeployedContracts();
  const networkKey = getNetworkKey();
  const existingContracts = deployed.networks?.[networkKey]?.contracts || {};

  console.log('\n[1] COMPLIANCE REGISTRIES');
  console.log('═══════════════════════════════════════════════');

  // Deploy TrustedIssuersRegistry
  let trustedIssuersAddress = existingContracts.TrustedIssuersRegistry;
  if (!trustedIssuersAddress) {
    trustedIssuersAddress = deployContract(
      'TrustedIssuersRegistry',
      'trusted_issuers_registry.wasm',
      [`--admin ${deployerAddress}`] // Initialize with deployer as admin
    );
    setContractAddress(deployed, 'TrustedIssuersRegistry', trustedIssuersAddress);
  } else {
    log(`Using existing TrustedIssuersRegistry: ${trustedIssuersAddress}`, 'success');
  }

  // Deploy AttestationRegistry
  let attestationAddress = existingContracts.AttestationRegistry;
  if (!attestationAddress) {
    attestationAddress = deployContract(
      'AttestationRegistry',
      'attestation_registry.wasm',
      [`--trusted_issuers ${trustedIssuersAddress}`]
    );
    setContractAddress(deployed, 'AttestationRegistry', attestationAddress);
  } else {
    log(`Using existing AttestationRegistry: ${attestationAddress}`, 'success');
  }

  // Deploy IdentityRegistry
  let identityAddress = existingContracts.IdentityRegistry;
  if (!identityAddress) {
    identityAddress = deployContract(
      'IdentityRegistry',
      'identity_registry.wasm',
      [`--trusted_issuers ${trustedIssuersAddress}`]
    );
    setContractAddress(deployed, 'IdentityRegistry', identityAddress);
  } else {
    log(`Using existing IdentityRegistry: ${identityAddress}`, 'success');
  }

  console.log('\n[2] ASSET & MARKET LAYER');
  console.log('═══════════════════════════════════════════════');

  // Deploy AssetRegistry
  let assetRegistryAddress = existingContracts.AssetRegistry;
  if (!assetRegistryAddress) {
    assetRegistryAddress = deployContract(
      'AssetRegistry',
      'asset_registry.wasm',
      [
        `--admin ${deployerAddress}`,
        `--attestation_registry ${attestationAddress}`,
      ]
    );
    setContractAddress(deployed, 'AssetRegistry', assetRegistryAddress);
  } else {
    log(`Using existing AssetRegistry: ${assetRegistryAddress}`, 'success');
  }

  // Deploy PrimaryMarket
  let primaryMarketAddress = existingContracts.PrimaryMarket;
  if (!primaryMarketAddress) {
    primaryMarketAddress = deployContract(
      'PrimaryMarket',
      'primary_market.wasm',
      [
        `--admin ${deployerAddress}`,
        `--asset_registry ${assetRegistryAddress}`,
      ]
    );
    setContractAddress(deployed, 'PrimaryMarket', primaryMarketAddress);
  } else {
    log(`Using existing PrimaryMarket: ${primaryMarketAddress}`, 'success');
  }

  console.log('\n═══════════════════════════════════════════════');
  log('STELLAR DEPLOYMENT COMPLETE', 'header');
  console.log('═══════════════════════════════════════════════');
  
  const finalData = loadDeployedContracts();
  console.table(finalData.networks?.[networkKey]?.contracts || {});
  
  console.log(`\nDeployment saved to: ${DEPLOY_PATH}`);
  console.log(`Network: ${networkKey}`);
}

main().catch((error) => {
  log('DEPLOYMENT FAILED', 'error');
  console.error(error);
  process.exit(1);
});
