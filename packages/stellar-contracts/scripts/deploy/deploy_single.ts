/**
 * Stellar Stack-Oriented Deployment Orchestrator
 * =============================================
 *
 * This script deploys Stellar contracts by economic stack instead of
 * unsafe per-contract deployment.
 *
 * Supported Stacks:
 *
 * 1) STACK=identity
 *    - TrustedIssuersRegistry
 *    - AttestationRegistry
 *    - IdentityRegistry
 *
 * 2) STACK=issuance
 *    - AssetRegistry
 *    - PrimaryMarket
 *
 * 3) STACK=settlement
 *    - YieldVault
 *
 * Usage:
 * ------
 * STACK=<stackName> npm run deploy:stack
 *
 * Examples:
 * ---------
 * STACK=identity npm run deploy:stack
 * STACK=issuance npm run deploy:stack
 *
 * With custom network:
 * STACK=identity STELLAR_NETWORK=testnet npm run deploy:stack
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface DeployedContracts {
  networks?: {
    [key: string]: {
      contracts: Record<string, string>;
      network: string;
      timestamp?: string;
    };
  };
}

const STACK = process.env.STACK;
const STELLAR_NETWORK = process.env.STELLAR_NETWORK || 'testnet';
const STELLAR_ACCOUNT = process.env.STELLAR_ACCOUNT || 'default';
const WASM_DIR = path.join(__dirname, '../../target/wasm32-unknown-unknown/release');
const DEPLOY_PATH = path.join(__dirname, '../../deployed_contracts.json');

if (!STACK) {
  console.error('❌ STACK is required. Example: STACK=identity npm run deploy:stack');
  process.exit(1);
}

const VALID_STACKS = ['identity', 'issuance', 'settlement'];
if (!VALID_STACKS.includes(STACK)) {
  console.error(`❌ Invalid STACK. Valid options: ${VALID_STACKS.join(', ')}`);
  process.exit(1);
}

function log(message: string, level: 'info' | 'success' | 'error' | 'header' = 'info') {
  const icons = { info: '➜', success: '✔', error: '❌', header: '🚀' };
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    error: '\x1b[31m',
    header: '\x1b[35m',
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
  log('Building Soroban contracts...', 'info');
  try {
    execSync('cargo build --target wasm32-unknown-unknown --release', {
      cwd: path.join(__dirname, '../..'),
      stdio: 'inherit',
    });
    log('Build completed', 'success');
  } catch (error) {
    log('Build failed', 'error');
    throw error;
  }
}

function deployContract(name: string, wasmFileName: string, initArgs?: string[]): string {
  const wasmPath = path.join(WASM_DIR, wasmFileName);
  
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM file not found: ${wasmPath}`);
  }

  log(`Deploying ${name}...`, 'info');

  const deployCmd = [
    'stellar contract deploy',
    `--wasm ${wasmPath}`,
    `--source ${STELLAR_ACCOUNT}`,
    `--network ${STELLAR_NETWORK}`,
  ].join(' ');

  const contractId = execCommand(deployCmd);
  log(`${name}: ${contractId}`, 'success');

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
      log(`Warning: Init may have failed: ${error.message}`, 'info');
    }
  }

  return contractId;
}

function wipeContracts(data: DeployedContracts, keys: string[]) {
  const networkKey = getNetworkKey();
  if (data.networks?.[networkKey]?.contracts) {
    for (const k of keys) {
      delete data.networks[networkKey].contracts[k];
    }
  }
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
  log(`STELLAR STACK DEPLOYMENT: ${STACK!.toUpperCase()}`, 'header');
  log(`Network: ${STELLAR_NETWORK}`, 'info');
  log(`Account: ${STELLAR_ACCOUNT}`, 'info');
  console.log('═══════════════════════════════════════════════\n');

  // Get deployer address to use as admin
  const deployerAddress = execCommand(`stellar keys address ${STELLAR_ACCOUNT}`);
  log(`Deployer Address: ${deployerAddress}`, 'info');

  buildContracts();

  const deployed = loadDeployedContracts();
  const networkKey = getNetworkKey();

  // ------------------------------------------------------------------
  // IDENTITY STACK
  // ------------------------------------------------------------------
  if (STACK === 'identity') {
    log('[IDENTITY STACK] Redeploying compliance layer', 'header');

    wipeContracts(deployed, [
      'TrustedIssuersRegistry',
      'AttestationRegistry',
      'IdentityRegistry',
    ]);

    // Deploy TrustedIssuersRegistry
    const trustedIssuersAddress = deployContract(
      'TrustedIssuersRegistry',
      'trusted_issuers_registry.wasm'
    );
    setContractAddress(deployed, 'TrustedIssuersRegistry', trustedIssuersAddress);

    // Deploy AttestationRegistry
    const attestationAddress = deployContract(
      'AttestationRegistry',
      'attestation_registry.wasm',
      [`--trusted_issuers ${trustedIssuersAddress}`]
    );
    setContractAddress(deployed, 'AttestationRegistry', attestationAddress);

    // Deploy IdentityRegistry
    const identityAddress = deployContract(
      'IdentityRegistry',
      'identity_registry.wasm',
      [`--trusted_issuers ${trustedIssuersAddress}`]
    );
    setContractAddress(deployed, 'IdentityRegistry', identityAddress);
  }

  // ------------------------------------------------------------------
  // ISSUANCE STACK
  // ------------------------------------------------------------------
  if (STACK === 'issuance') {
    log('[ISSUANCE STACK] Redeploying Asset + Market layer', 'header');

    wipeContracts(deployed, ['AssetRegistry', 'PrimaryMarket']);

    const existingContracts = deployed.networks?.[networkKey]?.contracts || {};
    const attestationAddress = existingContracts.AttestationRegistry;
    const identityAddress = existingContracts.IdentityRegistry;

    if (!attestationAddress || !identityAddress) {
      log('Missing dependencies. Deploy identity stack first.', 'error');
      process.exit(1);
    }

    // Deploy AssetRegistry
    const assetRegistryAddress = deployContract(
      'AssetRegistry',
      'asset_registry.wasm',
      [
        `--admin ${deployerAddress}`,
        `--attestation_registry ${attestationAddress}`,
      ]
    );
    setContractAddress(deployed, 'AssetRegistry', assetRegistryAddress);

    // Deploy PrimaryMarket
    const primaryMarketAddress = deployContract(
      'PrimaryMarket',
      'primary_market.wasm',
      [
        `--admin ${deployerAddress}`,
        `--asset_registry ${assetRegistryAddress}`,
      ]
    );
    setContractAddress(deployed, 'PrimaryMarket', primaryMarketAddress);
  }

  // ------------------------------------------------------------------
  // SETTLEMENT STACK
  // ------------------------------------------------------------------
  if (STACK === 'settlement') {
    log('[SETTLEMENT STACK] Deploying Yield Distribution layer', 'header');

    wipeContracts(deployed, ['YieldVault']);

    const existingContracts = deployed.networks?.[networkKey]?.contracts || {};
    const assetRegistryAddress = existingContracts.AssetRegistry;

    if (!assetRegistryAddress) {
      log('Missing AssetRegistry. Deploy issuance stack first.', 'error');
      process.exit(1);
    }

    // For USDC, we'll use a placeholder. In production, this should be the actual USDC SAC address
    // On testnet, you can deploy a test USDC token or use native USDC if available
    const USDC_PLACEHOLDER = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'; // Example Stellar asset contract ID
    log(`Using USDC asset: ${USDC_PLACEHOLDER}`, 'info');

    // Deploy YieldVault
    const yieldVaultAddress = deployContract(
      'YieldVault',
      'yield_vault.wasm',
      [
        `--platform ${deployerAddress}`,
        `--usdc_asset ${USDC_PLACEHOLDER}`,
      ]
    );
    setContractAddress(deployed, 'YieldVault', yieldVaultAddress);
  }

  console.log('\n═══════════════════════════════════════════════');
  log('STACK DEPLOYMENT COMPLETE', 'header');
  console.log('═══════════════════════════════════════════════');
  
  const finalData = loadDeployedContracts();
  console.table(finalData.networks?.[networkKey]?.contracts || {});
}

main().catch((error) => {
  log('STACK DEPLOYMENT FAILED', 'error');
  console.error(error);
  process.exit(1);
});
