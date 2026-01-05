import { ethers } from 'ethers';
const key = '0x4dd8f6b570ebcabdb4c4b8d702b66c6efbaaff1f8f8ba9a79983115a02a38b04';
const wallet = new ethers.Wallet(key);
console.log(wallet.address);
