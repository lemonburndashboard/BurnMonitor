import express from "express";
import http from "http";
import { Server } from "socket.io";
import fetch from "node-fetch";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app    = express();
const server = http.createServer(app);

// Serve static files (index.html) from the same directory as server.js
app.use(express.static(__dirname));

// Simplified CORS - same as working server-simple.js
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT     = 3001;
const API_BASE = "https://explorer.lemonchain.io/api";

// ── Known burn addresses ──────────────────────────────────────────────────────
const BURN_ADDR_A = "0xad56ed5956c5d1983a160dd94b672ca827d55f02";
const BURN_ADDR_B = "0x0a60fD344dC88731d82b8DC41a6e8C1aa857BeD8";
const BURN_ADDR_C = "0x7767A0072b4e8d7D65d469722d6AE229f5605cB7"; // TokenBurner contract

// ── LEMX staking contract ─────────────────────────────────────────────────────
const LEMX_STAKING_CONTRACT = "0xFC00FACE00000000000000000000000000000000";

// ── All burn-tracked tokens ───────────────────────────────────────────────────
// burnAddrs: array — each address is polled independently; supply % sums all balances.
// On-chain data (verified via explorer) determines which address(es) each token uses.
const TOKENS = [
  { name: "LFLX",  address: "0x1bacc825fcd91971e8daca3104370380b4a981be",   burnAddrs: [BURN_ADDR_B, BURN_ADDR_C] },
  { name: "LPAY",  address: "0x708Cf95b67f3DFfF16E1F48313425d0CFb629Ee7",   burnAddrs: [BURN_ADDR_C] },
  { name: "LLOT",  address: "0xc8fa8354d6c6856de3e3f7da89f0ce4636e51710",   burnAddrs: [BURN_ADDR_C] },
  { name: "LBNK",  address: "0xc17eF640D7c34A8c684073d85d815539F66da3C7",   burnAddrs: [BURN_ADDR_C] },
  { name: "LMED",  address: "0xf489e786cF6242B3c32cfE5372453b37b8f0Cc13",   burnAddrs: [BURN_ADDR_C] },
  { name: "LMLN",  address: "0x6cC7ee8f2F45782CBF376B4021D41960b814f321",   burnAddrs: [BURN_ADDR_A, BURN_ADDR_C] },
  { name: "CTFZ",  address: "0x83D4B4DB63C40846735860ce3B2aDF83Aa9EdC8E",   burnAddrs: [BURN_ADDR_C] },
  { name: "LTVL",  address: "0x02535cBC23c045134A481CF8b6a6645E7655Efb8",   burnAddrs: [BURN_ADDR_C] },
  { name: "LLUX",  address: "0x71E3A635763910bCcF5f979eBBf8c69Cb9704DB0",   burnAddrs: [BURN_ADDR_A, BURN_ADDR_C] },
  { name: "LSQZ",  address: "0xCE37EDD204DEdBC256A7F5d3622e82F5Fc031CD8",   burnAddrs: [BURN_ADDR_A, BURN_ADDR_C] },
  { name: "HXDX",  address: "0x59100856DFbBb5A10bdAFC894B8f82c89a0aDC34",   burnAddrs: [BURN_ADDR_C] },
  { name: "PUP",   address: "0xDD84A98F9f9e0Be193bfD91c123254d835cB3b32",   burnAddrs: [BURN_ADDR_C] },
  { name: "HXBT",  address: "0xc9fD20a101f01EaC20e859645e91C9998aaa509B",   burnAddrs: [BURN_ADDR_C] },
  { name: "TIXA",  address: "0xe2677DA211265C092F1Bc4f018798AfBC20971DC",   burnAddrs: [BURN_ADDR_C] },
  { name: "NXYS",  address: "0x0f4Bb028EAa7f0d0545ddD24600C524c3E044962",   burnAddrs: [BURN_ADDR_C] },
  { name: "STH",   address: "0x3ed3BFBAc6ECe65468b37Abb15091F346f1b8905",   burnAddrs: [BURN_ADDR_C] },
  { name: "MHSA",  address: "0x8F9457a8dE85876951b3ac2843c09997B951C267",   burnAddrs: [BURN_ADDR_C] },
  { name: "RMC",   address: "0x5d59Ca7460b5e0C553e62B4B7B0197bF12aC1FB5",   burnAddrs: [BURN_ADDR_C] },
  { name: "SMART", address: "0x38374F0527e3320058c96AdCB57C6e78AfE9447E",   burnAddrs: [BURN_ADDR_C] },
];

// lastSeenBlock keyed by "TOKEN:burnAddr" so each address is tracked independently
const lastSeenBlock      = {};
TOKENS.forEach(t => { t.burnAddrs.forEach(addr => { lastSeenBlock[`${t.name}:${addr}`] = 0; }); });
let lastSeenStakingBlock = 0;
const seen               = new Set();

// ── 30-day rolling event storage ──────────────────────────────────────────────
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 50000; // Hard cap to prevent unbounded memory growth

const burnEvents  = []; // { token, amount, hash, timestamp }
const stakeEvents = []; // { amount, hash, timestamp }

// Helper functions to safely add events with memory caps
function addBurnEvent(event) {
  burnEvents.push(event);
  while (burnEvents.length > MAX_EVENTS) {
    burnEvents.shift();
  }
}

function addStakeEvent(event) {
  stakeEvents.push(event);
  while (stakeEvents.length > MAX_EVENTS) {
    stakeEvents.shift();
  }
}

// Clean old events (older than 30 days) and rebuild seen set
function pruneOldEvents() {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  
  // Remove old burn events
  while (burnEvents.length > 0 && burnEvents[0].timestamp < cutoff) {
    burnEvents.shift();
  }
  
  // Remove old stake events
  while (stakeEvents.length > 0 && stakeEvents[0].timestamp < cutoff) {
    stakeEvents.shift();
  }
  
  // Rebuild seen set with only recent hashes to prevent memory leak
  const recentHashes = new Set();
  [...burnEvents, ...stakeEvents].forEach(evt => recentHashes.add(evt.hash));
  seen.clear();
  recentHashes.forEach(h => seen.add(h));
  
  console.log(`🧹 Pruned old events. Current: ${burnEvents.length} burns, ${stakeEvents.length} stakes, ${seen.size} tracked hashes`);
}

// Calculate 30-day stats for all tokens
function get30DayStats() {
  pruneOldEvents();
  
  const stats = {};
  for (const token of TOKENS) {
    stats[token.name] = { count: 0, val: 0 };
  }
  
  for (const evt of burnEvents) {
    if (stats[evt.token]) {
      stats[evt.token].count++;
      stats[evt.token].val += evt.amount;
    }
  }
  
  const lemxStats = {
    count: stakeEvents.length,
    val: stakeEvents.reduce((sum, evt) => sum + evt.amount, 0)
  };
  
  return { burnStats: stats, lemxStats };
}

// Run cleanup every hour
setInterval(pruneOldEvents, 60 * 60 * 1000);

function normalizeAmount(value, decimals = 18) {
  // Input validation to prevent crashes from malformed data
  if (value == null) return 0;
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  
  const num = Number(value);
  if (!isFinite(num) || num < 0) return 0;
  
  return num / 10 ** decimals;
}
function mapToStrength(amount) {
  if (amount < 100)   return 0.5;
  if (amount < 1000)  return 1;
  if (amount < 10000) return 2;
  return 3;
}

const EMPTY_MESSAGES = [
  "No transactions found",
  "No token transfers found",
  "No records found",
];

async function apiFetch(params) {
  try {
    const url  = `${API_BASE}?${new URLSearchParams(params)}`;
    const res  = await fetch(url);
    
    // Handle rate limiting with retry
    if (res.status === 429) {
      console.warn('⚠️  Rate limited by API, waiting 30 seconds...');
      await new Promise(resolve => setTimeout(resolve, 30000));
      return []; // Return empty array, will retry on next poll
    }
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === "0" && !EMPTY_MESSAGES.includes(data.message)) {
      throw new Error(`API error: ${data.message}`);
    }
    return Array.isArray(data.result) ? data.result : [];
  } catch (err) {
    console.error(`API fetch error:`, err.message);
    return []; // Return empty array on error to prevent crashes
  }
}

async function apiScalar(params) {
  try {
    const url  = `${API_BASE}?${new URLSearchParams(params)}`;
    const res  = await fetch(url);
    
    // Handle rate limiting with retry
    if (res.status === 429) {
      console.warn('⚠️  Rate limited by API, waiting 30 seconds...');
      await new Promise(resolve => setTimeout(resolve, 30000));
      return null;
    }
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === "0") return null;
    return data.result;
  } catch (err) {
    console.error(`API scalar error:`, err.message);
    return null; // Return null on error to prevent crashes
  }
}

// ── Supply / burn-% tracking ──────────────────────────────────────────────────
const supplyCache = {};

async function fetchSupplyForToken(token) {
  let supplyRaw = await apiScalar({
    module: "stats", action: "tokensupply", contractaddress: token.address,
  });

  if (!supplyRaw) {
    const info = await apiScalar({
      module: "token", action: "getToken", contractaddress: token.address,
    });
    if (info && typeof info === "object") supplyRaw = info.totalSupply;
  }

  if (!supplyRaw) {
    console.warn(`⚠️  No total supply data for ${token.name} — bar will be hidden`);
    return;
  }

  // Sum burned balance across ALL burn addresses for this token
  let burnedTotal = 0n;
  for (const burnAddr of token.burnAddrs) {
    const raw = await apiScalar({
      module: "account", action: "tokenbalance",
      contractaddress: token.address, address: burnAddr,
    }) ?? "0";
    burnedTotal += BigInt(raw);
  }

  const totalSupply = BigInt(supplyRaw);
  if (totalSupply === 0n) return;

  const pct = Math.min(100, (Number(burnedTotal) / Number(totalSupply)) * 100);
  supplyCache[token.name] = { pct };
  io.emit("supply", { token: token.name, pct });
  console.log(`📊 ${token.name}: ${pct.toFixed(2)}% of supply burned`);
}

async function fetchAllSupply() {
  for (const token of TOKENS) {
    try { await fetchSupplyForToken(token); }
    catch (err) { console.error(`Supply fetch error for ${token.name}:`, err.message); }
  }
}

fetchAllSupply();
setInterval(fetchAllSupply, 10 * 60 * 1000); // Changed from 5 minutes to 10 minutes

// ── Poll burns for one token at one burn address ──────────────────────────────
async function pollBurnsAtAddress(token, burnAddr) {
  const key    = `${token.name}:${burnAddr}`;
  const params = {
    module:          "account",
    action:          "tokentx",
    address:         burnAddr,
    contractaddress: token.address,
    sort:            "desc",
    page:            "1",
    offset:          "50",
  };
  if (lastSeenBlock[key] > 0) {
    params.startblock = String(lastSeenBlock[key] + 1);
  }

  const txs      = await apiFetch(params);
  let   maxBlock = lastSeenBlock[key];

  for (const tx of txs) {
    const blockNum = Number(tx.blockNumber);
    if (blockNum > maxBlock) maxBlock = blockNum;
    if (seen.has(tx.hash)) continue;
    seen.add(tx.hash);

    if (tx.to?.toLowerCase() !== burnAddr.toLowerCase()) continue;

    const decimals = tx.tokenDecimal ? Number(tx.tokenDecimal) : 18;
    const amount   = normalizeAmount(tx.value, decimals);
    const strength = mapToStrength(amount);
    const timestamp = Number(tx.timeStamp) * 1000;
    
    // Validate timestamp
    if (!timestamp || !isFinite(timestamp)) {
      console.warn(`⚠️  Invalid timestamp for tx ${tx.hash}`);
      continue;
    }

    console.log(`🔥 Burn: ${token.name} — ${amount.toFixed(4)} (tx ${tx.hash.slice(0,10)}…)`);

    // Store event for 30-day tracking using safe helper
    addBurnEvent({ token: token.name, amount, hash: tx.hash, timestamp });

    io.emit("burn", {
      type:      "burn",
      token:     token.name,
      strength,
      amount,
      hash:      tx.hash,
      timestamp,
    });
  }

  if (maxBlock > lastSeenBlock[key]) lastSeenBlock[key] = maxBlock;
}

async function pollBurns(token) {
  for (const burnAddr of token.burnAddrs) {
    await pollBurnsAtAddress(token, burnAddr);
  }
}

// ── Poll LEMX staking ─────────────────────────────────────────────────────────
async function pollStaking() {
  const params = {
    module:  "account",
    action:  "txlist",
    address: LEMX_STAKING_CONTRACT,
    sort:    "desc",
    page:    "1",
    offset:  "50",
  };
  if (lastSeenStakingBlock > 0) {
    params.startblock = String(lastSeenStakingBlock + 1);
  }

  const txs      = await apiFetch(params);
  let   maxBlock = lastSeenStakingBlock;

  for (const tx of txs) {
    const blockNum = Number(tx.blockNumber);
    if (blockNum > maxBlock) maxBlock = blockNum;
    if (seen.has(tx.hash)) continue;
    if (tx.to?.toLowerCase() !== LEMX_STAKING_CONTRACT.toLowerCase()) continue;
    if (tx.isError === "1") continue;
    const input = tx.input?.toLowerCase() ?? "";
    if (!input.startsWith("0x9fa6dd35")) continue;

    seen.add(tx.hash);

    const amount   = normalizeAmount(tx.value || "0", 18);
    const strength = mapToStrength(amount || 1);
    const timestamp = Number(tx.timeStamp) * 1000;
    
    // Validate timestamp
    if (!timestamp || !isFinite(timestamp)) {
      console.warn(`⚠️  Invalid timestamp for stake tx ${tx.hash}`);
      continue;
    }
    
    console.log(`🏦 Stake: LEMX — ${amount.toFixed(4)} (tx ${tx.hash.slice(0,10)}…)`);

    // Store event for 30-day tracking using safe helper
    addStakeEvent({ amount, hash: tx.hash, timestamp });

    io.emit("stake", {
      type:      "stake",
      token:     "LEMX",
      strength,
      amount,
      hash:      tx.hash,
      timestamp,
    });
  }

  if (maxBlock > lastSeenStakingBlock) lastSeenStakingBlock = maxBlock;
}

async function poll() {
  for (const token of TOKENS) {
    try { await pollBurns(token); }
    catch (err) { console.error(`Error polling ${token.name}:`, err.message); }
  }
  try { await pollStaking(); }
  catch (err) { console.error("Error polling staking:", err.message); }
}

poll();
setInterval(poll, 10000); // Changed from 5000ms (5s) to 10000ms (10s)

// Track active connections for monitoring
let activeConnections = 0;
const MAX_CONNECTIONS = 100; // Prevent DoS

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', connections: activeConnections });
});

io.on("connection", socket => {
  activeConnections++;
  
  if (activeConnections > MAX_CONNECTIONS) {
    console.warn(`⚠️  Connection limit reached (${activeConnections}/${MAX_CONNECTIONS})`);
    socket.disconnect(true);
    activeConnections--;
    return;
  }
  
  console.log(`Client connected: ${socket.id} (${activeConnections} active)`);
  
  // Send supply percentages (lifetime burns)
  for (const [name, data] of Object.entries(supplyCache)) {
    socket.emit("supply", { token: name, pct: data.pct });
  }
  
  // Send 30-day stats
  try {
    const { burnStats, lemxStats } = get30DayStats();
    socket.emit("stats30d", { burnStats, lemxStats });
  } catch (err) {
    console.error(`Error sending stats to ${socket.id}:`, err.message);
  }
  
  socket.on("disconnect", () => {
    activeConnections--;
    console.log(`Client disconnected: ${socket.id} (${activeConnections} active)`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍋 Lemon Burn Monitor running on http://localhost:${PORT}`);
  console.log(`🌐 Server listening on all interfaces (0.0.0.0:${PORT})`);
});
