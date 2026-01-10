import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const TINV_TOKEN = '0xB7292c58e9Af0b32A87dbf19056B54c74fD0b8A8';

const TINV_ABI = [
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)',
  // Check if burn functions exist
];

async function main() {
  console.log('\n============================================================');
  console.log('Check Token Interface');
  console.log('============================================================\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const token = new ethers.Contract(TINV_TOKEN, TINV_ABI, provider);

  console.log('Token:', TINV_TOKEN);

  console.log('\n📊 Token Info...\n');
  
  const name = await token.name();
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const totalSupply = await token.totalSupply();
  
  console.log('Name:', name);
  console.log('Symbol:', symbol);
  console.log('Decimals:', decimals);
  console.log('Total Supply:', ethers.formatUnits(totalSupply, decimals));

  console.log('\n🧪 Testing if burn functions exist...\n');
  
  // Try to call burn function (should exist on ERC20Burnable)
  const burnableABI = [
    'function burn(uint256 amount) external',
    'function burnFrom(address account, uint256 amount) external',
  ];
  
  const burnableToken = new ethers.Contract(TINV_TOKEN, burnableABI, provider);
  
  try {
    // Try to get the function selector
    const burnSelector = burnableToken.interface.getFunction('burn').selector;
    console.log('✅ burn() function exists, selector:', burnSelector);
  } catch (e) {
    console.log('❌ burn() function not found');
  }
  
  try {
    const burnFromSelector = burnableToken.interface.getFunction('burnFrom').selector;
    console.log('✅ burnFrom() function exists, selector:', burnFromSelector);
  } catch (e) {
    console.log('❌ burnFrom() function not found');
  }

  console.log('\n💡 Let me try to actually call burnFrom with 0 amount to see what happens...\n');
  
  try {
    // Static call with 0 amount from admin - should revert with specific error
    await burnableToken.burnFrom.staticCall(
      '0x23e67597f0898f747Fa3291C8920168adF9455D0',
      0
    );
    console.log('burnFrom(admin, 0) succeeded (unexpected)');
  } catch (error) {
    console.log('burnFrom(admin, 0) failed:', error.message.split('\n')[0]);
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
