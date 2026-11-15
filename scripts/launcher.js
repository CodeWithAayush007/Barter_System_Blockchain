/**
 * launcher.js — starts the whole project with ONE command from this folder.
 *
 *   npm run setup       install the dependencies of all three folders
 *   npm run dev         local blockchain + contracts + backend API + website
 *   npm run dev:demo    same, plus a few demo listings on the chain
 *
 * It starts, in this order (waiting for each step):
 *   [chain]  Blockchain/    npm run dev     → local chain on :8545, contracts deployed
 *   [api]   backend_test/  npm run dev     → API on :5000   (needs MongoDB only for sign-in/activity; photos need Cloudinary keys in .env)
 *   [web]   Frontend/      npm run dev     → website on :5173
 * Press Ctrl+C once to stop all of them.
 *
 * No extra packages are needed — this is plain Node, and works on Windows, macOS and Linux.
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..");
const IS_WIN = process.platform === "win32";
const COLORS = { chain: "\x1b[33m", api: "\x1b[36m", web: "\x1b[35m", run: "\x1b[32m", reset: "\x1b[0m" };
const FOLDERS = { chain: "Blockchain", api: "backend_test", web: "Frontend" };

const cmd = process.argv[2] || "dev";
const DEMO = process.argv.includes("--demo");

const say = (m = "") => console.log(`${COLORS.run}[run]${COLORS.reset} ${m}`);

// ── Node version check ──────────────────────────────────────────────────────
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 18) {
  console.error(`Node.js 18 or newer is required (you have ${process.versions.node}). Install the LTS version from https://nodejs.org and try again.`);
  process.exit(1);
}

// ── install ─────────────────────────────────────────────────────────────────
function install(name, force) {
  const dir = path.join(ROOT, FOLDERS[name]);
  if (!force && fs.existsSync(path.join(dir, "node_modules"))) return true;
  say(`Installing dependencies in ${FOLDERS[name]}/ …`);
  const r = spawnSync("npm install --no-audit --no-fund", { cwd: dir, shell: true, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\nnpm install failed in ${FOLDERS[name]}/ (exit ${r.status}). Fix the error above and run the command again.`);
    return false;
  }
  return true;
}

function installAll(force) {
  for (const name of Object.keys(FOLDERS)) if (!install(name, force)) return false;
  return true;
}

// ── process helpers ─────────────────────────────────────────────────────────
const children = [];
let stopping = false;

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try {
    if (IS_WIN) spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill(); } catch { /* already gone */ }
  }
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  say("Stopping…");
  children.forEach(killTree);
  setTimeout(() => process.exit(code), 800);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

/** Starts `command` in a folder; every output line is printed with a coloured [name] prefix. */
function start(name, command, onLine) {
  const child = spawn(command, {
    cwd: path.join(ROOT, FOLDERS[name]),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !IS_WIN, // own process group on macOS/Linux, so Ctrl+C can stop the whole tree
    env: { ...process.env, NO_COLOR: "1" }, // plain text, so the lines below can be matched reliably
  });
  children.push(child);
  const prefix = `${COLORS[name]}[${name}]${COLORS.reset} `;
  const pipe = (stream) =>
    readline.createInterface({ input: stream }).on("line", (line) => {
      console.log(prefix + line);
      onLine?.(line.replace(/\x1b\[[0-9;]*m/g, "")); // match on the text without colour codes
    });
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
}

function waitForLine(name, command, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const child = start(name, command, (line) => {
      const m = !done && line.match(pattern);
      if (m) { done = true; resolve(m); }
    });
    child.on("exit", (code) => {
      if (!done) { done = true; reject(new Error(`${FOLDERS[name]} stopped before it was ready (exit code ${code}).`)); }
    });
    setTimeout(() => { if (!done) { done = true; reject(new Error(`Timed out waiting for ${FOLDERS[name]} to start.`)); } }, timeoutMs);
  });
}

// ── main ────────────────────────────────────────────────────────────────────
async function dev() {
  if (!installAll(false)) return process.exit(1);

  // The API needs a .env; create one with working local defaults if it is missing.
  const envFile = path.join(ROOT, FOLDERS.api, ".env");
  const envExample = path.join(ROOT, FOLDERS.api, ".env.example");
  if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile);
    say("Created backend_test/.env from .env.example (edit MONGODB_URI there to use MongoDB Atlas).");
  }

  // The website needs its own .env for the (public) Cloudinary cloud name.
  const webEnv = path.join(ROOT, FOLDERS.web, ".env");
  const webEnvExample = path.join(ROOT, FOLDERS.web, ".env.example");
  if (!fs.existsSync(webEnv) && fs.existsSync(webEnvExample)) {
    fs.copyFileSync(webEnvExample, webEnv);
    say("Created Frontend/.env from .env.example.");
  }

  // Photos are stored on Cloudinary. Trading works without it; photos don't — so say so up front.
  const envValue = (file, key) => {
    try {
      const m = fs.readFileSync(file, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
      return m ? m[1].trim() : "";
    } catch { return ""; }
  };
  const apiMissing = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].filter((k) => !envValue(envFile, k));
  const webMissing = envValue(webEnv, "VITE_CLOUDINARY_CLOUD_NAME") ? [] : ["VITE_CLOUDINARY_CLOUD_NAME"];
  if (apiMissing.length || webMissing.length) {
    say(`Photos need Cloudinary. Still empty: ${[...apiMissing.map((k) => "backend_test/.env " + k), ...webMissing.map((k) => "Frontend/.env " + k)].join(", ")}.`);
    say("Everything else works without it; see the README (\"Cloudinary setup\") for where to find these values.");
  }

  say("Step 1/3 — local blockchain + contracts (the very first run compiles the contracts, which can take a minute)…");
  try {
    await waitForLine("chain", DEMO ? "npm run dev:demo" : "npm run dev", /\[dev\] READY/, 15 * 60 * 1000);
  } catch (err) {
    console.error(`\n${err.message}`);
    return stopAll(1);
  }

  say("Step 2/3 — backend API…");
  const api = start("api", "npm run dev");
  api.on("exit", (code) => {
    if (!stopping) say(`The API stopped (exit ${code}). Trading on the blockchain still works; sign-in, photo uploads and the activity feed need the API.`);
  });

  say("Step 3/3 — website…");
  let webUrl = null;
  const web = start("web", "npm run dev", (line) => {
    const m = line.match(/Local:\s+(https?:\/\/\S+)/);
    if (m && !webUrl) {
      webUrl = m[1].replace(/\/$/, "");
      console.log("");
      console.log("══════════════════════════════════════════════════════════════");
      console.log(`  ALL RUNNING — open  ${webUrl}  in the browser that has MetaMask`);
      console.log("  Stop everything with Ctrl+C.");
      console.log("══════════════════════════════════════════════════════════════");
      console.log("");
    }
  });
  web.on("exit", (code) => {
    if (!stopping) {
      console.error(`\nThe website stopped (exit ${code}).`);
      stopAll(1);
    }
  });
  children[0].on("exit", (code) => {
    if (!stopping) {
      console.error(`\nThe blockchain stopped (exit ${code}) — shutting everything down.`);
      stopAll(1);
    }
  });
}

if (cmd === "setup") {
  process.exit(installAll(true) ? 0 : 1);
} else if (cmd === "dev") {
  dev().catch((err) => { console.error(err); stopAll(1); });
} else {
  console.error(`Unknown command "${cmd}". Use: setup | dev`);
  process.exit(1);
}
