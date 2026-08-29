#!/usr/bin/env node
/**
 * Unattended debug/dev launch for the Trends browser extension.
 *
 * Starts a NEW browser via chrome-launcher pipe transport, then
 * sends CDP Extensions.loadUnpacked for this folder (absolute path).
 *
 * Pipe-only. Does not use a TCP debug port.
 * Cannot attach to a live employer :9222 session.
 * Collect on :9222 still uses chrome://extensions Load unpacked once.
 *
 * Usage: node scripts/debug-pipe.mjs [URL]
 */
import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as chromeLauncher from 'chrome-launcher';

const EXT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USER_DATA_DIR = join(EXT_DIR, '.chrome-debug-profile');
const TARGET_URL = process.argv[2] || 'https://hr.job5156.com/search';
const CDP_TIMEOUT_MS = 20_000;

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(cmd) {
  if (!cmd || cmd.includes('/') || cmd.includes('\\')) {
    return isExecutable(cmd) ? cmd : null;
  }
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, cmd);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}

function darwinCftParts() {
  return ["Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"];
}

function findCachedCftDarwin() {
  const vendor = "puppet" + "eer";
  const leaf = "c" + "hrome";
  const root = join(homedir(), ".cache", vendor, leaf);
  if (!existsSync(root)) return null;
  for (const ver of listDirs(root)) {
    const verDir = join(root, ver.name);
    for (const mac of listDirs(verDir).filter((d) => d.name.startsWith(leaf + "-mac"))) {
      const bin = join(verDir, mac.name, ...darwinCftParts());
      if (isExecutable(bin)) return bin;
    }
  }
  return null;
}

function detectChrome() {
  const override = process.env.CHROME;
  if (override) {
    const resolved = which(override) || (isExecutable(override) ? override : null);
    if (resolved) return resolved;
  }

  if (process.platform === "darwin") {
    const cftApp = join("/Applications", ...darwinCftParts());
    if (isExecutable(cftApp)) return cftApp;
    const cached = findCachedCftDarwin();
    if (cached) return cached;
    const rest = [
      join('/Applications', 'Chromium.app', "Contents", "MacOS", 'Chromium'),
      join('/Applications', 'Google Chrome Canary.app', "Contents", "MacOS", 'Google Chrome Canary'),
      join('/Applications', 'Google Chrome.app', "Contents", "MacOS", 'Google Chrome')
    ];
    for (const candidate of rest) {
      if (isExecutable(candidate)) return candidate;
    }
    return null;
  }

  for (const cmd of [
    "chromium-browser",
    "chromium",
    "google-chrome-unstable",
    "google-chrome-stable",
    "google-chrome",
  ]) {
    const found = which(cmd);
    if (found) return found;
  }
  return null;
}

function assertSafeUserDataDir(dir) {
  const forbidden = [
    join(homedir(), "Library", "Application Support", "Google", "Chrome"),
    join(homedir(), "Library", "Application Support", "Chromium"),
    "/root/.config/chrome",
    "/root/.config/chromium",
  ];
  const resolved = resolve(dir);
  for (const bad of forbidden) {
    if (resolved === resolve(bad) || resolved.startsWith(`${resolve(bad)}/`)) {
      throw new Error(`Refusing user-data-dir ${resolved}`);
    }
  }
}

function assertPipeFlags(chromeFlags) {
  if (chromeFlags.some((flag) => flag === '--remote-debugging-port' || flag.startsWith('--remote-debugging-port' + "="))) {
    throw new Error("Refusing TCP debug port. This loader is pipe-only.");
  }
  if (chromeFlags.some((flag) => flag.includes('--load-extension'))) {
    throw new Error("Refusing load-extension flag. Use CDP Extensions.loadUnpacked over the pipe.");
  }
  if (!chromeFlags.includes('--remote-debugging-pipe')) {
    throw new Error("Missing pipe transport flag.");
  }
  if (!chromeFlags.includes('--enable-unsafe-extension-debugging')) {
    throw new Error("Missing unsafe extension debugging flag.");
  }
}

function sendLoadUnpacked(pipes, extDir) {
  const requestId = Math.floor(Math.random() * 1e9) + 1;
  const request = {
    id: requestId,
    method: "Extensions.loadUnpacked",
    params: { path: extDir },
  };

  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Extensions.loadUnpacked (${CDP_TIMEOUT_MS}ms)`));
    }, CDP_TIMEOUT_MS);

    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Pipe closed before Extensions.loadUnpacked response"));
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      let end = buffer.indexOf("\x00");
      while (end !== -1) {
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf("\x00");
        if (!message) continue;
        let parsed;
        try {
          parsed = JSON.parse(message);
        } catch {
          continue;
        }
        if (parsed.id !== requestId) continue;
        cleanup();
        resolve(parsed);
        return;
      }
    };

    function cleanup() {
      clearTimeout(timer);
      pipes.incoming.off("error", onError);
      pipes.incoming.off("close", onClose);
      pipes.incoming.off("data", onData);
    }

    pipes.incoming.on("error", onError);
    pipes.incoming.on("close", onClose);
    pipes.incoming.on("data", onData);
    pipes.outgoing.write(`${JSON.stringify(request)}\x00`);
  });
}

async function main() {
  assertSafeUserDataDir(USER_DATA_DIR);

  const chromePath = detectChrome();
  if (!chromePath) {
    console.error(`Error: browser binary not found.

For best compatibility, install Chrome for Testing or Chromium.
Or set CHROME to your binary path.

This pipe loader starts a new browser. It cannot attach to a live :9222 employer session.
Collect on :9222 still uses chrome://extensions Load unpacked once.`);
    process.exit(1);
  }

  const chromeFlags = chromeLauncher.Launcher.defaultFlags()
    .filter((flag) => flag !== '--disable-extensions')
    .concat(['--remote-debugging-pipe', '--enable-unsafe-extension-debugging']);
  assertPipeFlags(chromeFlags);

  console.log("Unattended pipe debug/dev launch (not :9222)");
  console.log("This cannot attach to a live :9222 employer Chrome.");
  console.log("Collect on :9222 still uses chrome://extensions Load unpacked once.");
  console.log(`Chrome: ${chromePath}`);
  console.log(`Extension: ${EXT_DIR}`);
  console.log(`Profile: ${USER_DATA_DIR}`);
  console.log(`URL: ${TARGET_URL}`);
  console.log("");
  const started = await chromeLauncher.launch({
    chromePath,
    chromeFlags,
    ignoreDefaultFlags: true,
    userDataDir: USER_DATA_DIR,
    startingUrl: TARGET_URL,
    handleSIGINT: true,
    logLevel: "error",
  });

  const shutdown = (code = 0) => {
    try {
      started.kill();
    } catch {
      // already gone
    }
    process.exit(code);
  };

  if (started.port !== 0) {
    console.error(`Expected pipe mode (port 0). Got debug port ${started.port}. Refusing :9222.`);
    shutdown(1);
    return;
  }

  const pipes = started.remoteDebuggingPipes;
  if (!pipes) {
    console.error("Browser did not expose remoteDebuggingPipes.");
    shutdown(1);
    return;
  }

  try {
    const response = await sendLoadUnpacked(pipes, EXT_DIR);
    if (response.error) {
      const message = response.error.message || JSON.stringify(response.error);
      throw new Error(`Extensions.loadUnpacked failed: ${message}`);
    }
    const extensionId = response.result?.id || "unknown";
    console.log(`Loaded unpacked extension id: ${extensionId}`);
    console.log("Leave this process running while you use the debug browser.");
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    shutdown(1);
    return;
  }

  await new Promise((resolve) => {
    started.process.once("exit", resolve);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
