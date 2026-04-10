# Loki Log Querying Guide

This guide covers how to query bot logs stored in Grafana Loki using LogCLI and the Grafana UI.

## Setup

### Install LogCLI

**Windows (scoop):**
```powershell
scoop install logcli
```

**macOS:**
```bash
brew install logcli
```

**Manual:** Download from [Loki releases](https://github.com/grafana/loki/releases) — grab the `logcli` binary for your platform.

### Configure LogCLI

```bash
export LOKI_ADDR=http://localhost:3100
```

Or on Windows PowerShell:
```powershell
$env:LOKI_ADDR = "http://localhost:3100"
```

---

## LogQL Basics

Loki uses **LogQL** — similar to Kusto/KQL in structure. Queries start with a **stream selector** (labels in `{}`) and optionally add **filters**.

### Labels available

| Label | Values | Description |
|-------|--------|-------------|
| `app` | `copilot-bot` | Application name |
| `env` | `development`, `production` | Environment |
| `level` | `error`, `warn`, `info`, `debug` | Log level |

---

## Common Queries

### Recent errors (last hour)
```bash
logcli query '{app="copilot-bot",level="error"}' --since=1h
```

### All logs from the last 30 minutes
```bash
logcli query '{app="copilot-bot"}' --since=30m
```

### Search for a specific keyword
```bash
logcli query '{app="copilot-bot"} |= "session"' --since=1h
```

### Errors containing a specific text
```bash
logcli query '{app="copilot-bot",level="error"} |= "timeout"' --since=24h
```

### Exclude noisy patterns
```bash
logcli query '{app="copilot-bot"} != "heartbeat" != "SDK event: tool"' --since=1h
```

### Case-insensitive search
```bash
logcli query '{app="copilot-bot"} |~ "(?i)session.*error"' --since=2h
```

### Regex matching
```bash
logcli query '{app="copilot-bot"} |~ "userId.*1234"' --since=1h
```

---

## AI-Friendly Output Formats

### JSON Lines (recommended for AI)
```bash
logcli query '{app="copilot-bot",level="error"}' --since=1h --output=jsonl
```

Each line is a JSON object with `timestamp`, `labels`, and `line` fields — ideal for piping to AI tools.

### Raw text (compact)
```bash
logcli query '{app="copilot-bot"}' --since=30m --output=raw
```

### Limit results
```bash
logcli query '{app="copilot-bot",level="error"}' --since=24h --limit=50
```

### Save to file for AI analysis
```bash
logcli query '{app="copilot-bot",level="error"}' --since=24h --output=jsonl > errors.jsonl
```

---

## Debugging Scenarios

### Session resume issues
```bash
logcli query '{app="copilot-bot"} |~ "resume|switchProject|Creating new session"' --since=2h
```

### Telegram network errors
```bash
logcli query '{app="copilot-bot"} |= "ECONNRESET" or |= "runner error"' --since=6h
```

### SDK errors
```bash
logcli query '{app="copilot-bot"} |= "session.error" or |= "SDK event: session.error"' --since=4h
```

### Timeout issues
```bash
logcli query '{app="copilot-bot"} |~ "timeout|timed out|extension"' --since=12h
```

### Security events (blocked paths)
```bash
logcli query '{app="copilot-bot"} |= "Blocked session creation" or |= "pathNotAllowed"' --since=24h
```

### MCP server issues
```bash
logcli query '{app="copilot-bot"} |~ "(?i)mcp.*error|mcp.*fail"' --since=6h
```

---

## Time Range Syntax

| Syntax | Meaning |
|--------|---------|
| `--since=30m` | Last 30 minutes |
| `--since=2h` | Last 2 hours |
| `--since=24h` | Last 24 hours |
| `--since=7d` | Last 7 days |
| `--from="2026-04-09T00:00:00Z" --to="2026-04-09T23:59:59Z"` | Specific range |

---

## Grafana UI

Open `http://localhost:3000` → Explore → Select "Loki" datasource.

Use the same LogQL queries in the query box. Grafana adds:
- Live tail (real-time log streaming)
- Visual histogram of log volume over time
- Click-to-filter on labels

---

## LogQL vs KQL Cheat Sheet

| KQL (Kusto) | LogQL (Loki) |
|-------------|-------------|
| `traces \| where message contains "error"` | `{app="copilot-bot"} \|= "error"` |
| `traces \| where timestamp > ago(1h)` | `--since=1h` |
| `traces \| where severityLevel == 3` | `{level="error"}` |
| `traces \| where message matches regex "session.*"` | `\|~ "session.*"` |
| `traces \| project timestamp, message` | `--output=jsonl` (timestamp + line) |
| `traces \| order by timestamp desc \| take 50` | `--limit=50` (newest first by default) |
