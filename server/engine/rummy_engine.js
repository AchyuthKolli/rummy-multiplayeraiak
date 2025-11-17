/**
 * server/engine/rummy_engine.js
 * Core Rummy Engine — placed under server/engine to keep engine separate from API layer.
 *
 * Depends on:
 *   ../APIs/rummy_models.js
 *   ../APIs/scoring.js
 *
 * Export: class RummyEngine
 */

const { buildDeck, shuffleDeck } = require("../APIs/rummy_models");
const { validate_hand, calculate_deadwood_points, auto_organize_hand } = require("../APIs/scoring");

/* ----------------------------------
   Utility – pick deck count
----------------------------------- */
function pickDeckCount(playersCount) {
  if (playersCount <= 2) return 1;
  if (playersCount <= 4) return 2;
  return 3; // 5–6 players
}

/* ----------------------------------
   RummyEngine CLASS
----------------------------------- */
class RummyEngine {
  constructor(table_id, players = []) {
    this.table_id = table_id;

    // players = [{ user_id, display_name }]
    this.players = players.map((p) => ({
      user_id: p.user_id,
      display_name: p.display_name,
      hand: [],
      hasDrawn: false,
      dropped: false,
    }));

    this.nPlayers = this.players.length;

    this.stock = [];
    this.discard = [];
    this.discard_top = null;

    this.active_index = 0;

    this.wild_joker_rank = null;
    this.wild_joker_revealed = false;
  }

  // encode card for frontend (string like "10H" or "JOKER")
  encode(card) {
    if (!card) return "";
    if (card.rank === "JOKER") return "JOKER";
    return `${card.rank}${card.suit || ""}`;
  }

  /* ----------------------------------
     PART 2 — FINALIZED DEAL LOGIC
  ----------------------------------- */
  startRound() {
    const deckCount = pickDeckCount(this.players.length);

    let fullDeck = [];
    for (let i = 0; i < deckCount; i++) {
      fullDeck = fullDeck.concat(buildDeck()); // buildDeck returns one deck (52 + 2 jokers)
    }

    // Shuffle
    fullDeck = shuffleDeck(fullDeck);

    // Deal 13 cards each
    for (let i = 0; i < 13; i++) {
      for (let p of this.players) {
        const card = fullDeck.pop();
        p.hand.push(card);
      }
    }

    // Reveal discard top — skip jokers until non-joker placed (preserve any printed jokers on top)
    while (fullDeck.length > 0) {
      const top = fullDeck.pop();
      this.discard.push(top);
      this.discard_top = this.encode(top);

      // If top is not a printed joker, stop here
      if (!top.joker && top.rank !== "JOKER") break;
    }

    // Remaining -> stock
    this.stock = fullDeck;

    // Reset player states
    this.players.forEach((p) => {
      p.hasDrawn = false;
      p.dropped = false;
    });

    this.active_index = 0;

    return {
      ok: true,
      table_id: this.table_id,
      discard_top: this.discard_top,
      stock_count: this.stock.length,
    };
  }

  /* ----------------------------------
     Get player's personal view
  ----------------------------------- */
  getPlayerView(userId) {
    const p = this.players.find((x) => x.user_id === userId);
    if (!p) return null;

    return {
      hand: p.hand,
      stock_count: this.stock.length,
      discard_top: this.discard_top,
      wild_joker_revealed: this.wild_joker_revealed,
      wild_joker_rank: this.wild_joker_rank,
    };
  }

  /* ----------------------------------
     Draw from Stock
  ----------------------------------- */
  drawStock(userId) {
    const p = this.players.find((x) => x.user_id === userId);
    if (!p) return { ok: false, message: "Player not found" };

    if (this.players[this.active_index].user_id !== userId)
      return { ok: false, message: "Not your turn" };

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

  /* ----------------------------------
     Draw from Discard
  ----------------------------------- */
  drawDiscard(userId) {
    const p = this.players.find((x) => x.user_id === userId);
    if (!p) return { ok: false, message: "Player not found" };

    if (this.players[this.active_index].user_id !== userId)
      return { ok: false, message: "Not your turn" };

    if (p.hasDrawn) return { ok: false, message: "Already drawn" };
    if (!this.discard_top) return { ok: false, message: "Discard empty" };

    const card = this.discard.pop();
    p.hand.push(card);
    p.hasDrawn = true;

    this.discard_top = this.discard.length
      ? this.encode(this.discard[this.discard.length - 1])
      : null;

    return {
      ok: true,
      hand: p.hand,
      discard_top: this.discard_top,
      stock_count: this.stock.length,
    };
  }

  /* ----------------------------------
     Discard card
  ----------------------------------- */
  discardCard(userId, cardObj) {
    const p = this.players.find((x) => x.user_id === userId);
    if (!p) return { ok: false, message: "Player not found" };

    if (this.players[this.active_index].user_id !== userId)
      return { ok: false, message: "Not your turn" };

    if (!p.hasDrawn) return { ok: false, message: "Must draw before discard" };

    const idx = p.hand.findIndex(
      (c) => c.rank === cardObj.rank && (c.suit || null) === (cardObj.suit || null)
    );

    if (idx === -1) return { ok: false, message: "Card not in hand" };

    const [removed] = p.hand.splice(idx, 1);
    this.discard.push(removed);
    this.discard_top = this.encode(removed);

    this.advanceTurn();

    return { ok: true, hand: p.hand, discard_top: this.discard_top };
  }

  /* ----------------------------------
     Advance Turn
  ----------------------------------- */
  advanceTurn() {
    this.players.forEach((p) => (p.hasDrawn = false));
    // skip dropped players
    const activeCount = this.players.filter((pl) => !pl.dropped).length;
    if (activeCount === 0) {
      this.active_index = 0;
      return;
    }

    // Advance to next non-dropped player
    let next = (this.active_index + 1) % this.players.length;
    while (this.players[next].dropped) {
      next = (next + 1) % this.players.length;
    }
    this.active_index = next;
  }

  /* ----------------------------------
     Drop player (before draw penalty handled by caller)
  ----------------------------------- */
  dropPlayer(userId) {
    const p = this.players.find((x) => x.user_id === userId);
    if (!p) return { ok: false, message: "Player not in round" };
    p.dropped = true;
    // If dropped player was active, advance turn
    if (this.players[this.active_index].user_id === userId) {
      this.advanceTurn();
    }
    return { ok: true };
  }

  /* ----------------------------------
     Simple declare handler (full validation & scoring will be in scoring module)
     This function only performs:
       - basic membership checks
       - ensures declared groups use cards from player's hand
       - returns object to caller so server can write DB and compute final scores
  ----------------------------------- */
  prepareDeclare(userId, groups) {
    const p = this.players.find((x) => x.user_id === userId);
    if (!p) return { ok: false, message: "Player not found" };

    // Flatten declared cards and verify counts/subset of hand
    const flattened = [].concat(...groups);
    if (flattened.length !== 13) {
      return { ok: false, message: "Declared groups must contain exactly 13 cards" };
    }

    // Check declared cards exist in hand copy
    const handCopy = p.hand.slice();
    for (const card of flattened) {
      const idx = handCopy.findIndex(
        (c) => c.rank === card.rank && (c.suit || null) === (card.suit || null)
      );
      if (idx === -1) {
        return { ok: false, message: `Declared card ${card.rank}${card.suit||''} not in your hand` };
      }
      handCopy.splice(idx, 1);
    }

    // If it passes basic check, return payload for server-side scoring
    return { ok: true, declared_groups: groups };
  }
}

module.exports = RummyEngine;
// -----------------------------------------------------
// PART 3 — DECLARE / VALIDATION / SCORING
// -----------------------------------------------------

// Card point rules (Ace = 10, printed jokers = 0, wild jokers = 0)
_cardPoints(card, aceValue = 10) {
  if (card.rank === "JOKER") return 0;

  if (card.rank === "A") return aceValue;

  if (["J", "Q", "K", "10"].includes(card.rank)) return 10;

  return Number(card.rank);
}

// Is printed or wild joker?
_isJoker(card) {
  if (card.rank === "JOKER") return true;
  if (!this.wild_joker_rank) return false;
  return card.rank === this.wild_joker_rank;
}

// Check if cards form a valid set
_isValidSet(group) {
  if (group.length < 3 || group.length > 4) return false;

  const nonJokers = group.filter(c => !_isJoker(c));
  if (nonJokers.length < 2) return false;

  const ranks = new Set(nonJokers.map(c => c.rank));
  if (ranks.size !== 1) return false;

  const suits = new Set(nonJokers.map(c => c.suit).filter(Boolean));
  if (suits.size !== nonJokers.length) return false;

  return true;
}

// Validate sequence (pure or impure)
_isValidSequence(group) {
  if (group.length < 3) return { valid: false, pure: false };

  const nonJokers = group.filter(c => !this._isJoker(c));
  const jokerCount = group.length - nonJokers.length;

  const suits = new Set(nonJokers.map(c => c.suit));
  if (suits.size > 1) return { valid: false, pure: false };

  // convert ranks to numbers
  const rankMap = {
    "A": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
    "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13
  };
  const values = nonJokers.map(c => rankMap[c.rank]).sort((a,b) => a-b);

  // check consecutive with jokers filling gaps
  let neededJokers = 0;
  for (let i = 1; i < values.length; i++) {
    const gap = values[i] - values[i-1] - 1;
    if (gap > 0) neededJokers += gap;
  }

  const valid = neededJokers <= jokerCount;
  const pure = neededJokers === 0 && jokerCount === 0;

  return { valid, pure };
}

// Validate meld groups for declare
_validateMelds(melds) {
  let hasPureSeq = false;

  for (let group of melds) {
    const seq = this._isValidSequence(group);
    const isSet = this._isValidSet(group);

    if (!seq.valid && !isSet) {
      return { ok: false, message: "Invalid meld found" };
    }

    if (seq.pure) hasPureSeq = true;
  }

  if (!hasPureSeq) {
    return { ok: false, message: "At least 1 pure sequence required" };
  }

  return { ok: true };
}

// Calculate deadwood points after valid declare
_calculateDeadwood(hand) {
  let total = 0;
  for (let card of hand) {
    if (this._isJoker(card)) continue;
    total += this._cardPoints(card);
  }
  return Math.min(total, 80);
}

// Main declare function
declare(playerId, melds) {
  const p = this.players.find(pl => pl.user_id === playerId);
  if (!p) return { ok: false, message: "Player not in round" };

  if (melds.flat().length !== 13) {
    return { ok: false, message: "Must declare exactly 13 cards" };
  }

  const { ok, message } = this._validateMelds(melds);
  if (!ok) {
    // Wrong declaration → 80 penalty, others 0
    const scores = {};
    for (const pl of this.players) {
      scores[pl.user_id] = pl.user_id === playerId ? 80 : 0;
    }
    this.table.history.push({
      round: this.table.round_number,
      valid: false,
      winner: null,
      scores,
      time: new Date().toISOString()
    });
    this.table.status = "round_complete";
    return { ok: false, message: "Wrong Declare", scores };
  }

  // Valid declaration
  const scores = {};
  scores[playerId] = 0;

  for (const opponent of this.players) {
    if (opponent.user_id === playerId) continue;

    // deadwood = cards remaining in hand that weren't declared
    const dead = opponent.hand;
    scores[opponent.user_id] = this._calculateDeadwood(dead);
  }

  this.table.history.push({
    round: this.table.round_number,
    valid: true,
    winner: playerId,
    scores,
    time: new Date().toISOString()
  });

  this.table.status = "round_complete";

  return { ok: true, message: "Valid Declare", scores };
}
