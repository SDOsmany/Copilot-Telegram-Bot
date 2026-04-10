#!/usr/bin/env node

/**
 * Startup wrapper that ensures Loki is running before launching the bot.
 *
 * Usage (from package.json scripts):
 *   node scripts/start.js tsx src/index.ts
 *   node scripts/start.js tsx watch src/index.ts
 *
 * Behavior:
 *   1. Reads .env — if LOKI_URL is set, starts the Loki Docker Compose stack
 *   2. Waits for Loki to be healthy (/ready endpoint)
 *   3. Spawns the bot command (everything after "start.js")
 *
 * If Docker is unavailable or Loki fails to start, a warning is printed
 * and the bot starts anyway.
 */

import { spawn, execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const COMPOSE_FILE = resolve(PROJECT_ROOT, 'docker-compose.loki.yml');
const LOKI_READY_TIMEOUT_MS = 30_000;
const LOKI_POLL_INTERVAL_MS = 1_000;

/**
 * Reads LOKI_URL from .env file without pulling in the full config module
 * (which has side effects we don't want in this lightweight wrapper).
 */
function getLokiUrl() {
  try {
    const envPath = resolve(PROJECT_ROOT, '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key.trim() === 'LOKI_URL') {
        const value = rest.join('=').trim().replace(/^["']|["']$/g, '');
        return value || null;
      }
    }
  } catch {
    // .env doesn't exist — that's fine
  }
  return process.env.LOKI_URL || null;
}

/**
 * Checks if Docker is available on this machine.
 */
function isDockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the Loki stack via Docker Compose.
 * Returns true if compose started successfully, false otherwise.
 */
function startLokiStack() {
  try {
    console.log('🔶 Starting Loki log stack...');
    execSync(`docker compose -f "${COMPOSE_FILE}" up -d`, {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
      timeout: 60_000,
    });
    return true;
  } catch (err) {
    console.warn(`⚠️  Failed to start Loki stack: ${err.message}`);
    return false;
  }
}

/**
 * Waits for Loki's /ready endpoint to return 200.
 */
async function waitForLokiReady(lokiUrl) {
  const readyUrl = `${lokiUrl.replace(/\/$/, '')}/ready`;
  const deadline = Date.now() + LOKI_READY_TIMEOUT_MS;

  console.log(`🔶 Waiting for Loki to be ready at ${readyUrl}...`);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(readyUrl);
      if (res.ok) {
        console.log('✅ Loki is ready');
        return true;
      }
    } catch {
      // Connection refused — Loki not ready yet
    }
    await new Promise((r) => setTimeout(r, LOKI_POLL_INTERVAL_MS));
  }

  console.warn(`⚠️  Loki did not become ready within ${LOKI_READY_TIMEOUT_MS / 1000}s — continuing anyway`);
  return false;
}

/**
 * Spawns the bot process, forwarding stdio and exit code.
 * On Windows, uses npx to resolve local bin commands (tsx, etc.)
 * to avoid shell: true deprecation warnings.
 */
function spawnBot(args) {
  const [cmd, ...rest] = args;

  // Use cross-spawn behavior: on Windows, resolve .cmd/.bat wrappers via shell
  const child = spawn(cmd, rest, {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
    env: process.env,
    // Windows needs shell to resolve .cmd bin stubs (tsx.cmd, etc.)
    ...(process.platform === 'win32' ? { shell: true } : {}),
  });

  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    console.error(`Failed to start bot: ${err.message}`);
    process.exit(1);
  });

  // Forward signals to child
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
}

// ── Main ──

async function main() {
  const botArgs = process.argv.slice(2);
  if (botArgs.length === 0) {
    console.error('Usage: node scripts/start.js <command> [args...]');
    console.error('Example: node scripts/start.js tsx src/index.ts');
    process.exit(1);
  }

  const lokiUrl = getLokiUrl();

  if (lokiUrl) {
    if (!isDockerAvailable()) {
      console.warn('⚠️  LOKI_URL is set but Docker is not available — skipping Loki startup');
    } else {
      const started = startLokiStack();
      if (started) {
        await waitForLokiReady(lokiUrl);
      }
    }
  }

  spawnBot(botArgs);
}

main().catch((err) => {
  console.error(`Startup error: ${err.message}`);
  process.exit(1);
});
