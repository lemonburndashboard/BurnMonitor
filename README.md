# Lemon Burn Monitor

A real-time token burn and staking dashboard for the **Lemon Chain Network**. Monitors 19 ERC-20 tokens across the chain, displaying live burn events, session burn totals, and lifetime supply-burned percentages — all wired to on-chain data via the Lemon Chain block explorer API.

---

## Features

- **Live burn feed** — detects token transfers to burn addresses within seconds of confirmation
- **Live staking feed** — detects LEMX stake (`delegate`) calls to the staking contract
- **Lifetime burn %** — progress bar per token showing total supply burned (summed across all burn addresses)
- **30-day stats** — per-token burn count and total burned over the last 30 days (rolling window)
- **Token isolation** — click a token card to focus the chart on that token
- **Visual intensity** — spike height scales with burn size (< 100 / < 1,000 / < 10,000 / 10,000+)
- **Tweaks panel** — toggle scanlines, chart density, and live mode

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express + Socket.IO |
| Blockchain data | Lemon Chain BlockScout API (`https://explorer.lemonchain.io/api`) |
| Frontend | Single-file HTML — React 18 (CDN) + Babel standalone |
| Real-time | Socket.IO WebSocket (port 3001) |

---

## Project Structure

```
BurnMonitor/
├── server.js       # Backend — polls blockchain, emits Socket.IO events
├── index.html      # Frontend — React dashboard (open directly in browser)
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher

### Installation

```bash
# Install dependencies
npm install

# (Optional) Configure CORS and other settings
cp .env.example .env
# Edit .env to set your ALLOWED_ORIGIN
```

### Configuration

The server uses environment variables for security configuration:

- **ALLOWED_ORIGIN**: Controls which domains can connect to the Socket.IO server (default: `http://localhost:8080`)
  - For local development: `http://localhost:8080` or `http://localhost:*`
  - For production: Set to your actual domain (e.g., `https://yourdomain.com`)
  - Multiple origins: Separate with commas

### Security Features

- **CORS Protection**: Restricts Socket.IO connections to allowed origins
- **Memory Safety**: Hard caps on event storage (50,000 events max) to prevent unbounded growth
- **Connection Limits**: Maximum 100 concurrent connections to prevent DoS
- **Input Validation**: All API responses are validated before processing
- **Automatic Cleanup**: Old transaction hashes are pruned from memory hourly

### Running

```bash
npm start
```

The server starts on **http://localhost:3001**.

Open `index.html` in your browser:
- **Method 1** (easiest): Double-click `index.html` to open directly in your browser
- **Method 2**: Serve via any static file server and access through `http://localhost`

The dashboard will connect automatically to the server at `localhost:3001`.

**Note**: The server is configured to accept connections from both `file://` protocol (opening the HTML file directly) and standard `http://localhost` origins.

---

## Tracked Tokens

| Token | Name | Burn Address |
|---|---|---|
| LFLX | LemFlix | BURN_ADDR_B + BURN_ADDR_C |
| LPAY | LemPay | BURN_ADDR_C |
| LLOT | LemLotto | BURN_ADDR_C |
| LBNK | LemBank | BURN_ADDR_C |
| LMED | LemMed | BURN_ADDR_C |
| LMLN | LemLoans | BURN_ADDR_A + BURN_ADDR_C |
| CTFZ | Catfiz | BURN_ADDR_C |
| LTVL | Lemtravel | BURN_ADDR_C |
| LLUX | LemLux | BURN_ADDR_A + BURN_ADDR_C |
| LSQZ | LemSqueeze | BURN_ADDR_A + BURN_ADDR_C |
| HXDX | HexDEX | BURN_ADDR_C |
| PUP | Wasatch Pup | BURN_ADDR_C |
| HXBT | HexBet | BURN_ADDR_C |
| TIXA | TIXA | BURN_ADDR_C |
| NXYS | NXYS | BURN_ADDR_C |
| STH | STH | BURN_ADDR_C |
| MHSA | MHSA | BURN_ADDR_C |
| RMC | RMC | BURN_ADDR_C |
| SMART | SMART | BURN_ADDR_C |

**Staking:** LEMX — contract `0xFC00FACE00000000000000000000000000000000`

### Burn Addresses

| Label | Address |
|---|---|
| BURN_ADDR_A | `0xad56ed5956c5d1983a160dd94b672ca827d55f02` |
| BURN_ADDR_B | `0x0a60fD344dC88731d82b8DC41a6e8C1aa857BeD8` |
| BURN_ADDR_C | `0x7767A0072b4e8d7D65d469722d6AE229f5605cB7` (TokenBurner contract) |

---

## How It Works

1. **server.js** polls the BlockScout-compatible API every 5 seconds for new token transfers arriving at each burn address, filtered per token contract.
2. Newly detected burns are emitted to all connected clients via Socket.IO as `burn` events.
3. The server maintains a 30-day rolling window of burn and stake events. Events older than 30 days are automatically pruned.
4. Every 5 minutes, supply percentages are recalculated by fetching `totalSupply` and summing `tokenbalance` at all burn addresses — this reflects lifetime all-time burns.
5. **index.html** connects via Socket.IO and updates the React UI in real time — no page refresh needed.

---

## Socket.IO Events

| Event | Direction | Payload |
|---|---|---|
| `burn` | server → client | `{ token, strength, amount, hash, timestamp }` |
| `stake` | server → client | `{ token, strength, amount, hash, timestamp }` |
| `supply` | server → client | `{ token, pct }` (lifetime burn %) |
| `stats30d` | server → client | `{ burnStats, lemxStats }` (sent on connect) |
