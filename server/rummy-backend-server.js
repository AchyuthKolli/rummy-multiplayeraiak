/*
Rummy Backend Server (Node + Express + Socket.io)
Place this file as: server/rummy-backend-server.js

Instructions:
1) Create a new folder server/
2) Save this file as server/rummy-backend-server.js
3) Run:
   cd server
   npm init -y
   npm install express socket.io cors uuid
   node rummy-backend-server.js

This single-file server implements:
 - HTTP API endpoints matching the frontend apiclient calls
 - Socket.io real-time events for updates
 - In-memory game engine with multi-deck handling
 - Discard/stock logic (fixed discard bug behavior)
 - Simple declare/score resolution (pluggable validation)
 - Round history + scoreboard
 - Spectate, drop, mute endpoints (basic)

NOTE: This is a single-file, zero-dependency engine (except listed packages). For production, split into modules, add persistent DB (Redis/Mongo), clustering, and authorization.
*/

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// -------------------- Utility helpers --------------------
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Build one standard 52-card deck + 2 jokers (JOKER_RED, JOKER_BLACK)
function buildSingleDeck() {
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const suits = ['H','D','S','C'];
  const deck = [];
  for (const r of ranks) for (const s of suits) deck.push({ rank: r, suit: s, code: `${r}${s}` });
  deck.push({ rank: 'JOKER', suit: null, code: 'JOKER' });
  deck.push({ rank: 'JOKER', suit: null, code: 'JOKER' });
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function pickDeckCountForPlayers(nPlayers) {
  if (nPlayers <= 2) return 1;
  if (nPlayers <= 4) return 2;
  return 3; // 5-6
}

function nowISO() { return new Date().toISOString(); }

// -------------------- In-memory store --------------------
const TABLES = new Map(); // tableId -> Table instance

// -------------------- Game Engine --------------------
class Table {
  constructor({ hostUserId, hostDisplayName, tableId = null, gameMode = 'default', targetPoints = 0 }) {
    this.table_id = tableId || uuidv4();
    this.host_user_id = hostUserId;
    this.host_display_name = hostDisplayName || 'Host';
    this.players = []; // { user_id, display_name, seat, connected }
    this.status = 'waiting'; // waiting | playing | round_complete | finished
    this.code = this.table_id.slice(0,6).toUpperCase();

    this.game_mode = gameMode; // 'default' or 'no_joker'
    this.target_points = targetPoints;

    this.round_number = 0;
    this.history = []; // rounds

    this.engine = null; // RoundEngine after start

    // spectator requests
    this.spectate_requests = [];
  }

  addPlayer(user) {
    if (this.players.find(p => p.user_id === user.user_id)) return false;
    const seat = this.players.length + 1;
    this.players.push({ user_id: user.user_id, display_name: user.display_name || user.user_id, seat, connected: true });
    return true;
  }

  removePlayer(userId) {
    const idx = this.players.findIndex(p => p.user_id === userId);
    if (idx === -1) return false;
    this.players.splice(idx, 1);
    // reassign seats
    this.players.forEach((p,i)=>p.seat=i+1);
    return true;
  }

  findPlayer(userId) {
    return this.players.find(p=>p.user_id===userId);
  }

  startRound() {
    if (this.status === 'playing') return { ok: false, message: 'Already playing' };
    if (this.players.length < 2) return { ok:false, message: 'Need at least 2 players' };

    this.round_number += 1;
    this.engine = new RoundEngine({ table: this });
    this.engine.deal();
    this.status = 'playing';
    // notify
    broadcastTableUpdate(this.table_id);
    return { ok:true, number: this.round_number };
  }

  startNextRound() {
    // finalize and start next
    if (this.status !== 'round_complete' && this.status !== 'finished') return { ok:false, message:'Round not complete' };
    // keep history
    this.engine = new RoundEngine({ table: this });
    this.round_number += 1;
    this.engine.deal();
    this.status = 'playing';
    broadcastTableUpdate(this.table_id);
    return { ok:true, number: this.round_number };
  }
}

class RoundEngine {
  constructor({ table }) {
    this.table = table;
    this.table_id = table.table_id;
    this.players = table.players.map(p => ({ user_id: p.user_id, display_name: p.display_name, hand: [], dropped: false, spectator: false }));

    this.nPlayers = this.players.length;
    this.deckCount = pickDeckCountForPlayers(this.nPlayers);
    this.stock = [];
    this.discard = [];
    this.discard_top = null; // code string
    this.active_index = 0; // index of current player in turn order
    this.turn_started_at = nowISO();

    this.wild_joker_rank = null;
    this.wild_joker_revealed = false;

    this.round_history = [];
    this.scores = {}; // accumulate per round once declared

    // performance: pre-generate deck
    this._buildAndShuffleDeck();
  }

  _buildAndShuffleDeck() {
    const base = buildSingleDeck();
    let full = [];
    for (let i=0;i<this.deckCount;i++) {
      full = full.concat(JSON.parse(JSON.stringify(base)));
    }
    shuffle(full);
    this.stock = full;
  }

  deal() {
    // standard Rummy: give 13 to each player, extra card to first to start? We'll give 13 to each and set discard top
    const toDeal = 13;
    for (let i=0;i<toDeal;i++) {
      for (let p of this.players) {
        const card = this.stock.pop();
        p.hand.push(card);
      }
    }
    // one extra card to initial player to make 14 for first? Many rules vary; our front-end expects players to draw on turn so we keep 13 and stock/discard present

    // Put one card to discard top to start
    const firstDiscard = this.stock.pop();
    if (firstDiscard) {
      this.discard.push(firstDiscard);
      this.discard_top = firstDiscard.code || encodeCard(firstDiscard);
    }

    // set active_index (host picks first in round1, rotate each round)
    const roundIdx = this.table.round_number - 1; // 0-based
    // rotate starting player: host, then next each round
    const hostId = this.table.host_user_id;
    const hostSeatIndex = this.players.findIndex(p=>p.user_id===hostId);
    let startIndex = 0;
    if (hostSeatIndex >= 0) startIndex = (hostSeatIndex + roundIdx) % this.players.length;
    this.active_index = startIndex;

    // prepare per-player flags
    this.players.forEach(p => p.hasDrawn = false);

    broadcastRoundUpdate(this.table_id);
  }

  drawStock(playerId) {
    const p = this.players.find(x=>x.user_id===playerId);
    if (!p) return { ok:false, message:'Player not in round' };
    if (this.players[this.active_index].user_id !== playerId) return { ok:false, message:'Not your turn' };
    if (p.hasDrawn) return { ok:false, message:'Already drawn' };
    if (this.stock.length === 0) return { ok:false, message:'Stock empty' };
    const card = this.stock.pop();
    p.hand.push(card);
    p.hasDrawn = true;
    // action should be fast; return updated round
    broadcastRoundUpdate(this.table_id);
    return { ok:true, hand: p.hand, stock_count: this.stock.length, discard_top: this.discard_top };
  }

  drawDiscard(playerId) {
    const p = this.players.find(x=>x.user_id===playerId);
    if (!p) return { ok:false, message:'Player not in round' };
    if (this.players[this.active_index].user_id !== playerId) return { ok:false, message:'Not your turn' };
    if (p.hasDrawn) return { ok:false, message:'Already drawn' };
    if (!this.discard_top) return { ok:false, message:'Discard empty' };

    // Take current discard_top: top of discard stack
    const card = this.discard.pop();
    this.discard_top = this.discard.length ? (this.discard[this.discard.length-1].code || encodeCard(this.discard[this.discard.length-1])) : null;
    p.hand.push(card);
    p.hasDrawn = true;
    broadcastRoundUpdate(this.table_id);
    return { ok:true, hand: p.hand, stock_count: this.stock.length, discard_top: this.discard_top };
  }

  discardCard(playerId, cardObj) {
    // cardObj is { rank, suit, joker }
    const p = this.players.find(x=>x.user_id===playerId);
    if (!p) return { ok:false, message:'Player not in round' };
    if (this.players[this.active_index].user_id !== playerId) return { ok:false, message:'Not your turn' };
    if (!p.hasDrawn) return { ok:false, message:'Must draw before discard' };

    // find the card in player's hand (match rank+suit)
    const idx = p.hand.findIndex(c => c.rank === cardObj.rank && (c.suit || null) === (cardObj.suit || null) );
    if (idx === -1) {
      return { ok:false, message:'Card not in hand' };
    }

    const [card] = p.hand.splice(idx,1);
    this.discard.push(card);
    this.discard_top = card.code || encodeCard(card);

    // move turn to next player
    this._advanceTurn();

    broadcastRoundUpdate(this.table_id);
    return { ok:true, hand: p.hand, discard_top: this.discard_top };
  }

  _advanceTurn() {
    this.players.forEach(p => p.hasDrawn = false); // reset draw flags for new active player
    this.active_index = (this.active_index + 1) % this.players.length;
  }

  declare(playerId, groups) {
    // groups: [[{rank,suit,joker},...], ...]
    // Simple checks: total cards in groups must equal 13 and they must be subset of player's hand
    const p = this.players.find(x=>x.user_id===playerId);
    if (!p) return { ok:false, message:'Player not in round' };
    // ensure player had drawn (14) prior to declare (front-end expects 14)
    // We'll accept declare if player had last drawn earlier in the turn; for now skip that check

    const flattened = [].concat(...groups);
    if (flattened.length !== 13) return { ok:false, message:'You must place exactly 13 cards in groups' };

    // Check that each declared card exists in player's hand + cards placed in melds or leftover are taken from current hand
    const handCopy = p.hand.slice();
    for (const card of flattened) {
      const idx = handCopy.findIndex(c => c.rank === card.rank && (c.suit || null) === (card.suit || null));
      if (idx === -1) {
        return { ok:false, message:`Declared card ${card.rank}${card.suit||''} not in your hand` };
      }
      handCopy.splice(idx,1);
    }

    // Run a placeholder validation function: more advanced rules should be plugged here
    const valid = validateMeldGroups(groups, this.game_mode || this.table.game_mode);

    // compute scores for round for all players
    const result = this._computeScoresAfterDeclare(playerId, groups, valid);

    // save to table history
    this.table.history.push({ round_number: this.table.round_number, winner: valid ? playerId : null, valid, result, time: nowISO() });

    // mark round complete
    this.table.status = 'round_complete';

    broadcastRoundUpdate(this.table_id);
    broadcastTableUpdate(this.table_id);

    return { ok:true, status: valid ? 'valid' : 'invalid', round_number: this.table.round_number, result };
  }

  _computeScoresAfterDeclare(declarerId, groups, valid) {
    // If invalid -> declarer gets 80 pts, others 0
    const scores = {};
    if (!valid) {
      for (const pl of this.players) scores[pl.user_id] = (pl.user_id === declarerId) ? 80 : 0;
      return scores;
    }

    // valid: declarer 0, others deadwood based on leftover cards in their hands.
    for (const pl of this.players) {
      if (pl.user_id === declarerId) { scores[pl.user_id] = 0; continue; }
      // compute deadwood points: sum of non-joker card values (Aces treated as 1 or 11? We'll use host setting later)
      let points = 0;
      for (const c of pl.hand) {
        if (c.rank === 'JOKER') { points += 15; continue; }
        const rank = c.rank;
        if (['J','Q','K'].includes(rank)) points += 10;
        else if (rank === 'A') points += 1; // host-specific rule not implemented here, can be toggled
        else points += Number(rank);
      }
      scores[pl.user_id] = points;
    }
    return scores;
  }

  getRoundMe(userId) {
    const p = this.players.find(x=>x.user_id===userId);
    if (!p) return null;
    return {
      hand: p.hand,
      stock_count: this.stock.length,
      discard_top: this.discard_top,
      wild_joker_revealed: this.wild_joker_revealed,
      wild_joker_rank: this.wild_joker_rank
    };
  }
}

// -------------------- Basic validation placeholder --------------------
function validateMeldGroups(groups, gameMode) {
  // This is intentionally permissive; replace with full Rummy validation as needed.
  // Current checks:
  // - Each group length >= 3 except leftover (we don't know which group is leftover here) -> We'll accept.
  // - No duplicate card usage (handled by caller)
  // For now, return true always. Frontend should supply properly arranged groups.
  return true;
}

function encodeCard(card) {
  if (!card) return '';
  if (card.rank === 'JOKER') return 'JOKER';
  return `${card.rank}${card.suit||''}`;
}

// -------------------- Broadcast helpers --------------------
function broadcastTableUpdate(tableId) {
  const t = TABLES.get(tableId);
  if (!t) return;
  io.to(tableId).emit('table_update', {
    table_id: t.table_id,
    host_user_id: t.host_user_id,
    players: t.players,
    status: t.status,
    code: t.code,
    round_number: t.round_number,
    game_mode: t.game_mode
  });
}

function broadcastRoundUpdate(tableId) {
  const t = TABLES.get(tableId);
  if (!t || !t.engine) return;
  const e = t.engine;
  io.to(tableId).emit('round_update', {
    table_id: t.table_id,
    stock_count: e.stock.length,
    discard_top: e.discard_top,
    players: e.players.map(p => ({ user_id: p.user_id, hand_count: p.hand.length, hasDrawn: p.hasDrawn })),
    active_user_id: e.players[e.active_index]?.user_id
  });
}

// -------------------- HTTP API (matching frontend apiclient) --------------------

// Create table (not in original list but useful)
app.post('/api/create_table', (req, res) => {
  const { host_user_id, host_display_name, game_mode, target_points } = req.body;
  const table = new Table({ hostUserId: host_user_id, hostDisplayName: host_display_name, gameMode: game_mode || 'default', targetPoints: target_points || 0 });
  TABLES.set(table.table_id, table);
  return res.json({ ok:true, table_id: table.table_id, code: table.code });
});

app.get('/api/get_table_info', (req, res) => {
  const table_id = req.query.table_id || req.body?.table_id;
  const t = TABLES.get(table_id);
  if (!t) return res.status(404).json({ error: 'Table not found' });
  return res.json({ table_id: t.table_id, host_user_id: t.host_user_id, players: t.players, status: t.status, code: t.code, current_round_number: t.round_number, game_mode: t.game_mode });
});

app.get('/api/get_round_me', (req, res) => {
  const table_id = req.query.table_id || req.body?.table_id;
  const user_id = req.query.user_id || req.body?.user_id;
  const t = TABLES.get(table_id);
  if (!t || !t.engine) return res.status(404).json({ error: 'Round not found' });
  const roundMe = t.engine.getRoundMe(user_id);
  if (!roundMe) return res.status(404).json({ error: 'Player not in round' });
  return res.json(roundMe);
});

app.post('/api/start_game', (req, res) => {
  const { table_id } = req.body;
  const t = TABLES.get(table_id);
  if (!t) return res.status(404).json({ error: 'Table not found' });
  const out = t.startRound();
  if (!out.ok) return res.status(400).json({ error: out.message });
  return res.json({ number: out.number });
});

app.post('/api/start_next_round', (req, res) => {
  const { table_id } = req.body;
  const t = TABLES.get(table_id);
  if (!t) return res.status(404).json({ error: 'Table not found' });
  const out = t.startNextRound();
  if (!out.ok) return res.status(400).json({ error: out.message });
  return res.json({ number: out.number });
});

app.post('/api/draw_stock', (req, res) => {
  const { table_id, user_id } = req.body;
  const t = TABLES.get(table_id);
  if (!t || !t.engine) return res.status(404).json({ error: 'Round not found' });
  const out = t.engine.drawStock(user_id);
  if (!out.ok) return res.status(400).json({ error: out.message });
  return res.json(out);
});

app.post('/api/draw_discard', (req, res) => {
  const { table_id, user_id } = req.body;
  const t = TABLES.get(table_id);
  if (!t || !t.engine) return res.status(404).json({ error: 'Round not found' });
  const out = t.engine.drawDiscard(user_id);
  if (!out.ok) return res.status(400).json({ error: out.message });
  return res.json(out);
});

app.post('/api/discard_card', (req, res) => {
  const { table_id, user_id, card } = req.body; // card: {rank, suit}
  const t = TABLES.get(table_id);
  if (!t || !t.engine) return res.status(404).json({ error: 'Round not found' });
  const out = t.engine.discardCard(user_id, card);
  if (!out.ok) return res.status(400).json({ error: out.message });
  return res.json(out);
});

app.post('/api/declare', (req, res) => {
  const { table_id, user_id, groups } = req.body; // groups: array of arrays
  const t = TABLES.get(table_id);
  if (!t || !t.engine) return res.status(404).json({ error: 'Round not found' });
  const out = t.engine.declare(user_id, groups);
  if (!out.ok) return res.status(400).json({ error: out.message });
  return res.json(out);
});

app.post('/api/drop_game', (req, res) => {
  const { table_id, user_id } = req.body;
  const t = TABLES.get(table_id);
  if (!t || !t.engine) return res.status(404).json({ error: 'Round not found' });
  // remove player from engine
  const idx = t.engine.players.findIndex(p=>p.user_id===user_id);
  if (idx !== -1) {
    t.engine.players.splice(idx,1);
    // assign penalty
    t.history.push({ action:'drop', user_id, penalty:20, time: nowISO() });
    broadcastRoundUpdate(table_id);
    return res.json({ ok:true, message:'Dropped' });
  }
  return res.status(400).json({ error:'Player not in round' });
});

app.post('/api/request_spectate', (req,res) => {
  const { table_id, player_id } = req.body;
  const t = TABLES.get(table_id);
  if (!t) return res.status(404).json({ error:'Table not found' });
  t.spectate_requests.push(player_id);
  broadcastTableUpdate(table_id);
  return res.json({ ok:true });
});

app.post('/api/grant_spectate', (req,res) => {
  const { table_id, spectator_id, granted } = req.body;
  const t = TABLES.get(table_id);
  if (!t) return res.status(404).json({ error:'Table not found' });
  if (granted) {
    // move player to spectator state (if exists in players, mark dropped)
    const p = t.players.find(p=>p.user_id===spectator_id);
    if (p) p.spectator = true;
  }
  t.spectate_requests = t.spectate_requests.filter(id=>id!==spectator_id);
  broadcastTableUpdate(table_id);
  return res.json({ ok:true });
});

app.get('/api/get_round_history', (req,res) => {
  const table_id = req.query.table_id;
  const t = TABLES.get(table_id);
  if (!t) return res.status(404).json({ error:'Table not found' });
  return res.json({ rounds: t.history });
});

app.get('/api/get_revealed_hands', (req,res) => {
  const table_id = req.query.table_id;
  const t = TABLES.get(table_id);
  if (!t || !t.engine) return res.status(404).json({ error: 'Round not found' });
  // Build revealed hands summary
  const reveal = {
    player_names: {},
    organized_melds: {},
    scores: {},
    can_start_next: true
  };
  for (const p of t.players) {
    reveal.player_names[p.user_id] = p.display_name;
  }
  // if last round result in history
  const last = t.history[t.history.length-1] || null;
  if (last && last.result) {
    // last.result may be scores map
    reveal.scores = last.result;
  }
  // quick placeholder: reveal hands as strings
  if (t.engine) {
    for (const p of t.engine.players) {
      reveal.organized_melds[p.user_id] = [{ cards: p.hand.map(c=>({ code: encodeCard(c), name: encodeCard(c) })), type: 'unknown' }];
      reveal.scores[p.user_id] = reveal.scores[p.user_id] || 0;
    }
  }
  return res.json(reveal);
});

app.post('/api/mute_player', (req,res) => {
  // placeholder
  return res.json({ ok:true });
});

app.post('/api/lock_sequence', (req,res) => {
  // placeholder for lock sequence: reveal wild joker maybe
  const { table_id, meld } = req.body;
  const t = TABLES.get(table_id);
  if (!t || !t.engine) return res.status(404).json({ error:'Round not found' });
  // In real game, server will compute wild joker from meld; we'll randomly reveal
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const chosen = ranks[Math.floor(Math.random()*ranks.length)];
  t.engine.wild_joker_revealed = true;
  t.engine.wild_joker_rank = chosen;
  broadcastRoundUpdate(table_id);
  return res.json({ success:true, message:'Sequence locked', wild_joker_revealed:true, wild_joker_rank:chosen });
});

// -------------------- Socket.io events --------------------
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join_table', ({ table_id, user }) => {
    // user: { user_id, display_name }
    console.log('join_table', table_id, user?.user_id);
    socket.join(table_id);
    let t = TABLES.get(table_id);
    if (!t) return socket.emit('error', { message: 'Table not found' });
    t.addPlayer({ user_id: user.user_id, display_name: user.display_name });
    broadcastTableUpdate(table_id);
    broadcastRoundUpdate(table_id);
  });

  socket.on('leave_table', ({ table_id, user_id }) => {
    socket.leave(table_id);
    const t = TABLES.get(table_id);
    if (!t) return;
    t.removePlayer(user_id);
    broadcastTableUpdate(table_id);
  });

  socket.on('sync_action', (payload) => {
    // generic action routing for real-time
    // payload: { table_id, action, user_id, data }
    const { table_id, action, user_id, data } = payload;
    const t = TABLES.get(table_id);
    if (!t) return;
    if (!t.engine && action !== 'start_game') return;

    try {
      switch(action) {
        case 'draw_stock':
          t.engine.drawStock(user_id);
          break;
        case 'draw_discard':
          t.engine.drawDiscard(user_id);
          break;
        case 'discard_card':
          t.engine.discardCard(user_id, data.card);
          break;
        case 'declare':
          t.engine.declare(user_id, data.groups);
          break;
      }
    } catch(e) {
      console.error('sync_action error', e);
    }
    broadcastRoundUpdate(table_id);
    broadcastTableUpdate(table_id);
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
  });
});

// -------------------- Simple bootstrap data for local testing --------------------
(function seedExample() {
  const t = new Table({ hostUserId: 'host1', hostDisplayName: 'Achyuth', gameMode: 'default', targetPoints: 0 });
  TABLES.set(t.table_id, t);
})();

server.listen(PORT, () => {
  console.log(`Rummy backend listening on port ${PORT}`);
  console.log('Sample table list:', Array.from(TABLES.keys()));
});

/*
Performance notes & next steps (production):
- Use Redis or MongoDB to persist tables and rounds.
- Use clustering / PM2 and sticky sessions for Socket.io scaling.
- Add authentication and token checks on APIs.
- Implement full Rummy meld validation engine (pure/impure/sets) and wildcard rules.
- Improve scoring to honor host-selected ace value and special rules.
- Send compact payloads; use binary serialization for very low latency if needed.
*/
