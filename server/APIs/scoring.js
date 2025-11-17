// server/APIs/scoring.js
// Rummy Scoring Logic — Final, Fully Compatible With New Engine (Option B)

const RANK_ORDER = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const RANK_POINTS = {
  "A": 10,  // default unless aceValue=1 is supplied externally
  "K": 10, "Q": 10, "J": 10,
  "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2
};

/* ----------------------------------
   Utility Extractor
----------------------------------- */
function _getAttr(card, attr, def = null) {
  if (!card || typeof card !== "object") return def;
  return card[attr] !== undefined ? card[attr] : def;
}

/* ----------------------------------
   Joker Detection
----------------------------------- */
function isJokerCard(card, wildJokerRank = null, hasWildRevealed = false) {
  const rank = _getAttr(card, "rank");
  if (rank === "JOKER") return true;              // Printed joker
  if (hasWildRevealed && wildJokerRank && rank === wildJokerRank) return true;
  return false;
}

/* ----------------------------------
   Card Points
----------------------------------- */
function cardPoints(card, aceValue = 10) {
  if (!card) return 0;
  if (_getAttr(card, "rank") === "JOKER") return 0;
  const rank = _getAttr(card, "rank");

  if (rank === "A") return aceValue;    // Ace=1 or 10
  return RANK_POINTS[rank] || 0;
}

function naiveHandPoints(hand = [], aceValue = 10) {
  const total = hand.reduce((s, c) => s + cardPoints(c, aceValue), 0);
  return Math.min(total, 80);
}

/* ----------------------------------
   Rank Helpers
----------------------------------- */
const rankIndex = (rank) => RANK_ORDER.indexOf(String(rank));

/* ----------------------------------
   Sequence Check (with jokers)
----------------------------------- */
function isSequence(cards = [], wildJokerRank = null, hasWildRevealed = false) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  // Suit check for non-jokers
  const suits = cards
    .filter(c => !isJokerCard(c, wildJokerRank, hasWildRevealed))
    .map(c => _getAttr(c, "suit"));
  if (suits.length > 0 && new Set(suits).size > 1) return false;

  const jokerCount = cards.filter(c => isJokerCard(c, wildJokerRank, hasWildRevealed)).length;
  const nonJokers = cards.filter(c => !isJokerCard(c, wildJokerRank, hasWildRevealed));
  if (nonJokers.length < 2) return false;

  const idx = nonJokers.map(c => rankIndex(_getAttr(c, "rank"))).sort((a,b)=>a-b);

  const gapsNeeded = idx.reduce((gaps, v, i) => {
    if (i === 0) return 0;
    const gap = v - idx[i-1] - 1;
    return gaps + Math.max(gap, 0);
  }, 0);

  return gapsNeeded <= jokerCount;
}

/* ----------------------------------
   Pure Sequence
----------------------------------- */
function isPureSequence(cards = [], wildJokerRank = null, hasWildRevealed = false) {
  if (!isSequence(cards, wildJokerRank, hasWildRevealed)) return false;

  // Cannot contain printed jokers
  if (cards.some(c => _getAttr(c, "rank") === "JOKER")) return false;

  // Wild jokers cannot substitute
  if (hasWildRevealed && wildJokerRank) {
    if (cards.some(c => _getAttr(c, "rank") === wildJokerRank)) {
      return false;
    }
  }

  // Must be strictly consecutive now
  const idx = cards.map(c => rankIndex(_getAttr(c, "rank"))).sort((a,b)=>a-b);
  return idx.every((v,i) => i === 0 || v - idx[i-1] === 1);
}

/* ----------------------------------
   Sets
----------------------------------- */
function isSet(cards = [], wildJokerRank = null, hasWildRevealed = false) {
  if (!Array.isArray(cards) || cards.length < 3 || cards.length > 4) return false;

  const nonJokers = cards.filter(c => !isJokerCard(c, wildJokerRank, hasWildRevealed));
  if (nonJokers.length < 2) return false;

  const ranks = new Set(nonJokers.map(c => _getAttr(c, "rank")));
  if (ranks.size !== 1) return false;

  const suits = nonJokers.map(c => _getAttr(c,"suit"));
  if (new Set(suits).size !== suits.length) return false;

  return true;
}

/* ----------------------------------
   Full Hand Validation
----------------------------------- */
function validateHand(melds = [], leftover = [], wildJokerRank = null, hasWildRevealed = false) {
  if (!Array.isArray(melds) || melds.length === 0)
    return { valid:false, reason:"No melds provided" };

  const total = melds.reduce((s, g) => s + (Array.isArray(g) ? g.length : 0), 0);
  if (total !== 13) return { valid:false, reason:`Total cards must be 13, got ${total}` };

  let hasPure = false;

  for (const g of melds) {
    if (!Array.isArray(g) || g.length < 3)
      return { valid:false, reason:"Each meld must have ≥3 cards" };

    const seq  = isSequence(g, wildJokerRank, hasWildRevealed);
    const pure = isPureSequence(g, wildJokerRank, hasWildRevealed);
    const set  = isSet(g, wildJokerRank, hasWildRevealed);

    if (!(seq || set)) {
      return { valid:false, reason:"Invalid meld detected" };
    }
    if (pure) hasPure = true;
  }

  if (!hasPure) return { valid:false, reason:"At least one pure sequence required" };

  return { valid:true, reason:"Valid hand" };
}

/* ----------------------------------
   Deadwood Points
----------------------------------- */
function calculateDeadwoodPoints(cards = [], wildJokerRank = null, hasWildRevealed = false, aceValue = 10) {
  const total = cards.reduce((s, c) => {
    if (isJokerCard(c, wildJokerRank, hasWildRevealed)) return s;
    return s + cardPoints(c, aceValue);
  }, 0);
  return Math.min(total, 80);
}

/* ----------------------------------
   Combination Generator
----------------------------------- */
function combinations(arr, k) {
  const out = [];
  const n = arr.length;

  function back(i, temp) {
    if (temp.length === k) return out.push(temp.slice());
    for (let j = i; j < n; j++) {
      temp.push(arr[j]);
      back(j+1, temp);
      temp.pop();
    }
  }

  back(0, []);
  return out;
}

/* ----------------------------------
   Helpers to try forming melds
----------------------------------- */
function tryFormSequence(pool, wildJokerRank, hasWildRevealed) {
  if (!pool || pool.length < 3) return null;

  for (const size of [4,3]) {
    if (pool.length < size) continue;
    for (const combo of combinations(pool, size)) {
      if (isSequence(combo, wildJokerRank, hasWildRevealed)) return combo;
    }
  }
  return null;
}

function tryFormSet(pool, wildJokerRank, hasWildRevealed) {
  if (!pool || pool.length < 3) return null;

  for (const size of [4,3]) {
    if (pool.length < size) continue;
    for (const combo of combinations(pool, size)) {
      if (isSet(combo, wildJokerRank, hasWildRevealed)) return combo;
    }
  }
  return null;
}

/* ----------------------------------
   Auto Organize Hand (Opponent Scoring)
----------------------------------- */
function autoOrganizeHand(hand = [], wildJokerRank = null, hasWildRevealed = false) {
  if (!Array.isArray(hand)) return { melds: [], leftover: [] };

  let remaining = hand.slice();
  const melds = [];

  // pure seq first
  while (remaining.length >= 3) {
    const seq = tryFormSequence(remaining, wildJokerRank, hasWildRevealed);
    if (!seq || !isPureSequence(seq, wildJokerRank, hasWildRevealed)) break;

    melds.push(seq);
    seq.forEach(c => {
      const i = remaining.indexOf(c);
      if (i !== -1) remaining.splice(i,1);
    });
  }

  // then impure sequences
  while (remaining.length >= 3) {
    const seq = tryFormSequence(remaining, wildJokerRank, hasWildRevealed);
    if (!seq) break;

    melds.push(seq);
    seq.forEach(c => {
      const i = remaining.indexOf(c);
      if (i !== -1) remaining.splice(i,1);
    });
  }

  // then sets
  while (remaining.length >= 3) {
    const set = tryFormSet(remaining, wildJokerRank, hasWildRevealed);
    if (!set) break;

    melds.push(set);
    set.forEach(c => {
      const i = remaining.indexOf(c);
      if (i !== -1) remaining.splice(i,1);
    });
  }

  return { melds, leftover: remaining };
}

/* ----------------------------------
   Organize hand (UI use)
----------------------------------- */
function organizeHandByMelds(hand = [], wildJokerRank = null, hasWildRevealed = false) {
  if (!Array.isArray(hand)) {
    return { pure_sequences: [], impure_sequences: [], sets: [], ungrouped: [] };
  }

  let remaining = hand.slice();
  const pure = [], impure = [], sets = [];

  function find(type) {
    if (remaining.length < 3) return null;
    for (const size of [4,3]) {
      if (remaining.length < size) continue;
      for (const combo of combinations(remaining, size)) {
        if (type === "pure_seq" && isPureSequence(combo, wildJokerRank, hasWildRevealed)) return combo;
        if (type === "impure_seq" && isSequence(combo, wildJokerRank, hasWildRevealed) && !isPureSequence(combo, wildJokerRank, hasWildRevealed)) return combo;
        if (type === "set" && isSet(combo, wildJokerRank, hasWildRevealed)) return combo;
      }
    }
    return null;
  }

  let m;

  // pure
  while ((m = find("pure_seq"))) {
    pure.push(m);
    m.forEach(c => remaining.splice(remaining.indexOf(c),1));
  }

  // impure
  while ((m = find("impure_seq"))) {
    impure.push(m);
    m.forEach(c => remaining.splice(remaining.indexOf(c),1));
  }

  // sets
  while ((m = find("set"))) {
    sets.push(m);
    m.forEach(c => remaining.splice(remaining.indexOf(c),1));
  }

  return {
    pure_sequences: pure,
    impure_sequences: impure,
    sets,
    ungrouped: remaining
  };
}

/* ----------------------------------
   EXPORTS — includes legacy + engine names
----------------------------------- */
module.exports = {
  isJokerCard,
  cardPoints,
  naiveHandPoints,

  isSequence,
  isPureSequence,
  isSet,

  validateHand,
  validate_hand: validateHand,

  calculateDeadwoodPoints,
  calculate_deadwood_points: calculateDeadwoodPoints,

  autoOrganizeHand,
  auto_organize_hand: autoOrganizeHand,

  organizeHandByMelds,
  organize_hand_by_melds: organizeHandByMelds
};
