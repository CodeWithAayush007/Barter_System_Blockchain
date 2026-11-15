// Small wrapper so `npm run proof -- <hash>` works (Hardhat itself rejects extra positional arguments).
const { spawnSync } = require("child_process");
const path = require("path");
const hash = process.argv.slice(2).find((a) => /^0x[0-9a-fA-F]{64}$/.test(a)) || "";
const bootstrap = path.join(path.dirname(require.resolve("hardhat/package.json")), "internal", "cli", "bootstrap.js");
const r = spawnSync(process.execPath, [bootstrap, "run", "scripts/proof.js", "--network", "localhost"], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  env: { ...process.env, PROOF_HASH: hash },
});
process.exit(r.status ?? 1);
