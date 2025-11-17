// server/engine/rummy_engine.js
// Full-featured Rummy Engine (Option B)
// Exports: class RummyEngine
//
// Depends on server/APIs/rummy_models.js and server/APIs/scoring.js
// - rummy_models should export: buildDeck(cfg), shuffleDeck(cards, seed)
// - scoring should export: validate_hand(melds, leftover, wild_joker_rank, revealed), calculate_deadwood_points(cards, wild_joker_rank, revealed, ace_value), auto_organize_hand(hand, wild_joker_rank, revealed)

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

/* Default deck config helper */
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
   * tableMeta is optional object representing table-level metadata needed by engine:
   * { table_id, host_user_id, wild_joker_mode, ace_value, disqualify_score, max_players }
   *
   * players: array of { user_id, display_name }
   */
  constructor(tableMeta = {}, players = []) {
    this.table = {
      table_id: tableMeta.table_id || uuidv4(),
      host_user_id: tableMeta.host_user_id || null,
      wild_joker_mode: tableMeta.wild_joker_mode || "open_joker",
      ace_value: tableMeta.ace_value || 10,
      disqualify_score: tableMeta.disqualify_score || 200,
      max_players: tableMeta.max_players || 4,
      status: "waiting",
    };

    // players state
    this.players = (players || []).map((p, idx) => ({
      user_id: p.user_id,
      display_name: p.display_name || `Player-${String(p.user_id).slice(-6)}`,
      seat: p.seat || idx + 1,
      hand: [],
      hasDrawn: false,
      dropped: false,
      drop_points: 0,
    }));

    // round state
    this.round_number = 0;
    this.stock = []; // array of card objects
    this.discard = [];
    this.discard_top = null; // encoded string
    this.active_index = 0; // index into this.players
    this.wild_joker_rank = null;
    this.wild_joker_revealed = false;
    this.players_with_first_sequence = []; // user_ids
    this.round_over = false;
    this.history = []; // array of round results
  }

  /* ---------------------------
     Utilities / Serializers
  ----------------------------*/
  serializeCard(card) {
    return encodeCard(card);
  }

  getPlayerIndex(userId) {
    return this.players.findIndex((p) => p.user_id === userId);
  }

  getActiveUserId() {
    return this.players[this.active_index] ? this.players[this.active_index].user_id : null;
  }

  // Safe snapshot for client (non-sensitive fields)
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
      game_mode: this.table.wild_joker_mode,
    };
  }

  /* ---------------------------
     PART 1 — DEAL + START ROUND
  ----------------------------*/
  startRound(seed = null) {
    if (this.table.status === "playing") {
      return { ok: false, message: "Round already playing" };
    }
    if (this.players.filter((p) => !p.dropped).length < 2) {
      return { ok: false, message: "Need at least 2 players to start" };
    }

    this.round_number += 1;
    this.round_over = false;
    this.players.forEach((p) => {
      p.hand = [];
      p.hasDrawn = false;
      p.dropped = false;
      p.drop_points = 0;
    });

    // Determine wild_joker_rank per table mode
    if (this.table.wild_joker_mode && this.table.wild_joker_mode !== "no_joker") {
      const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
      const idx = seed ? Math.abs(seed) % ranks.length : Math.floor(Math.random() * ranks.length);
      this.wild_joker_rank = ranks[idx];
    } else {
      this.wild_joker_rank = null;
    }
    this.wild_joker_revealed = false;
    this.players_with_first_sequence = [];

    // Build deck(s)
    const cfg = defaultDeckConfig(this.players.length);
    let fullDeck = [];
    for (let i = 0; i < cfg.decks; i++) {
      fullDeck = fullDeck.concat(buildDeck({ include_printed_jokers: cfg.include_printed_jokers }));
    }

    // shuffle
    fullDeck = shuffleDeck(fullDeck, seed);

    // deal 13 each
    for (let i = 0; i < 13; i++) {
      for (const p of this.players) {
        const card = fullDeck.pop();
        p.hand.push(card);
      }
    }

    // reveal discard top: skip if you want to pop printed jokers onto discard but ensure discard top is first non-null
    // keep popping until a non-printed-joker appears or deck empty
    this.discard = [];
    this.discard_top = null;
    while (fullDeck.length > 0) {
      const top = fullDeck.pop();
      this.discard.push(top);
      this.discard_top = this.serializeCard(top);
      // if top is not a printed joker, break (printed jokers have card.joker true and rank === 'JOKER')
      if (!(top.joker === true && top.rank === "JOKER")) break;
      // else continue; printed jokers remain in discard stack
    }

    // remaining => stock
    this.stock = fullDeck.slice();

    // default active: host seat rotation — host first for round 1, rotate by round_number-1
    let startIndex = 0;
    if (this.table.host_user_id) {
      const hostIdx = this.getPlayerIndex(this.table.host_user_id);
      if (hostIdx >= 0) {
        startIndex = (hostIdx + (this.round_number - 1)) % this.players.length;
      }
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
    };
  }

  /* ---------------------------
     PART 2 — Player view
  ----------------------------*/
  getRoundMe(userId) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Not part of this table" };

    const p = this.players[idx];
    const handView = p.hand.map((c) => ({
      rank: c.rank,
      suit: c.suit || null,
      joker: !!c.joker,
      code: c.joker || c.rank === "JOKER" ? "JOKER" : `${c.rank}${c.suit || ""}`,
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
      hand: p.hand,
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
    if (this.discard.length === 0) return { ok: false, message: "Discard pile empty" };

    const card = this.discard.pop();
    p.hand.push(card);
    p.hasDrawn = true;

    this.discard_top = this.discard.length ? this.serializeCard(this.discard[this.discard.length - 1]) : null;

    return {
      ok: true,
      hand: p.hand,
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

    // Match by rank and suit and joker flag
    const removeIdx = p.hand.findIndex((c) => {
      const csuit = c.suit || null;
      const rsuit = cardObj.suit || null;
      return c.rank === cardObj.rank && csuit === rsuit && (!!c.joker) === (!!cardObj.joker);
    });
    if (removeIdx === -1) return { ok: false, message: "Card not found in hand" };

    const [removed] = p.hand.splice(removeIdx, 1);
    this.discard.push(removed);
    this.discard_top = this.serializeCard(removed);

    // advance turn
    this.advanceTurn();

    return {
      ok: true,
      hand: p.hand,
      discard_top: this.discard_top,
      next_active_user_id: this.getActiveUserId(),
    };
  }

  advanceTurn() {
    // reset hasDrawn for next player, but only after rotating
    // compute next non-dropped index
    if (this.players.length === 0) {
      this.active_index = 0;
      return;
    }

    let next = (this.active_index + 1) % this.players.length;
    // find next non-dropped player
    let attempts = 0;
    while (this.players[next].dropped && attempts < this.players.length) {
      next = (next + 1) % this.players.length;
      attempts++;
    }
    this.active_index = next;

    // Reset hasDrawn for everyone at the start of each active player's turn
    this.players.forEach((p) => (p.hasDrawn = false));
  }

  /* ---------------------------
     PART 4 — DROP LOGIC + PENALTIES
  ----------------------------*/
  dropPlayer(userId) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    const p = this.players[idx];
    if (p.dropped) return { ok: false, message: "Player already dropped" };

    // penalty rules:
    // - drop before drawing first card => 20
    // - drop after drawing / in middle => 40 (or 60 depending on your rules). We'll use 40 but it's configurable.
    let penalty = 0;
    if (!p.hasDrawn) penalty = 20; // first-turn drop
    else penalty = 40; // middle drop; you can set 60 by changing this logic

    p.dropped = true;
    p.drop_points = penalty;

    // If only 1 active player remains, auto-finish round awarding winner
    const activePlayers = this.players.filter((pl) => !pl.dropped);
    if (activePlayers.length === 1) {
      const winnerId = activePlayers[0].user_id;
      return this._autoFinishAfterDrops(winnerId);
    }

    // If dropped player was current active, advance turn
    if (this.getActiveUserId() === userId) this.advanceTurn();

    return { ok: true, message: `Player dropped, penalty ${penalty}`, penalty };
  }

  _autoFinishAfterDrops(winnerId) {
    const scores = {};
    for (const p of this.players) {
      if (p.user_id === winnerId) scores[p.user_id] = 0;
      else if (p.dropped) scores[p.user_id] = p.drop_points || 0;
      else scores[p.user_id] = 40; // fallback
    }

    const record = {
      round_number: this.round_number,
      winner: winnerId,
      valid: true,
      auto_finished: true,
      scores,
      time: new Date().toISOString(),
      wild_joker_rank: this.wild_joker_rank,
      wild_joker_revealed: this.wild_joker_revealed,
    };
    this.history.push(record);
    this.round_over = true;
    this.table.status = "round_complete";

    return { ok: true, auto_finished: true, winner: winnerId, scores };
  }

  /* ---------------------------
     PART 5 — LOCK SEQUENCE (reveal wild joker)
     body: meld: [{rank,suit},...]
     If player locks a pure sequence first time, mark them and reveal wild joker.
  ----------------------------*/
  lockSequence(userId, meld) {
    // Basic checks
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    if (!Array.isArray(meld) || meld.length < 3) return { ok: false, message: "Meld must be at least 3 cards" };

    // Use scoring.validate_hand if available to check pure sequence.
    // scoring.validate_hand returns [bool, message] in some implementations; to be defensive, accept multiple shapes.
    try {
      // We test using scoring.is_sequence / is_pure_sequence if present; otherwise fall back to validate_hand
      let isPure = false;
      if (typeof scoring.is_pure_sequence === "function") {
        isPure = scoring.is_pure_sequence(meld, this.wild_joker_rank, this.players_with_first_sequence.includes(userId));
      } else if (typeof scoring.validate_hand === "function") {
        // validate_hand expects full declaration; we'll call is_sequence-ish from scoring if available
        const [ok, msg] = scoring.validate_hand([meld], [], this.wild_joker_rank, this.players_with_first_sequence.includes(userId));
        isPure = ok; // conservative — if validate_hand says ok for the small meld treat as pure
      } else {
        // fallback: accept and reveal (less strict)
        isPure = true;
      }

      if (!isPure) {
        return { ok: false, message: "Meld not a pure sequence" };
      }

      if (!this.players_with_first_sequence.includes(userId)) {
        this.players_with_first_sequence.push(userId);
      }
      // Reveal wild joker to everyone (server behavior)
      this.wild_joker_revealed = true;

      return { ok: true, message: "Pure sequence locked, wild joker revealed", wild_joker_rank: this.wild_joker_rank };
    } catch (e) {
      return { ok: false, message: `Lock sequence failed: ${String(e)}` };
    }
  }

  /* ---------------------------
     PART 6 — DECLARE FLOW
     prepareDeclare: light-weight client-side subset check
     finishRound / declare: full validation using scoring module
  ----------------------------*/
  prepareDeclare(userId, groups) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    const p = this.players[idx];

    // flattened 13-card check
    const flattened = Array.isArray(groups) ? [].concat(...groups) : [];
    if (flattened.length !== 13) return { ok: false, message: "Declared groups must contain exactly 13 cards" };

    // verify they exist in player's hand
    const handCopy = p.hand.slice();
    for (const card of flattened) {
      const findIdx = handCopy.findIndex((c) => c.rank === card.rank && (c.suit || null) === (card.suit || null) && (!!c.joker) === (!!card.joker));
      if (findIdx === -1) return { ok: false, message: `Declared card ${card.rank}${card.suit || ""} not in your hand` };
      handCopy.splice(findIdx, 1);
    }

    return { ok: true, declared_groups: groups };
  }

  /**
   * declare: runs full validation & scoring using scoring module.
   * groups: array of arrays representing the melds (13 cards)
   *
   * returns: { ok: true/false, valid: bool, scores: {userId:points}, organized_melds, message }
   */
  declare(userId, groups) {
    const idx = this.getPlayerIndex(userId);
    if (idx === -1) return { ok: false, message: "Player not in round" };
    const p = this.players[idx];

    // require player had 14 cards (drawn)
    if (p.hand.length !== 14) {
      return { ok: false, message: `Must have 14 cards to declare. You have ${p.hand.length}` };
    }

    // Basic subset check
    const prep = this.prepareDeclare(userId, groups);
    if (!prep.ok) return { ok: false, message: prep.message };

    // Build hands map snapshot (for scoring)
    const handsSnapshot = {};
    for (const pl of this.players) handsSnapshot[pl.user_id] = pl.hand.slice();

    // Use scoring.validate_hand (server scoring module)
    let valid = false;
    let reason = "Validation not executed";
    try {
      // scoring.validate_hand returns (True/False, message) in user-provided module shape
      if (typeof scoring.validate_hand === "function") {
        const [ok, msg] = scoring.validate_hand(groups, [], this.wild_joker_rank, this.players_with_first_sequence.includes(userId));
        valid = !!ok;
        reason = msg || (valid ? "Valid declaration" : "Invalid declaration");
      } else {
        // Fallback: accept as valid (should not happen if scoring module exists)
        valid = true;
        reason = "No server-side validation available; accepted by default";
      }
    } catch (e) {
      valid = false;
      reason = `Validation error: ${String(e)}`;
    }

    const organizedMelds = {};
    const scores = {};

    if (valid) {
      // Winner gets 0 points
      scores[userId] = 0;
      // For each opponent, auto-organize their hand and calculate deadwood
      for (const opp of this.players) {
        if (opp.user_id === userId) {
          organizedMelds[opp.user_id] = {
            pure_sequences: groups, // winner declared groups (approx)
            sequences: [],
            sets: [],
            deadwood: [],
          };
          continue;
        }

        // Opponent may have dropped
        if (opp.dropped) {
          scores[opp.user_id] = opp.drop_points || 0;
          organizedMelds[opp.user_id] = { pure_sequences: [], sequences: [], sets: [], deadwood: [] };
          continue;
        }

        // Auto organize opponent hand using scoring.auto_organize_hand if available
        let melds = [];
        let leftover = opp.hand.slice();
        if (typeof scoring.auto_organize_hand === "function") {
          try {
            const out = scoring.auto_organize_hand(opp.hand.slice(), this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id));
            if (Array.isArray(out) && out.length === 2) {
              melds = out[0];
              leftover = out[1];
            }
          } catch (e) {
            // fallback: treat whole hand as leftover
            melds = [];
            leftover = opp.hand.slice();
          }
        }

        const deadwoodPts = (typeof scoring.calculate_deadwood_points === "function")
          ? scoring.calculate_deadwood_points(leftover, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id), this.table.ace_value)
          : leftover.reduce((s, c) => s + this._cardPoints(c, this.table.ace_value), 0);

        scores[opp.user_id] = Math.min(deadwoodPts, 80);
        organizedMelds[opp.user_id] = {
          pure_sequences: melds.filter((m) => scoring.is_pure_sequence ? scoring.is_pure_sequence(m, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id)) : []),
          sequences: melds.filter((m) => scoring.is_sequence ? scoring.is_sequence(m, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id)) && !(scoring.is_pure_sequence && scoring.is_pure_sequence(m, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id))) : []),
          sets: melds.filter((m) => scoring.is_set ? scoring.is_set(m, this.wild_joker_rank, this.players_with_first_sequence.includes(opp.user_id)) : []),
          deadwood: leftover,
        };
      }
    } else {
      // Wrong show: declarer gets penalty (full deadwood capped at 80), others 0
      const declarerPts = Math.min(
        (typeof scoring.calculate_deadwood_points === "function")
          ? scoring.calculate_deadwood_points(p.hand.slice(), this.wild_joker_rank, this.players_with_first_sequence.includes(userId), this.table.ace_value)
          : p.hand.reduce((s, c) => s + this._cardPoints(c, this.table.ace_value), 0),
        80
      );

      for (const pl of this.players) {
        if (pl.user_id === userId) {
          scores[pl.user_id] = declarerPts;
          organizedMelds[pl.user_id] = { pure_sequences: [], sequences: [], sets: [], deadwood: pl.hand.slice() };
        } else {
          scores[pl.user_id] = 0;
          organizedMelds[pl.user_id] = { pure_sequences: [], sequences: [], sets: [], deadwood: [] };
        }
      }
    }

    // persist result into engine history and mark round finished
    const record = {
      round_number: this.round_number,
      declared_by: userId,
      valid,
      reason,
      scores,
      organized_melds: organizedMelds,
      hands_snapshot: handsSnapshot,
      wild_joker_rank: this.wild_joker_rank,
      wild_joker_revealed: this.wild_joker_revealed,
      time: new Date().toISOString(),
    };
    this.history.push(record);
    this.round_over = true;
    this.table.status = "round_complete";

    return {
      ok: true,
      valid,
      message: reason,
      scores,
      organized_melds: organizedMelds,
    };
  }

  /* ---------------------------
     PART 7 — FINISH ROUND & NEXT ROUND PREPARATION
  ----------------------------*/
  // finishRound delegated above in declare. We provide prepareNextRound to re-deal and rotate starting player.
  prepareNextRound() {
    if (!this.round_over) return { ok: false, message: "Cannot start next round — previous not finished" };

    // Eliminate players over disqualify_score if needed (engine-level marking only)
    const survivors = [];
    for (const p of this.players) {
      // compute total points from history accumulated for this player
      // engine doesn't track table-level total points by default — leave to DB layer.
      survivors.push(p.user_id);
    }

    // reset round flags
    this.round_over = false;
    this.wild_joker_rank = null;
    this.wild_joker_revealed = false;
    this.players_with_first_sequence = [];

    // increment round and re-deal
    return this.startRound();
  }

  /* ---------------------------
     PART 8 — Internal helpers (card scoring & validators)
  ----------------------------*/
  _cardPoints(card, aceValue = 10) {
    if (!card) return 0;
    if (card.joker || card.rank === "JOKER") return 0;
    const r = card.rank;
    if (["J", "Q", "K", "10"].includes(r)) return 10;
    if (r === "A") return aceValue === 1 ? 1 : 10;
    const n = Number(r);
    return Number.isNaN(n) ? 0 : n;
  }

  _isJokerCard(card) {
    if (!card) return false;
    if (card.rank === "JOKER") return true;
    if (!this.wild_joker_rank) return false;
    // wild joker acts as joker only after it is revealed to that player; engine-level check uses global revealed flag
    return this.wild_joker_revealed && card.rank === this.wild_joker_rank;
  }

  /* ---------------------------
     Utility: build engine state snapshot for DB writing
  ----------------------------*/
  toRoundDBPayload() {
    const hands = {};
    for (const p of this.players) hands[p.user_id] = p.hand.slice();

    return {
      id: uuidv4(),
      table_id: this.table.table_id,
      number: this.round_number,
      printed_joker: null,
      wild_joker_rank: this.wild_joker_rank,
      stock: JSON.parse(JSON.stringify(this.stock)),
      discard: JSON.parse(JSON.stringify(this.discard)),
      hands: JSON.parse(JSON.stringify(hands)),
      active_user_id: this.getActiveUserId(),
      game_mode: this.table.wild_joker_mode,
      ace_value: this.table.ace_value,
      players_with_first_sequence: JSON.parse(JSON.stringify(this.players_with_first_sequence)),
    };
  }
}

module.exports = RummyEngine;
