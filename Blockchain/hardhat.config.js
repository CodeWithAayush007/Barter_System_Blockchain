// Plain-JavaScript config (the old hardhat.config.ts needed ts-node/typescript just to
// read these few lines, which is a common source of "cannot run hardhat" errors).
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config(); // reads Blockchain/.env (git-ignored) — used only for the Sepolia deploy

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    // Public test network shared by every device. Only added when both values exist in
    // Blockchain/.env, so local development (`npm run dev`) works without them.
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? {
          sepolia: {
            url: SEPOLIA_RPC_URL,
            chainId: 11155111,
            accounts: [DEPLOYER_PRIVATE_KEY.startsWith("0x") ? DEPLOYER_PRIVATE_KEY : `0x${DEPLOYER_PRIVATE_KEY}`],
          },
        }
      : {}),
  },
};
