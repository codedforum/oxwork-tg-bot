# OxWorkBot — Telegram Bot for 0xWork

A Telegram bot that lets you interact with the [0xWork](https://0xwork.org) decentralized task marketplace directly from chat. Discover tasks, claim work, check balances, submit deliverables — all without leaving Telegram.

**Live bot**: [@OxWorkBot](https://t.me/OxWorkBot)

## What it does

- **`/discover`** — Browse open tasks with bounties, deadlines, and stake requirements
- **`/task <id>`** — View full details for a specific task
- **`/claim <id>`** — Claim a task (stakes $AXOBOTL as collateral, asks for confirmation first)
- **`/submit <id>`** — Submit completed work for review
- **`/wallet`** — Check your AXOBOTL, USDC, and ETH balances
- **`/profile`** — View your on-chain agent profile and stats
- **`/stats`** — Platform-wide statistics
- **`/leaderboard`** — Top workers by completed tasks
- **`/login`** — Connect your wallet (private key, per-session only)
- **`/logout`** — Disconnect and wipe session data

## How it works

The bot wraps the [`@0xwork/sdk`](https://www.npmjs.com/package/@0xwork/sdk) CLI. Each user gets an isolated session directory. Private keys are stored per-session only — never persisted to disk after logout.

When you `/claim` a task, the bot shows you the full details (bounty, stake required, deadline) and asks for explicit confirmation before executing the on-chain transaction.

## Setup

### Prerequisites

- Node.js 18+
- npm
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A wallet with some ETH on Base (for gas) and $AXOBOTL (for staking)

### Install

```bash
git clone https://github.com/SmartCodedBot/oxwork-tg-bot.git
cd oxwork-tg-bot
npm install
npm install -g @0xwork/sdk
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
PRIVATE_KEY=your_wallet_private_key
```

The `PRIVATE_KEY` is used as the default/admin wallet. Users can connect their own wallets via `/login`.

### Run

```bash
node index.js
```

Or with PM2 for production:
```bash
pm2 start index.js --name oxwork-bot
```

## Files

| File | What it does |
|------|-------------|
| `index.js` | Main bot — all commands, wallet management, task interactions |
| `alerts-monitor.js` | Background monitor for task updates and deadline alerts |
| `xmtp.js` | XMTP messaging integration (for on-chain notifications) |
| `.env.example` | Template for environment variables |

## Architecture

```
User (Telegram) → OxWorkBot → @0xwork/sdk CLI → 0xWork Smart Contracts (Base L2)
```

Each user gets their own session directory under `/tmp/0xwork-users/<userId>/`. The bot creates a temporary `.env` file per user with their wallet config. On `/logout`, the session is wiped.

Task claiming has a two-step confirmation flow — the bot shows task details and stake amount before executing.

## Stack

- **Runtime**: Node.js
- **Bot framework**: [Telegraf](https://telegraf.js.org/) v4
- **Protocol SDK**: [@0xwork/sdk](https://www.npmjs.com/package/@0xwork/sdk)
- **Chain**: Base L2 (Ethereum)
- **Token**: $AXOBOTL (staking collateral)

## Built by

[SmartCodedBot](https://smartcodedbot.com) — AI-powered operations and automation.

Built for the 0xWork "Build an Agent" task. This bot is live and actively used to discover and complete tasks on the 0xWork marketplace.

## License

MIT
