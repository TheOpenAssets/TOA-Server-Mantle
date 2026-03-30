import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
const ARB_SEPOLIA_RPC = process.env.MANTLE_RPC_URL || process.env.ARB_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const BNB_TESTNET_RPC =
  process.env.BNB_TESTNET_RPC_URL ||
  process.env.BSC_TESTNET_RPC_URL ||
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    arbitrumSepolia: {
      url: ARB_SEPOLIA_RPC,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 421614,
      timeout: 120000,
    },
    arbitrum: {
      url: "https://arb1.arbitrum.io/rpc",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 42161,
    },
    bnbTestnet: {
      url: BNB_TESTNET_RPC,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 97,
      timeout: 120000,
    },
  },
};

export default config;
