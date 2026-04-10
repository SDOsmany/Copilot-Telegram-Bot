#!/usr/bin/env node

/**
 * Unified stop script — stops the bot (PM2) and Loki stack if running.
 *
 * Usage:
 *   npm stop
 *
 * Behavior:
 *   1. Stops the PM2-managed bot process (if any)
 *   2. Checks if LOKI_URL is set in .env
 *   3. If set, stops the Loki Docker Compose stack
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const COMPOSE_FILE = resolve(PROJECT_ROOT, 'docker-compose.loki.yml');

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
    // .env doesn't exist
  }
  return process.env.LOKI_URL || null;
}

function run(cmd, label) {
  try {
    execSync(cmd, { stdio: 'inherit', cwd: PROJECT_ROOT, timeout: 30_000 });
    return true;
  } catch {
    console.warn(`⚠️  ${label} — skipped or already stopped`);
    return false;
  }
}

// ── Main ──

// 1. Stop PM2 bot process
console.log('🔶 Stopping bot (PM2)...');
run('pm2 stop telegram-copilot', 'PM2 stop');
run('pm2 stop copilot-telegram-bot', 'PM2 stop (alt name)');

// 2. Stop Loki if configured
const lokiUrl = getLokiUrl();
if (lokiUrl) {
  console.log('🔶 Stopping Loki stack...');
  const stopped = run(`docker compose -f "${COMPOSE_FILE}" stop`, 'Docker Compose stop');
  if (stopped) {
    console.log('✅ Loki stack stopped');
  }
} else {
  console.log('ℹ️  LOKI_URL not set — skipping Loki shutdown');
}

console.log('✅ All stopped');
