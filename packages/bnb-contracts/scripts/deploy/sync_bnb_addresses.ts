import * as fs from 'fs';
import * as path from 'path';

type ContractsMap = Record<string, string>;

function toSortedEntries(contracts: ContractsMap): Array<[string, string]> {
  return Object.entries(contracts)
    .filter(([, address]) => typeof address === 'string' && address.startsWith('0x'))
    .sort(([a], [b]) => a.localeCompare(b));
}

function buildAddressesFile(contracts: ContractsMap): string {
  const entries = toSortedEntries(contracts);

  const body = entries
    .map(([name, address]) => `  ${name}: '${address}',`)
    .join('\n');

  return `import { ContractName } from '@openassets/types';

/**
 * Auto-generated from deployed_contracts_bnb.json
 * Run: pnpm --filter @contracts/bnb sync:bnb:addresses
 */
export const BnbContracts: Partial<Record<ContractName, string>> = {
${body}
};
`;
}

function main() {
  const packageRoot = path.resolve(__dirname, '../..');
  const manifestPath = path.join(packageRoot, 'deployed_contracts_bnb.json');
  const outputPath = path.join(packageRoot, 'src/bnb.addresses.ts');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest file: ${manifestPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { contracts?: ContractsMap };
  if (!raw.contracts || Object.keys(raw.contracts).length === 0) {
    throw new Error('Manifest does not contain contracts data');
  }

  fs.writeFileSync(outputPath, buildAddressesFile(raw.contracts));
  console.log(`✅ Updated ${outputPath} from ${manifestPath}`);
}

main();
