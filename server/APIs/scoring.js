// server/APIs/scoring.js
// Rummy scoring utilities (Node.js)
// Converts the old Python logic into JS for the Node backend.

const RANK_ORDER = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const RANK_POINTS = {
  "A": 10, // default; cardPoints will use aceValue param
  "K": 10, "Q": 10, "J": 10,
  "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2
};

function _getCardAttr(card, attr, def = null) {
  if (card == null) return def;
  if (typeof card === 'object') {
    // card may be plain object or class instance
    return card[attr] !== undefined ? card[attr] : def;
  }
  return def;
}

function isJokerCard(card, wildJokerRank = null, hasWildRevealed = true) {
  const rank = _getCardAttr(card, "rank");
  const isPrinted = rank === "JOKER";
  if (isPrinted) return true;
  if (hasWildRevealed && wildJokerRank && rank === wildJokerRank) return true;
  return false;
}

function cardPoints(card, aceValue = 10) {
  if (!card) return 0;
  if (_getCardAttr(card, "joker")) return 0;
  const rank = _getCardAttr(card, "rank");
  if (rank === "A") return aceValue;
  return RANK_POINTS[rank] || 0;
}

function naiveHandPoints(hand = [], aceValue = 10) {
  const total = hand.reduce((s, c) => s + cardPoints(c, aceValue), 0);
  return Math.min(total, 80);
}

// Helper: index of rank in order (Ace = 0)
function rankIndex(rank) {
  return RANK_ORDER.indexOf(String(rank));
}

// Check sequence: consecutive ranks, same suit (allow jokers substitution)
function isSequence(cards = [], wildJokerRank = null, hasWildRevealed = true) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  // Non-joker suits must be same
  const nonJokerSuits = cards
    .filter(c => !isJokerCard(c, wildJokerRank, hasWildRevealed))
    .map(c => _getCardAttr(c, "suit"));
  if (nonJokerSuits.length > 0 && new Set(nonJokerSuits).size > 1) return false;

  const jokerCount = cards.filter(c => isJokerCard(c, wildJokerRank, hasWildRevealed)).length;
  const nonJokers = cards.filter(c => !isJokerCard(c, wildJokerRank, hasWildRevealed));
  if (nonJokers.length < 2) return false;

  // gather rank indices for non-jokers
  const indices = nonJokers.map(c => rankIndex(_getCardAttr(c, "rank"))).filter(i => i >= 0).sort((a,b)=>a-b);
  if (indices.length === 0) return false;

  const first = indices[0];
  const last = indices[indices.length - 1];
  const requiredSpan = last - first + 1;

  // If required span fits within cards length (gaps can be filled by jokers), sequence OK
  if (requiredSpan <= cards.length) return true;

  // Check wrap-around possibility: treat Ace as high (13)
  if (indices.includes(0) && indices.some(idx => idx >= 10)) {
    const alt = indices.map(i => i === 0 ? 13 : i).sort((a,b)=>a-b);
    const altSpan = alt[alt.length-1] - alt[0] + 1;
    if (altSpan <= cards.length) return true;
  }

  return false;
}

function isPureSequence(cards = [], wildJokerRank = null, hasWildRevealed = true) {
  if (!isSequence(cards, wildJokerRank, hasWildRevealed)) return false;

  // If any printed joker present -> not pure
  if (cards.some(c => _getCardAttr(c, "rank") === "JOKER")) return false;

  // If wild joker revealed, ensure it's not used as a substitute (it can be in natural position).
  if (!hasWildRevealed || !wildJokerRank) return true;

  // Ensure all suits equal (non-joker)
  const suits = cards.map(c => _getCardAttr(c, "suit"));
  const suitSet = new Set(suits.filter(s => s !== undefined && s !== null));
  if (suitSet.size > 1) return false;

  // Check if ranks are strictly consecutive (allowing Ace-high wrap)
  const indices = cards.map(c => rankIndex(_getCardAttr(c,"rank"))).filter(i => i >= 0);
  if (indices.length !== cards.length) return false;
  const sorted = indices.slice().sort((a,b)=>a-b);

  const isConsecutive = sorted.every((v,i) => {
    if (i === 0) return true;
    return sorted[i] - sorted[i-1] === 1;
  });
  if (isConsecutive) return true;

  // try Ace as high (13)
  if (sorted.includes(0) && sorted.some(idx => idx >= 10)) {
    const alt = sorted.map(i => i === 0 ? 13 : i).sort((a,b)=>a-b);
    const altCons = alt.every((v,i) => i===0 ? true : alt[i] - alt[i-1] === 1);
    if (altCons) return true;
  }

  // otherwise impure
  return false;
}

function isSet(cards = [], wildJokerRank = null, hasWildRevealed = true) {
  if (!Array.isArray(cards) || cards.length < 3 || cards.length > 4) return false;

  const nonJokerRanks = cards.filter(c => !isJokerCard(c, wildJokerRank, hasWildRevealed)).map(c => _getCardAttr(c,"rank"));
  if (nonJokerRanks.length === 0) return false;
  if (new Set(nonJokerRanks).size > 1) return false;

  // non-joker suits must be unique
  const suits = cards
    .filter(c => !isJokerCard(c, wildJokerRank, hasWildRevealed) && _getCardAttr(c,"suit"))
    .map(c => _getCardAttr(c,"suit"));
  if (suits.length !== new Set(suits).size) return false;

  return true;
}

// validate a declared hand (melds = array of groups that totals 13 cards)
function validateHand(melds = [], leftover = [], wildJokerRank = null, hasWildRevealed = true) {
  if (!Array.isArray(melds) || melds.length === 0) return { valid:false, reason: "No meld groups provided" };

  const total = melds.reduce((s,g) => s + (Array.isArray(g) ? g.length : 0), 0);
  if (total !== 13) return { valid:false, reason: `Meld groups must contain exactly 13 cards, found ${total}` };

  let hasPure = false;
  let validSequences = 0;
  let validSets = 0;

  for (const group of melds) {
    if (!Array.isArray(group) || group.length < 3) {
      return { valid:false, reason: `Each meld must have at least 3 cards` };
    }
    const seq = isSequence(group, wildJokerRank, hasWildRevealed);
    const pure = isPureSequence(group, wildJokerRank, hasWildRevealed);
    const setOk = isSet(group, wildJokerRank, hasWildRevealed);
    if (pure) {
      hasPure = true;
      validSequences += 1;
    } else if (seq) {
      validSequences += 1;
    } else if (setOk) {
      validSets += 1;
    } else {
      const cs = group.map(c => `${_getCardAttr(c,"rank")}${_getCardAttr(c,"suit")||''}`).join(", ");
      return { valid:false, reason: `Invalid meld: [${cs}] is neither a valid sequence nor set` };
    }
  }

  if (!hasPure) return { valid:false, reason: "Must have at least one pure sequence (no jokers)" };
  if (melds.length < 2) return { valid:false, reason: "Must have at least 2 melds" };

  return { valid:true, reason: "Valid hand" };
}

function calculateDeadwoodPoints(cards = [], wildJokerRank = null, hasWildRevealed = true, aceValue = 10) {
  const total = (cards || []).reduce((s, c) => {
    if (isJokerCard(c, wildJokerRank, hasWildRevealed)) return s + 0;
    return s + cardPoints(c, aceValue);
  }, 0);
  return Math.min(total, 80);
}

// helper to produce combinations for auto_organize
function combinations(arr, k) {
  const res = [];
  const n = arr.length;
  function backtrack(start, combo) {
    if (combo.length === k) { res.push(combo.slice()); return; }
    for (let i = start; i < n; i++) {
      combo.push(arr[i]);
      backtrack(i+1, combo);
      combo.pop();
    }
  }
  backtrack(0, []);
  return res;
}

// Try forming sequence or set from pool (supports 3 or 4)
function tryFormSequence(pool = [], wildJokerRank = null, hasWildRevealed = true) {
  const n = pool.length;
  if (n < 3) return null;
  // brute force combos of 4 then 3
  for (const size of [4,3]) {
    if (n < size) continue;
    const combs = combinations(pool, size);
    for (const combo of combs) {
      if (isSequence(combo, wildJokerRank, hasWildRevealed)) return combo;
    }
  }
  return null;
}

function tryFormSet(pool = [], wildJokerRank = null, hasWildRevealed = true) {
  const n = pool.length;
  if (n < 3) return null;
  for (const size of [4,3]) {
    if (n < size) continue;
    const combs = combinations(pool, size);
    for (const combo of combs) {
      if (isSet(combo, wildJokerRank, hasWildRevealed)) return combo;
    }
  }
  return null;
}

// Greedy auto-organize - approximate best melds for scoring opponents
function autoOrganizeHand(hand = [], wildJokerRank = null, hasWildRevealed = true) {
  if (!Array.isArray(hand) || hand.length === 0) return { melds: [], leftover: [] };

  let remaining = hand.slice();
  const melds = [];

  // First: pure sequences
  while (true) {
    const seq = tryFormSequence(remaining, wildJokerRank, hasWildRevealed);
    if (!seq) break;
    if (!isPureSequence(seq, wildJokerRank, hasWildRevealed)) break;
    melds.push(seq);
    // remove used cards (by identity)
    seq.forEach(card => {
      const idx = remaining.findIndex(c => c === card || (c.rank === card.rank && c.suit === card.suit && !!c.joker === !!card.joker));
      if (idx !== -1) remaining.splice(idx,1);
    });
  }

  // Second: any sequences
  while (true) {
    const seq = tryFormSequence(remaining, wildJokerRank, hasWildRevealed);
    if (!seq) break;
    melds.push(seq);
    seq.forEach(card => {
      const idx = remaining.findIndex(c => c === card || (c.rank === card.rank && c.suit === card.suit && !!c.joker === !!card.joker));
      if (idx !== -1) remaining.splice(idx,1);
    });
  }

  // Third: sets
  while (true) {
    const setg = tryFormSet(remaining, wildJokerRank, hasWildRevealed);
    if (!setg) break;
    melds.push(setg);
    setg.forEach(card => {
      const idx = remaining.findIndex(c => c === card || (c.rank === card.rank && c.suit === card.suit && !!c.joker === !!card.joker));
      if (idx !== -1) remaining.splice(idx,1);
    });
  }

  return { melds, leftover: remaining };
}

// Organize hand into categories for display
function organizeHandByMelds(hand = [], wildJokerRank = null, hasWildRevealed = true) {
  if (!Array.isArray(hand) || hand.length === 0) {
    return { pure_sequences: [], impure_sequences: [], sets: [], ungrouped: [] };
  }

  let remaining = hand.slice();
  const pure = [], impure = [], sets = [];

  // helper to find meld by type
  function findMeldOfType(cards, type) {
    if (cards.length < 3) return null;
    // try all combos of 4 then 3
    for (const size of [4,3]) {
      if (cards.length < size) continue;
      const combs = combinations(cards, size);
      for (const combo of combs) {
        if (type === 'pure_seq' && isPureSequence(combo, wildJokerRank, hasWildRevealed)) return combo;
        if (type === 'impure_seq' && isSequence(combo, wildJokerRank, hasWildRevealed) && !isPureSequence(combo, wildJokerRank, hasWildRevealed)) return combo;
        if (type === 'set' && isSet(combo, wildJokerRank, hasWildRevealed)) return combo;
      }
    }
    return null;
  }

  while (remaining.length >= 3) {
    const m = findMeldOfType(remaining, 'pure_seq');
    if (!m) break;
    pure.push(m);
    m.forEach(card => {
      const idx = remaining.findIndex(c => c === card || (c.rank === card.rank && c.suit === card.suit && !!c.joker === !!card.joker));
      if (idx !== -1) remaining.splice(idx,1);
    });
  }

  while (remaining.length >= 3) {
    const m = findMeldOfType(remaining, 'impure_seq');
    if (!m) break;
    impure.push(m);
    m.forEach(card => {
      const idx = remaining.findIndex(c => c === card || (c.rank === card.rank && c.suit === card.suit && !!c.joker === !!card.joker));
      if (idx !== -1) remaining.splice(idx,1);
    });
  }

  while (remaining.length >= 3) {
    const m = findMeldOfType(remaining, 'set');
    if (!m) break;
    sets.push(m);
    m.forEach(card => {
      const idx = remaining.findIndex(c => c === card || (c.rank === card.rank && c.suit === card.suit && !!c.joker === !!card.joker));
      if (idx !== -1) remaining.splice(idx,1);
    });
  }

  return { pure_sequences: pure, impure_sequences: impure, sets: sets, ungrouped: remaining };
}

module.exports = {
  isJokerCard,
  cardPoints,
  naiveHandPoints,
  isSequence,
  isPureSequence,
  isSet,
  validateHand,
  calculateDeadwoodPoints,
  autoOrganizeHand,
  organizeHandByMelds
};
