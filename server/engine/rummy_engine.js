// server/engine/rummy_engine.js
// Option A — full RummyEngine for your multi-game platform
// Uses server/APIs/rummy_models.js and server/APIs/scoring.js
// Assumes card objects: { rank: "A"|"2"|...|"K"|"JOKER", suit: "H"|"D"|"S"|"C"|null, joker: boolean }

const { buildDeck, shuffleDeck } = require("../APIs/rummy_models");
const scoring = require("../APIs/scoring");
const { v4: uuidv4 } = require("uuid");

/* ---------------------------
   Helpers
----------------------------*/
function pickDeckCount(playerCount) {
  if (playerCount <= 2) return 1;
  if (playerCount <= 4) return 2;
  return 3;
}

function encodeCard(card) {
  if (!card) return "";
  if (card.joker || card.rank === "JOKER") return "JOKER";
  return `${card.rank}${card.suit || ""}`;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* Default deck config */
function defaultDeckConfig(nPlayers) {
  return {
    decks: pickDeckCount(nPlayers),
    include_printed_jokers: true,
  };
}

/* ---------------------------
   RummyEngine
----------------------------*/
class RummyEngine {
  /**
   * tableMeta: { table_id, host_user_id, wild_mode: 'no_joker'|'open'|'closed', ace_value, disqualify_score, max_players }
   * players: [{ user_id, display_name, seat? }]
   */
  constructor(tableMeta = {}, players = []) {
    this.table = {
      table_id: tableMeta.table_id || uuidv4(),
      host_user_id: tableMeta.host_user_id || null,
      wild_mode: tableMeta.wild_mode || "open", // 'no_joker' | 'open' | 'closed'
      ace_value: tableMeta.ace_value || 10,
      disqualify_score: tableMeta.disqualify_score || 200,
      max_players: tableMeta.max_players || 4,
      status: "waiting",
    };

    this.players = (players || []).map((p, idx) => ({
      user_id: p.user_id,
      display_name: p.display_name || `Player-${String(p.user_id).slice(-6)}`,
      seat: p.seat || idx + 1,
      hand: [],
      hasDrawn: false,
      dropped: false,
      drop_points: 0,
    }));

    this.round_number = 0;
    this.stock = [];
    this.discard = [];
    this.discard_top = null;
    this.active_index = 0;

    this.wild_joker_rank = null; // like '5' or null
    this.wild_joker_revealed = false; // controlled by wild_mode and lockSequence
    this.players_with_first_sequence = []; // user_ids who locked pure seq
    this.round_over = false;
    this.history = []; // round results
  }

  /* ---------------------------
     Serialization / utilities
  ----------------------------*/
  serializeCard(card) {
    return encodeCard(card);
  }

  getPlayerIndex(userId) {
    return this.players.findIndex((p) => p.user_id === userId);
  }

  getActiveUserId() {
    return (this.players[this.active_index] || {}).user_id || null;
  }

  snapshotTable() {
    return {
      table_id: this.table.table_id,
      status: this.table.status,
      host_user_id: this.table.host_user_id,
      round_number: this.round_number,
      players: this.players.map((p) => ({
        user_id: p.user_id,
        display_name: p.display_name,
        seat: p.seat,
        hand_count: p.hand.length,
        dropped: !!p.dropped,
      })),
      game_mode: this.table.wild_mode,
    };
  }

  /* ---------------------------
     PART 1 — START ROUND (deal)
  ----------------------------*/
  startRound(seed = null) {
    if (this.table.status === "playing") return { ok: false, message: "Round already playing" };
    if (this.players.filter((p) => !p.dropped).length < 2) return { ok: false, message: "Need 2+ players" };

    this.round_number += 1;
    this.round_over = false;
    this.players.forEach((p) => {
      p.hand = [];
      p.hasDrawn = false;
      p.dropped = false;
      p.drop_points = 0;
    });

    // wild joker selection based on mode
    if (this.table.wild_mode === "no_joker") {
      this.wild_joker_rank = null;
      this.wild_joker_revealed = false;
    } else {
      const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
      const idx = seed ? Math.abs(seed) % ranks.length : Math.floor(Math.random() * ranks.length);
      this.wild_joker_rank = ranks[idx];
      this.wild_joker_revealed = (this.table.wild_mode === "open");
    }
    this.players_with_first_sequence = [];

    // build deck(s)
    const cfg = defaultDeckConfig(this.players.length);
    let fullDeck = [];
    for (let i = 0; i < cfg.decks; i++) {
      fullDeck = fullDeck.concat(buildDeck({ include_printed_jokers: cfg.include_printed_jokers }));
    }

    // shuffle
    fullDeck = shuffleDeck(fullDeck, seed);

    // deal 13 each round-robin
    for (let i = 0; i < 13; i++) {
      for (const p of this.players) {
        const card = fullDeck.pop();
        p.hand.push(card);
      }
    }

    // reveal top discard (skip printed jokers on top until non-joker for UX)
    this.discard = [];
    this.discard_top = null;
    while (fullDeck.length > 0) {
      const top = fullDeck.pop();
      this.discard.push(top);
      this.discard_top = this.serializeCard(top);
      // break when we find a non-printed-joker (printed jokers: card.joker === true && rank==='JOKER')
      if (!(top.joker === true && top.rank === "JOKER")) break;
    }

    this.stock = fullDeck.slice();

    // starting player: host rotated by round_number-1
    let startIndex = 0;
    if (this.table.host_user_id) {
      const hostIdx = this.getPlayerIndex(this.table.host_user_id);
      if (hostIdx >= 0) startIndex = (hostIdx + (this.round_number - 1)) % this.players.length;
    }
    this.active_index = startIndex;
    this.table.status = "playing";

    return {
      ok: true,
      round_number: this.round_number,
      active_user_id: this.getActiveUserId(),
      stock_count: this.stock.length,
      discard_top: this.discard_top,
      wild_joker_rank: this.wild_joker_rank,
      wild_joker_revealed: this.wild_joker_revealed,
    };
  }

  /* ---------------------------
     PART 2 — PLAYER VIEW
  ----------------------------*/
  getRoundMe(userId) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Not part of table" };
    const p = this.players[idx];

    const handView = p.hand.map((c) => ({
      rank: c.rank,
      suit: c.suit || null,
      joker: !!c.joker,
      code: (c.joker || c.rank === "JOKER") ? "JOKER" : `${c.rank}${c.suit || ""}`,
    }));

    return {
      ok: true,
      table_id: this.table.table_id,
      round_number: this.round_number,
      hand: handView,
      stock_count: this.stock.length,
      discard_top: this.discard_top,
      wild_joker_revealed: this.wild_joker_revealed,
      wild_joker_rank: this.wild_joker_rank,
      active_user_id: this.getActiveUserId(),
      finished_at: this.round_over ? new Date().toISOString() : null,
    };
  }

  /* ---------------------------
     PART 3 — DRAW / DISCARD / TURN
  ----------------------------*/
  drawStock(userId) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    if (this.getActiveUserId() !== userId) return { ok: false, message: "Not your turn" };
    const p = this.players[idx];
    if (p.hasDrawn) return { ok: false, message: "Already drawn" };
    if (this.stock.length === 0) return { ok: false, message: "Stock empty" };

    const card = this.stock.pop();
    p.hand.push(card);
    p.hasDrawn = true;

    return {
      ok: true,
      hand: deepClone(p.hand),
      stock_count: this.stock.length,
      discard_top: this.discard_top,
    };
  }

  drawDiscard(userId) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    if (this.getActiveUserId() !== userId) return { ok: false, message: "Not your turn" };
    const p = this.players[idx];
    if (p.hasDrawn) return { ok: false, message: "Already drawn" };
    if (this.discard.length === 0) return { ok: false, message: "Discard empty" };

    const card = this.discard.pop();
    p.hand.push(card);
    p.hasDrawn = true;
    this.discard_top = this.discard.length ? this.serializeCard(this.discard[this.discard.length - 1]) : null;

    return {
      ok: true,
      hand: deepClone(p.hand),
      stock_count: this.stock.length,
      discard_top: this.discard_top,
    };
  }

  discardCard(userId, cardObj) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    if (this.getActiveUserId() !== userId) return { ok: false, message: "Not your turn" };
    const p = this.players[idx];
    if (!p.hasDrawn) return { ok: false, message: "Must draw before discarding" };

    const removeIdx = p.hand.findIndex((c) => {
      const cs = c.suit || null;
      const rs = cardObj.suit || null;
      return c.rank === cardObj.rank && cs === rs && (!!c.joker) === (!!cardObj.joker);
    });
    if (removeIdx === -1) return { ok: false, message: "Card not in hand" };

    const [removed] = p.hand.splice(removeIdx, 1);
    this.discard.push(removed);
    this.discard_top = this.serializeCard(removed);

    // advance turn
    this._advanceTurn();

    return {
      ok: true,
      hand: deepClone(p.hand),
      discard_top: this.discard_top,
      next_active_user_id: this.getActiveUserId(),
    };
  }

  _advanceTurn() {
    if (this.players.length === 0) {
      this.active_index = 0;
      return;
    }
    let next = (this.active_index + 1) % this.players.length;
    let attempts = 0;
    while (this.players[next].dropped && attempts < this.players.length) {
      next = (next + 1) % this.players.length;
      attempts++;
    }
    this.active_index = next;
    // Reset hasDrawn flags at start of new player's turn
    this.players.forEach((p) => (p.hasDrawn = false));
  }

  /* ---------------------------
     PART 4 — DROP LOGIC (penalties per your Q2)
     Early drop (before first draw) => 20
     Middle drop => 40
     Wrong declare penalty handled in declare()
  ----------------------------*/
  dropPlayer(userId) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    const p = this.players[idx];
    if (p.dropped) return { ok: false, message: "Player already dropped" };

    const penalty = (!p.hasDrawn) ? 20 : 40;
    p.dropped = true;
    p.drop_points = penalty;

    // If only one active remains, auto finish
    const activePlayers = this.players.filter((pl) => !pl.dropped);
    if (activePlayers.length === 1) {
      const winnerId = activePlayers[0].user_id;
      return this._autoFinishAfterDrops(winnerId);
    }

    // If the dropping player was active, advance
    if (this.getActiveUserId() === userId) this._advanceTurn();

    return { ok: true, penalty, message: `Dropped with penalty ${penalty}` };
  }

  _autoFinishAfterDrops(winnerId) {
    const scores = {};
    for (const p of this.players) {
      if (p.user_id === winnerId) scores[p.user_id] = 0;
      else if (p.dropped) scores[p.user_id] = p.drop_points || 0;
      else scores[p.user_id] = 40;
    }
    const rec = {
      round_number: this.round_number,
      winner: winnerId,
      valid: true,
      auto_finished: true,
      scores,
      time: new Date().toISOString(),
      wild_joker_rank: this.wild_joker_rank,
      wild_joker_revealed: this.wild_joker_revealed,
    };
    this.history.push(rec);
    this.round_over = true;
    this.table.status = "round_complete";
    return { ok: true, auto_finished: true, winner: winnerId, scores };
  }

  /* ---------------------------
     PART 5 — LOCK SEQUENCE (for closed wild mode)
     If a player locks a pure sequence, reveal the wild joker.
  ----------------------------*/
  lockSequence(userId, meld) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    if (!Array.isArray(meld) || meld.length < 3) return { ok: false, message: "Meld must be >= 3 cards" };

    // Use scoring.isPureSequence if present
    let isPure = false;
    if (typeof scoring.isPureSequence === "function") {
      try {
        isPure = scoring.isPureSequence(meld, this.wild_joker_rank, this.players_with_first_sequence.includes(userId));
      } catch (e) {
        isPure = false;
      }
    } else if (typeof scoring.validateHand === "function") {
      // treat a single-group validate as pure if the validator accepts it (defensive)
      try {
        const res = scoring.validateHand([meld], [], this.wild_joker_rank, this.players_with_first_sequence.includes(userId));
        isPure = !!(res && res.valid);
      } catch (e) {
        isPure = false;
      }
    } else {
      // fallback, optimistic accept (not ideal)
      isPure = true;
    }

    if (!isPure) return { ok: false, message: "Not a pure sequence" };

    if (!this.players_with_first_sequence.includes(userId)) this.players_with_first_sequence.push(userId);

    // Reveal wild joker only for CLOSED mode — for OPEN it's already revealed at start.
    if (this.table.wild_mode === "closed") this.wild_joker_revealed = true;

    return { ok: true, message: "Pure sequence locked", wild_joker_rank: this.wild_joker_rank, wild_joker_revealed: this.wild_joker_revealed };
  }

  /* ---------------------------
     PART 6 — DECLARE (full validation + scoring)
     groups: array of arrays totaling 13 cards
  ----------------------------*/
  prepareDeclare(userId, groups) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    const p = this.players[idx];
    const flattened = Array.isArray(groups) ? [].concat(...groups) : [];
    if (flattened.length !== 13) return { ok: false, message: "Declared groups must contain exactly 13 cards" };

    // ensure declared cards are subset of player's hand
    const handCopy = p.hand.slice();
    for (const card of flattened) {
      const findIdx = handCopy.findIndex((c) => c.rank === card.rank && (c.suit || null) === (card.suit || null) && (!!c.joker) === (!!card.joker));
      if (findIdx === -1) return { ok: false, message: `Declared card ${card.rank}${card.suit||""} not in your hand` };
      handCopy.splice(findIdx, 1);
    }
    return { ok: true };
  }

  declare(userId, groups) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    const p = this.players[idx];
    if (p.hand.length !== 14) return { ok: false, message: `Must have 14 cards to declare. You have ${p.hand.length}` };

    const prep = this.prepareDeclare(userId, groups);
    if (!prep.ok) return { ok: false, message: prep.message };

    // Use scoring.validateHand
    let valid = false;
    let reason = "Validation not run";
    try {
      if (typeof scoring.validateHand === "function") {
        const out = scoring.validateHand(groups, [], this.wild_joker_rank, this.players_with_first_sequence.includes(userId));
        valid = !!(out && out.valid);
        reason = out && out.reason ? out.reason : (valid ? "Valid" : "Invalid");
      } else {
        valid = true;
        reason = "No server-side validator; accepted";
      }
    } catch (e) {
      valid = false;
      reason = `Validation error: ${String(e)}`;
    }

    const organized = {};
    const scores = {};

    if (valid) {
      // winner 0
      scores[userId] = 0;
      organized[userId] = { pure_sequences: groups, sequences: [], sets: [], deadwood: [] };

      for (const opp of this.players) {
        if (opp.user_id === userId) continue;
        if (opp.dropped) {
          scores[opp.user_id] = opp.drop_points || 0;
          organized[opp.user_id] = { pure_sequences: [], sequences: [], sets: [], deadwood: [] };
          continue;
        }
        // auto-organize opponent hand
        let melds = [];
        let leftover = opp.hand.slice();
        if (typeof scoring.autoOrganizeHand === "function") {
          try {
            const result = scoring.autoOrganizeHand(opp.hand.slice(), this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id));
            if (result && result.melds !== undefined && result.leftover !== undefined) {
              // some implementations return {melds,leftover}; others return [melds,leftover]
              if (Array.isArray(result)) {
                melds = result[0] || [];
                leftover = result[1] || leftover;
              } else {
                melds = result.melds || [];
                leftover = result.leftover || leftover;
              }
            }
          } catch (e) {
            melds = [];
            leftover = opp.hand.slice();
          }
        }

        const deadwood = (typeof scoring.calculateDeadwoodPoints === "function")
          ? scoring.calculateDeadwoodPoints(leftover, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id), this.table.ace_value)
          : leftover.reduce((s, c) => s + this._cardPoints(c, this.table.ace_value), 0);

        scores[opp.user_id] = Math.min(deadwood, 80);
        organized[opp.user_id] = {
          pure_sequences: (typeof scoring.isPureSequence === "function") ? melds.filter(m => scoring.isPureSequence(m, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id))) : [],
          sequences: (typeof scoring.isSequence === "function") ? melds.filter(m => scoring.isSequence(m, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id)) && !(scoring.isPureSequence && scoring.isPureSequence(m, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id)))) : [],
          sets: (typeof scoring.isSet === "function") ? melds.filter(m => scoring.isSet(m, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id))) : [],
          deadwood: leftover,
        };
      }
    } else {
      // Wrong declaration => declarer gets full deadwood capped at 80, others 0
      const declarerPts = Math.min(
        (typeof scoring.calculateDeadwoodPoints === "function")
          ? scoring.calculateDeadwoodPoints(p.hand.slice(), this.wild_joker_rank, this.players_with_first_sequence.includes(userId), this.table.ace_value)
          : p.hand.reduce((s, c) => s + this._cardPoints(c, this.table.ace_value), 0),
        80
      );

      for (const pl of this.players) {
        if (pl.user_id === userId) {
          scores[pl.user_id] = declarerPts;
          organized[pl.user_id] = { pure_sequences: [], sequences: [], sets: [], deadwood: pl.hand.slice() };
        } else {
          scores[pl.user_id] = 0;
          organized[pl.user_id] = { pure_sequences: [], sequences: [], sets: [], deadwood: [] };
        }
      }
    }

    // record & finish
    const record = {
      round_number: this.round_number,
      declared_by: userId,
      valid,
      reason,
      scores,
      organized_melds: organized,
      hands_snapshot: (() => {
        const map = {};
        this.players.forEach(pp => map[pp.user_id] = deepClone(pp.hand));
        return map;
      })(),
      wild_joker_rank: this.wild_joker_rank,
      wild_joker_revealed: this.wild_joker_revealed,
      time: new Date().toISOString(),
    };

    this.history.push(record);
    this.round_over = true;
    this.table.status = "round_complete";

    return { ok: true, valid, message: reason, scores, organized_melds: organized };
  }

  /* ---------------------------
     PART 7 — NEXT ROUND PREP
  ----------------------------*/
  prepareNextRound() {
    if (!this.round_over) return { ok: false, message: "Previous round not finished" };

    // reset flags (elimination handling should be at DB layer)
    this.round_over = false;
    this.wild_joker_rank = null;
    this.wild_joker_revealed = false;
    this.players_with_first_sequence = [];

    // increment round number and start round (reuse startRound)
    return this.startRound();
  }

  /* ---------------------------
     PART 8 — Internal helpers
  ----------------------------*/
  _cardPoints(card, aceValue = 10) {
    if (!card) return 0;
    if (card.joker || card.rank === "JOKER") return 0;
    const r = card.rank;
    if (["J","Q","K","10"].includes(r)) return 10;
    if (r === "A") return aceValue === 1 ? 1 : 10;
    const n = Number(r);
    return Number.isNaN(n) ? 0 : n;
  }

  _isJokerCard(card) {
    if (!card) return false;
    if (card.rank === "JOKER") return true;
    if (!this.wild_joker_rank) return false;
    // After reveal, wild rank acts as joker across the table
    return !!this.wild_joker_revealed && card.rank === this.wild_joker_rank;
  }

  toRoundDBPayload() {
    const hands = {};
    for (const p of this.players) hands[p.user_id] = deepClone(p.hand);
    return {
      id: uuidv4(),
      table_id: this.table.table_id,
      number: this.round_number,
      printed_joker: null,
      wild_joker_rank: this.wild_joker_rank,
      stock: deepClone(this.stock),
      discard: deepClone(this.discard),
      hands: deepClone(hands),
      active_user_id: this.getActiveUserId(),
      game_mode: this.table.wild_mode,
      ace_value: this.table.ace_value,
      players_with_first_sequence: deepClone(this.players_with_first_sequence),
    };
  }
}

module.exports = RummyEngine;
