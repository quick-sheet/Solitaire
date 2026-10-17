/* Solitaire core: Klondike rules, scoring, stats and table layout.
   Pure logic with no DOM, so it can be tested with plain node.
   Exposed as window.Sol in the browser and module.exports in node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sol = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ---------- Cards ----------
   A card is a number 0 to 51: suit * 13 + (rank - 1).
   Suits run spades 0, hearts 1, clubs 2, diamonds 3, so odd suits are red. */
const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_NAME = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
const SUIT_NAME = ['spades', 'hearts', 'clubs', 'diamonds'];
const rank = (id) => (id % 13) + 1;
const suit = (id) => Math.floor(id / 13);
const isRed = (id) => (suit(id) & 1) === 1;
const cardName = (id) => `${RANK_NAME[rank(id) - 1]} of ${SUIT_NAME[suit(id)]}`;

/* ---------- Seeded deals ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(seed) {
  const r = mulberry32((seed | 0) ^ 0x5bd1e995);
  r(); r(); r();   // warm up, so neighbouring deal numbers don't look alike
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}

/* State: stock and waste are arrays (top is the last card). found[s] holds suit s from the ace up.
   tab[i] is a column from the bottom up, and up[i] says how many cards at its top are face up. */
function deal(seed, draw) {
  const deck = shuffled(seed);
  const tab = [], up = [];
  let k = 0;
  for (let i = 0; i < 7; i++) { tab.push(deck.slice(k, k + i + 1)); k += i + 1; up.push(1); }
  return { v: 1, seed: seed | 0, draw: draw === 3 ? 3 : 1, stock: deck.slice(k), waste: [], found: [[], [], [], []], tab, up, score: 0, moves: 0, passes: 1 };
}
function clone(s) {
  return { v: s.v, seed: s.seed, draw: s.draw, stock: s.stock.slice(), waste: s.waste.slice(), found: s.found.map((a) => a.slice()),
    tab: s.tab.map((a) => a.slice()), up: s.up.slice(), score: s.score, moves: s.moves, passes: s.passes };
}

/* ---------- Rules ---------- */
// from: {k:'w'} waste top | {k:'f', s} foundation top | {k:'t', i, n} the top n cards of a column
// to:   {k:'t', i} | {k:'f', s}
function movingCards(s, from) {
  if (from.k === 'w') return s.waste.length ? [s.waste[s.waste.length - 1]] : null;
  if (from.k === 'f') { const f = s.found[from.s]; return f && f.length ? [f[f.length - 1]] : null; }
  if (from.k === 't') {
    const p = s.tab[from.i], n = from.n | 0;
    if (!p || n < 1 || n > s.up[from.i]) return null;
    return p.slice(p.length - n);
  }
  return null;
}
function fitsTab(s, id, j) {
  const p = s.tab[j];
  if (!p.length) return rank(id) === 13;
  const top = p[p.length - 1];
  return isRed(id) !== isRed(top) && rank(id) === rank(top) - 1;
}
function fitsFound(s, id, q) { return suit(id) === q && rank(id) === s.found[q].length + 1; }

function canMove(s, from, to) {
  const cards = movingCards(s, from);
  if (!cards) return false;
  if (to.k === 'f') return from.k !== 'f' && cards.length === 1 && fitsFound(s, cards[0], to.s);
  if (to.k === 't') return !(from.k === 't' && from.i === to.i) && fitsTab(s, cards[0], to.i);
  return false;
}

// Windows-style scoring: waste to column +5, anything to a foundation +10, turning a card over +5,
// foundation back to a column -15. The score never drops below zero.
function applyMove(s, from, to) {
  const cards = movingCards(s, from);
  let delta = 0, flipped = false;
  if (from.k === 'w') s.waste.pop();
  else if (from.k === 'f') s.found[from.s].pop();
  else { s.tab[from.i].splice(s.tab[from.i].length - cards.length, cards.length); s.up[from.i] -= cards.length; }
  if (to.k === 'f') { s.found[to.s].push(cards[0]); delta += 10; }
  else {
    for (const c of cards) s.tab[to.i].push(c);
    s.up[to.i] += cards.length;
    if (from.k === 'w') delta += 5;
    else if (from.k === 'f') delta -= 15;
  }
  if (from.k === 't' && s.tab[from.i].length && s.up[from.i] === 0) { s.up[from.i] = 1; delta += 5; flipped = true; }
  s.score = Math.max(0, s.score + delta);
  s.moves++;
  return { delta, flipped };
}

// Turn over the next card or cards from the stock; with the stock empty, turn the waste back over.
// Draw 1 costs 100 points for every pass after the first, draw 3 costs 20 for every pass after the third.
function drawCards(s) {
  if (s.stock.length) {
    const n = Math.min(s.draw, s.stock.length);
    for (let i = 0; i < n; i++) s.waste.push(s.stock.pop());
    s.moves++;
    return { type: 'draw', n };
  }
  if (s.waste.length) {
    s.stock = s.waste.slice().reverse();
    s.waste = [];
    s.passes++;
    if (s.draw === 1) s.score = Math.max(0, s.score - 100);
    else if (s.passes > 3) s.score = Math.max(0, s.score - 20);
    s.moves++;
    return { type: 'recycle' };
  }
  return null;
}

function isPointless(s, from, to) {
  // a king already at the bottom of its column gains nothing from moving to an empty one
  return from.k === 't' && to.k === 't' && !s.tab[to.i].length && s.tab[from.i].length === from.n;
}

// Where a tap on this card sends it: its foundation if it fits, else a column (one with cards before an empty one)
function tapTarget(s, from) {
  const cards = movingCards(s, from);
  if (!cards) return null;
  if (from.k !== 'f' && cards.length === 1) {
    const to = { k: 'f', s: suit(cards[0]) };
    if (canMove(s, from, to)) return to;
  }
  let empty = null;
  for (let j = 0; j < 7; j++) {
    const to = { k: 't', i: j };
    if (!canMove(s, from, to)) continue;
    if (s.tab[j].length) return to;
    if (!empty && !isPointless(s, from, to)) empty = to;
  }
  return empty;
}

function legalMoves(s) {
  const out = [];
  const toTabs = (from) => { for (let j = 0; j < 7; j++) if (canMove(s, from, { k: 't', i: j })) out.push({ from, to: { k: 't', i: j } }); };
  const toFounds = (from) => { for (let q = 0; q < 4; q++) if (canMove(s, from, { k: 'f', s: q })) out.push({ from, to: { k: 'f', s: q } }); };
  if (s.waste.length) { const f = { k: 'w' }; toFounds(f); toTabs(f); }
  for (let i = 0; i < 7; i++) {
    for (let n = 1; n <= s.up[i]; n++) { const f = { k: 't', i, n }; if (n === 1) toFounds(f); toTabs(f); }
  }
  for (let q = 0; q < 4; q++) if (s.found[q].length) toTabs({ k: 'f', s: q });
  return out;
}
const canDraw = (s) => s.stock.length > 0 || s.waste.length > 0;

// When nothing is face down and the stock and waste are empty, the rest is a matter of moving cards up.
function canAutoComplete(s) {
  if (s.stock.length || s.waste.length) return false;
  for (let i = 0; i < 7; i++) if (s.up[i] !== s.tab[i].length) return false;
  return !isWon(s);
}
function autoStep(s) {
  if (s.waste.length) {
    const from = { k: 'w' }, to = { k: 'f', s: suit(s.waste[s.waste.length - 1]) };
    if (canMove(s, from, to)) return { from, to };
  }
  for (let i = 0; i < 7; i++) {
    if (!s.tab[i].length) continue;
    const from = { k: 't', i, n: 1 }, to = { k: 'f', s: suit(s.tab[i][s.tab[i].length - 1]) };
    if (canMove(s, from, to)) return { from, to };
  }
  return null;
}
const isWon = (s) => s.found.every((f) => f.length === 13);
// Windows adds 700,000 divided by the seconds taken, for games over 30 seconds
const timeBonus = (ms) => { const sec = Math.round(ms / 1000); return sec >= 30 ? Math.floor(700000 / sec) : 0; };

// Is this a state the game could really be in? Used before trusting a saved game.
function validate(s) {
  try {
    if (!s || s.v !== 1 || (s.draw !== 1 && s.draw !== 3)) return false;
    if (![s.score, s.moves, s.passes, s.seed].every(Number.isInteger) || s.passes < 1 || s.score < 0 || s.moves < 0) return false;
    if (!Array.isArray(s.stock) || !Array.isArray(s.waste) || s.found.length !== 4 || s.tab.length !== 7 || s.up.length !== 7) return false;
    const seen = new Set();
    const take = (id) => { if (!Number.isInteger(id) || id < 0 || id > 51 || seen.has(id)) return false; seen.add(id); return true; };
    if (!s.stock.every(take) || !s.waste.every(take)) return false;
    for (let q = 0; q < 4; q++) { const f = s.found[q]; for (let k = 0; k < f.length; k++) if (f[k] !== q * 13 + k || !take(f[k])) return false; }
    for (let i = 0; i < 7; i++) {
      const p = s.tab[i], u = s.up[i];
      if (!p.every(take)) return false;
      if (!Number.isInteger(u) || (p.length ? u < 1 || u > p.length : u !== 0)) return false;
      for (let k = p.length - u; k < p.length - 1; k++) {
        if (isRed(p[k]) === isRed(p[k + 1]) || rank(p[k]) !== rank(p[k + 1]) + 1) return false;
      }
    }
    return seen.size === 52;
  } catch (e) { return false; }
}

/* ---------- Stats (kept separately for draw 1 and draw 3) ---------- */
const emptyMode = () => ({ played: 0, won: 0, streak: 0, bestStreak: 0, bestScore: 0, bestTime: 0, bestMoves: 0 });
const newStats = () => ({ v: 1, d1: emptyMode(), d3: emptyMode() });
const modeKey = (draw) => (draw === 3 ? 'd3' : 'd1');
function normStats(x) {
  const out = newStats();
  if (!x || typeof x !== 'object') return out;
  for (const m of ['d1', 'd3']) for (const k in out[m]) { const v = x[m] && x[m][k]; if (Number.isFinite(v) && v >= 0) out[m][k] = v; }
  return out;
}
// A game counts as played from its first move; leaving it unfinished ends the streak
function statStart(st, draw) { st[modeKey(draw)].played++; }
function statAbandon(st, draw) { st[modeKey(draw)].streak = 0; }
function statWin(st, draw, r) {
  const m = st[modeKey(draw)];
  m.won++; m.streak++; m.bestStreak = Math.max(m.bestStreak, m.streak);
  const flags = { first: m.won === 1, score: r.score > m.bestScore, time: !m.bestTime || r.ms < m.bestTime, moves: !m.bestMoves || r.moves < m.bestMoves };
  if (flags.score) m.bestScore = r.score;
  if (flags.time) m.bestTime = r.ms;
  if (flags.moves) m.bestMoves = r.moves;
  return flags;
}

/* ---------- Table layout ----------
   Works from the size of the play area and which side the stock is on. Portrait and landscape share one table:
   stock, waste and the four foundations in a row above seven columns.
   With flip the stock side moves to the right (for right-handed play) and the foundations to the left;
   the seven columns never change places. L.dir says which way the draw-3 fan opens: +1 to the right of the
   waste slot, -1 to its left, so the fan always opens towards the middle of the table. */
const CARD_RATIO = 1.4;
const FAN = 0.29;   // how far each draw-3 waste card opens, as a share of the card width (enough to show a whole corner index, even a 10)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Gaps down a column as shares of the card height: face-down d, face-up u. Under pressure the face-down gaps shrink first (to dMin of d), then the face-up ones.
const GAP = { d: 0.17, u: 0.36, dMin: 0.4 };
const U_FLOOR = 0.21;   // the smallest face-up gap the layout plans for: enough to read the rank in the corner
const U_FULL = 0.31;    // a face-up gap that shows the whole corner index, the rank and the small suit under it

/* One table for every screen shape: stock and waste top left, foundations top right, seven columns below.
   flip mirrors the top row (stock and waste on the right). A wide, short screen (a phone on its side) gets the same table with tighter spacing,
   and its cards are sized by the height, so the board is centred with spare room either side. */
function layout(o) {
  const W = o.W, H = o.H, flip = !!o.flip, R = CARD_RATIO, wide = W > H;
  const dir = flip ? -1 : 1;
  const pad = clamp(Math.min(W * 0.02, H * 0.03), 6, 16), gap = clamp(W * 0.016, 4, 12), rowK = wide ? 0.10 : 0.16;
  // cards are sized so that six face-down under ten face-up (a king down to a four) fit with the gaps squeezed to their floor.
  // On a wide, short screen they are also sized so that six face-down under eight face-up (a king down to a six) still shows every
  // corner index whole. A longer run than these squeezes further, and pileYs always keeps the whole column on the table.
  const worst = Math.max(6 * GAP.d * GAP.dMin + 9 * U_FLOOR, wide ? 6 * GAP.d * GAP.dMin + 7 * U_FULL : 0);
  const wW = (W - 2 * pad - 6 * gap) / 7;
  const hMax = (H - 2 * pad) / (2 + rowK + worst);
  const w = Math.max(10, Math.min(wW, hMax / R, 120)), h = w * R;
  const pitch = Math.min((W - 2 * pad - w) / 6, w * 1.7), offX = (W - (6 * pitch + w)) / 2;
  const x = (c) => offX + c * pitch;
  const tabY = pad + h + rowK * h, tabBottom = H - pad;
  const cs = flip ? 6 : 0, cw = flip ? 5 : 1, cf = flip ? [0, 1, 2, 3] : [3, 4, 5, 6];
  const L = { flip, dir, w, h, pad, tabY, tabBottom, fan: w * FAN, pitch,
    stock: { x: x(cs), y: pad }, waste: { x: x(cw), y: pad },
    found: cf.map((c) => ({ x: x(c), y: pad })),
    tab: [0, 1, 2, 3, 4, 5, 6].map((c) => ({ x: x(c), y: tabY })) };
  // use spare height for roomier columns, but never so much that the tallest column stops fitting
  const room = tabBottom - tabY - h;
  const stretch = clamp(room / ((6 * GAP.d + 12 * GAP.u) * h * 0.8), 1, 1.4);
  L.d = GAP.d * h * stretch;
  L.u = GAP.u * h * stretch;
  L.dMin = GAP.dMin;
  L.fs = Math.max(8, w * 0.24);   // corner rank size (the floor only matters on cards narrower than any phone gives)
  return L;
}

// x of a waste card: rel = 0 is the top card, vis how many are fanned out (1 for draw 1, up to 3 for draw 3).
// Cards below the fan sit under the oldest fanned card.
function wasteX(L, rel, vis) {
  const r = Math.min(rel, Math.max(0, vis - 1));
  return L.dir > 0 ? L.waste.x + (vis - 1 - r) * L.fan : L.waste.x - r * L.fan;
}

// Heights of the cards in one column: n cards, the top k face up. If the column would run out of room the face-down gaps close up first
// (to a floor), so the face-up cards keep their corners readable; only then do the face-up gaps shrink too.
function pileYs(L, n, k) {
  const out = new Array(n);
  if (!n) return out;
  const downs = Math.max(0, n - k), ups = Math.max(0, k - 1), room = L.tabBottom - L.tabY - L.h;
  let d = L.d, u = L.u;
  if (downs * d + ups * u > room) {
    const dMin = L.d * L.dMin;
    if (downs * dMin + ups * u <= room) d = (room - ups * u) / downs;
    else if (downs * dMin >= room) { d = room / downs; u = 0; }
    else { d = dMin; u = (room - downs * dMin) / ups; }
  }
  let y = L.tabY;
  for (let j = 0; j < n; j++) { out[j] = y; y += j < n - k ? d : u; }
  return out;
}

return { RANK_LABEL, RANK_NAME, SUIT_NAME, rank, suit, isRed, cardName, mulberry32, shuffled, deal, clone, movingCards, fitsTab, fitsFound,
  canMove, applyMove, drawCards, canDraw, isPointless, tapTarget, legalMoves, canAutoComplete, autoStep, isWon, timeBonus, validate,
  newStats, normStats, statStart, statAbandon, statWin, layout, pileYs, wasteX, CARD_RATIO, REV: 4 };
});
