// server/APIs/rummy_models.js
// FULLY MATCHING OLD PYTHON rummy_models.py — UI SAFE

class Card {
  constructor(rank, suit = null, joker = false) {
    this.rank = rank;       // "A", "2", ..., "K", "JOKER"
    this.suit = suit;       // "S", "H", "D", "C" or null
    this.joker = joker;     // true if printed/wild joker 
  }

  code() {
    if (this.joker && this.rank === "JOKER") return "JOKER";
    return `${this.rank}${this.suit || ""}`;
  }
}

class DeckConfig {
  constructor({ decks = 2, include_printed_jokers = true } = {}) {
    this.decks = decks;
    this.include_printed_jokers = include_printed_jokers;
  }
}

const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUITS = ["S","H","D","C"];

class ShuffledDeck {
  constructor(cards) {
    this.cards = cards; // array of Card
  }

  draw() {
    return this.cards.pop(); // top card
  }
}

function build_deck(cfg = new DeckConfig()) {
  let cards = [];

  for (let i = 0; i < cfg.decks; i++) {
    // Normal 52 cards
    for (const s of SUITS) {
      for (const r of RANKS) {
        cards.push(new Card(r, s, false));
      }
    }

    // Printed jokers
    if (cfg.include_printed_jokers) {
      cards.push(new Card("JOKER", null, true));
      cards.push(new Card("JOKER", null, true));
    }
  }
  return cards;
}

function fair_shuffle(cards, seed = null) {
  let copy = [...cards];
  let rng = seed != null ? mulberry32(seed) : Math.random;

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor((typeof rng === "function" ? rng() : Math.random()) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return new ShuffledDeck(copy);
}

// deterministic RNG (matching Python random.Random)
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

class DealResult {
  constructor({ hands, stock, discard, printed_joker }) {
    this.hands = hands;
    this.stock = stock;
    this.discard = discard;
    this.printed_joker = printed_joker;
  }
}

function deal_initial(user_ids, cfg = new DeckConfig(), seed = null) {
  let deck = fair_shuffle(build_deck(cfg), seed);

  let hands = {};
  user_ids.forEach(uid => hands[uid] = []);

  // 13 cards each
  for (let i = 0; i < 13; i++) {
    for (const uid of user_ids) {
      hands[uid].push(deck.draw());
    }
  }

  // discard pile start (skip jokers)
  let discard = [];
  while (true) {
    if (!deck.cards.length) break;
    let top = deck.draw();
    discard.push(top);
    if (!top.joker) break;
  }

  return new DealResult({
    hands,
    stock: deck.cards,
    discard,
    printed_joker: null
  });
}

module.exports = {
  Card,
  DeckConfig,
  ShuffledDeck,
  build_deck,
  fair_shuffle,
  DealResult,
  deal_initial,
  RANKS,
  SUITS
};
