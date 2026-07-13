'use strict';
/* =====================================================================
   KANDARIN — Realm of Kings
   A RuneScape-inspired skilling/combat RPG with Dragonriding.
   Single-player client; world state is deterministic from a fixed seed.
   ===================================================================== */

/* ---------------- Core constants ---------------- */
const TILE = 32, W = 144, H = 144, TICK_MS = 600;
const T = {GRASS:0, WATER:1, SNOW:2, SAND:3, STONE:4, WALL:5, LAVA:6, VOLC:7, FLOOR:8, MTN:9};
const BLOCKED = new Set([T.WATER, T.WALL, T.LAVA, T.MTN]);
const SAVE_KEY = 'kandarin_save_v1';
const LEGACY_SAVE_KEY = 'emberfall_save_v1'; // saves from before the rename still load

/* RuneScape XP curve: XP_TABLE[n] = xp required for level n (1..99) */
const XP_TABLE = (() => {
  const t = [0, 0]; let pts = 0;
  for (let l = 1; l < 99; l++) {
    pts += Math.floor(l + 300 * Math.pow(2, l / 7));
    t.push(Math.floor(pts / 4));
  }
  return t;
})();
function toLevel(xp) {
  let l = 1;
  while (l < 99 && xp >= XP_TABLE[l + 1]) l++;
  return l;
}

const SKILLS = [
  {id:'attack',       name:'Attack',       icon:'⚔️'},
  {id:'strength',     name:'Strength',     icon:'💪'},
  {id:'defence',      name:'Defence',      icon:'🛡️'},
  {id:'hitpoints',    name:'Hitpoints',    icon:'❤️'},
  {id:'archery',      name:'Archery',      icon:'🏹'},
  {id:'sorcery',      name:'Sorcery',      icon:'🔮'},
  {id:'faith',        name:'Faith',        icon:'🌳'},
  {id:'woodcutting',  name:'Woodcutting',  icon:'🪓'},
  {id:'mining',       name:'Mining',       icon:'⛏️'},
  {id:'fishing',      name:'Fishing',      icon:'🎣'},
  {id:'smithing',     name:'Smithing',     icon:'🔨'},
  {id:'cooking',      name:'Cooking',      icon:'🍖'},
  {id:'dragonriding', name:'Dragonriding', icon:'🐉'},
];

/* ---------------- Items ----------------
   Weapons carry a combat class (melee / archery / sorcery) and follow the
   RuneScape tier ladder 1/10-20/30-40/50-60 per class. `value` is the shop
   price; shops buy back at 40%. Items without a value cannot be traded. */
const ITEMS = {
  coins:          {name:'Gold Dragons', icon:'💰', stack:true},
  logs:           {name:'Pine Logs', icon:'🪵', stack:true, value:4},
  ironwood_logs:  {name:'Ironwood Logs', icon:'🪵', stack:true, value:16},
  weirwood_logs:  {name:'Weirwood Logs', icon:'🪵', stack:true, value:45},
  raw_trout:      {name:'Raw River Trout', icon:'🐟', stack:true, value:3},
  trout:          {name:'River Trout', icon:'🍥', stack:true, heal:4, value:8},
  raw_salmon:     {name:'Raw Salmon', icon:'🐟', stack:true, value:10},
  salmon:         {name:'Smoked Salmon', icon:'🍣', stack:true, heal:9, value:25},
  raw_blackfish:  {name:'Raw Blackfish', icon:'🐡', stack:true, value:25},
  blackfish:      {name:'Blackwater Blackfish', icon:'🍱', stack:true, heal:16, value:60},
  copper_ore:     {name:'Copper Ore', icon:'🟤', stack:true, value:4},
  iron_ore:       {name:'Iron Ore', icon:'⚪', stack:true, value:14},
  dragonglass:    {name:'Dragonglass', icon:'⬛', stack:true, value:40},
  valyrian_ore:   {name:'Valyrian Ore', icon:'🔷', stack:true, value:100},
  bronze_bar:     {name:'Bronze Bar', icon:'🟧', stack:true, value:10},
  iron_bar:       {name:'Iron Bar', icon:'⬜', stack:true, value:35},
  steel_bar:      {name:'Castle-forged Steel Bar', icon:'🔳', stack:true, value:65},
  obsidian_bar:   {name:'Obsidian Bar', icon:'🌑', stack:true, value:110},
  valyrian_bar:   {name:'Valyrian Steel Bar', icon:'💠', stack:true, value:260},
  arrows:         {name:'Arrows', icon:'🎯', stack:true, value:2},
  bones:          {name:'Bones', icon:'🦴', stack:true, faith:15, value:1},
  big_bones:      {name:'Drake Bones', icon:'🦴', stack:true, faith:45, value:20},
  /* Melee tier ladder (Attack) */
  bronze_sword:   {name:'Bronze Sword', icon:'🗡️', slot:'weapon', lvl:1,  power:4,  value:25},
  iron_sword:     {name:'Iron Sword', icon:'🗡️', slot:'weapon', lvl:10, power:7,  value:70},
  steel_sword:    {name:'Castle-forged Sword', icon:'🗡️', slot:'weapon', lvl:20, power:11, value:140},
  obsidian_sword: {name:'Obsidian Blade', icon:'🗡️', slot:'weapon', lvl:30, power:16, value:280},
  valyrian_sword: {name:'Valyrian Steel Sword', icon:'🗡️', slot:'weapon', lvl:50, power:25, value:650},
  flamebrand_katana:{name:'Flamebrand Katana', icon:'⚔️', slot:'weapon', lvl:60, power:30, value:2000},
  /* Archery tier ladder */
  shortbow:       {name:'Shortbow', icon:'🏹', slot:'weapon', class:'archery', lvl:1,  power:4,  value:20},
  ironwood_bow:   {name:'Ironwood Bow', icon:'🏹', slot:'weapon', class:'archery', lvl:20, power:11, value:140},
  weirwood_bow:   {name:'Weirwood Bow', icon:'🏹', slot:'weapon', class:'archery', lvl:40, power:18, value:400},
  sunforged_bow:  {name:'Sunforged Bow', icon:'🌞', slot:'weapon', class:'archery', lvl:60, power:30, value:2000},
  /* Sorcery tier ladder */
  apprentice_staff:{name:'Apprentice Staff', icon:'🪄', slot:'weapon', class:'sorcery', lvl:1,  power:4,  value:20},
  acolyte_staff:  {name:'Acolyte Staff', icon:'🪄', slot:'weapon', class:'sorcery', lvl:20, power:11, value:140},
  pyromancer_staff:{name:'Pyromancer Staff', icon:'🪄', slot:'weapon', class:'sorcery', lvl:40, power:18, value:400},
  serpent_staff:  {name:'Serpent Staff', icon:'🐍', slot:'weapon', class:'sorcery', lvl:60, power:30, value:2000},
  /* Armor tier ladder (Defence) */
  bronze_armor:   {name:'Bronze Plate', icon:'🛡️', slot:'armor', lvl:1,  armor:4,  value:25},
  iron_armor:     {name:'Iron Plate', icon:'🛡️', slot:'armor', lvl:10, armor:7,  value:70},
  steel_armor:    {name:'Castle-forged Plate', icon:'🛡️', slot:'armor', lvl:20, armor:11, value:140},
  obsidian_armor: {name:'Obsidian Scale', icon:'🛡️', slot:'armor', lvl:30, armor:16, value:280},
  valyrian_armor: {name:'Valyrian Plate', icon:'🛡️', slot:'armor', lvl:50, armor:25, value:650},
  frostscale_armor:{name:'Frostscale Armor', icon:'🧊', slot:'armor', lvl:60, armor:30, value:2000},
  aspect_gild:  {name:'Gilded Dragon Aspect', icon:'🟡', aspect:'gild'},
  aspect_venom: {name:'Venom Dragon Aspect', icon:'🟢', aspect:'venom'},
  aspect_flame: {name:'Flame Dragon Aspect', icon:'🔥', aspect:'flame'},
  aspect_frost: {name:'Frost Dragon Aspect', icon:'❄️', aspect:'frost'},
  aspect_wraith:{name:'Wraith Dragon Aspect', icon:'🐲', aspect:'wraith'},
  runed_chain:  {name:'Runed Chain-Glaive', icon:'⛓️', slot:'weapon', lvl:60, power:32, value:3000},
};
const weaponClass = id => ITEMS[id].class || 'melee';

/* Dragon aspect palettes — unlocked from the Throne Guardians */
const ASPECTS = {
  ruby:  {label:'Ruby (natural)', wing:'#7a221a', body:'#a83226', eye:'#ffd66b'},
  gild:  {label:'Gilded',         wing:'#8a6a1a', body:'#c9a530', eye:'#fff2a0'},
  venom: {label:'Venom',          wing:'#3a2a4a', body:'#5a3a7a', eye:'#8cf03c'},
  flame: {label:'Flame',          wing:'#8a1a08', body:'#d84b1f', eye:'#ffd66b'},
  frost: {label:'Frost',          wing:'#1a3a6a', body:'#3a6ab0', eye:'#aef0ff'},
  wraith:{label:'Wraith',         wing:'#12160c', body:'#232c1e', eye:'#8cf03c', runes:'#8cf03c', chains:'#9aa4a8'},
};

const SMITH_RECIPES = [
  {out:'bronze_bar', qty:1, lvl:1,  xp:8,  cost:{copper_ore:1},                sub:'Smelt 1 copper ore'},
  {out:'iron_bar',   qty:1, lvl:15, xp:15, cost:{iron_ore:1},                  sub:'Smelt 1 iron ore'},
  {out:'steel_bar',  qty:1, lvl:25, xp:22, cost:{iron_ore:2},                  sub:'Smelt 2 iron ore'},
  {out:'obsidian_bar',qty:1,lvl:35, xp:38, cost:{dragonglass:2},               sub:'Fuse 2 dragonglass'},
  {out:'valyrian_bar',qty:1,lvl:55, xp:65, cost:{valyrian_ore:1,dragonglass:1},sub:'The old way: ore + dragonglass'},
  {out:'arrows',     qty:15,lvl:5,  xp:12, cost:{bronze_bar:1},                sub:'15 arrows from 1 bronze bar'},
  {out:'bronze_sword',qty:1,lvl:4,  xp:25, cost:{bronze_bar:2},                sub:'2 bronze bars'},
  {out:'bronze_armor',qty:1,lvl:8,  xp:38, cost:{bronze_bar:3},                sub:'3 bronze bars'},
  {out:'iron_sword', qty:1, lvl:18, xp:50, cost:{iron_bar:2},                  sub:'2 iron bars'},
  {out:'iron_armor', qty:1, lvl:22, xp:75, cost:{iron_bar:3},                  sub:'3 iron bars'},
  {out:'steel_sword',qty:1, lvl:28, xp:75, cost:{steel_bar:2},                 sub:'2 steel bars'},
  {out:'steel_armor',qty:1, lvl:32, xp:112,cost:{steel_bar:3},                 sub:'3 steel bars'},
  {out:'obsidian_sword',qty:1,lvl:40,xp:120,cost:{obsidian_bar:2},             sub:'2 obsidian bars'},
  {out:'obsidian_armor',qty:1,lvl:44,xp:180,cost:{obsidian_bar:3},             sub:'3 obsidian bars'},
  {out:'valyrian_sword',qty:1,lvl:60,xp:250,cost:{valyrian_bar:2},             sub:'2 Valyrian steel bars'},
  {out:'valyrian_armor',qty:1,lvl:64,xp:375,cost:{valyrian_bar:3},             sub:'3 Valyrian steel bars'},
];

const COOK_RECIPES = {
  raw_trout:     {out:'trout',     lvl:1,  xp:30,  stopBurn:18},
  raw_salmon:    {out:'salmon',    lvl:15, xp:90,  stopBurn:40},
  raw_blackfish: {out:'blackfish', lvl:40, xp:160, stopBurn:70},
};

/* ---------------- Resource node definitions ---------------- */
const NODE_DEFS = {
  pine:       {name:'Sentinel Pine', verb:'Chop', skill:'woodcutting', lvl:1,  xp:25,  item:'logs',          respawn:22},
  ironwood:   {name:'Ironwood Tree', verb:'Chop', skill:'woodcutting', lvl:20, xp:60,  item:'ironwood_logs', respawn:45},
  weirwood:   {name:'Weirwood Tree', verb:'Chop', skill:'woodcutting', lvl:45, xp:120, item:'weirwood_logs', respawn:80},
  copper:     {name:'Copper Rock', verb:'Mine', skill:'mining', lvl:1,  xp:17,  item:'copper_ore',  respawn:25},
  iron:       {name:'Iron Rock', verb:'Mine', skill:'mining', lvl:15, xp:35,  item:'iron_ore',    respawn:45},
  glassrock:  {name:'Dragonglass Vein', verb:'Mine', skill:'mining', lvl:30, xp:65,  item:'dragonglass', respawn:60},
  valrock:    {name:'Valyrian Vein', verb:'Mine', skill:'mining', lvl:55, xp:140, item:'valyrian_ore',respawn:120},
  fish_trout: {name:'River Fishing Spot', verb:'Fish', skill:'fishing', lvl:1,  xp:30,  item:'raw_trout',   respawn:0},
  fish_salmon:{name:'Salmon Run', verb:'Fish', skill:'fishing', lvl:20, xp:70,  item:'raw_salmon',  respawn:0},
  fish_black: {name:'Deepwater Spot', verb:'Fish', skill:'fishing', lvl:40, xp:120, item:'raw_blackfish',respawn:0},
  bank:       {name:'Bank Chest', verb:'Open'},
  anvil:      {name:'Forge & Anvil', verb:'Smith at'},
  range:      {name:'Cooking Fire', verb:'Cook at'},
  roost:      {name:'Dragon Roost', verb:'Approach'},
  throne:     {name:'The Ember Throne', verb:'Approach'},
  tower:      {name:'Ember Keep Tower', verb:'Inspect', hp:40},
  gate:       {name:'Frostwall Gate', verb:'Pass'},
  shop:       {name:'Store', verb:'Trade at'},
  ferry:      {name:'Ferry', verb:'Board'},
};

/* ---------------- Stores ---------------- */
const FERRY_FARE = 25;
const SHOPS = {
  wolfridge: {name:'Wolf Ridge General Store',
    greet:'"Welcome, welcome. Everything a smallfolk needs to make a start."',
    stock:['trout','arrows','bronze_sword','bronze_armor','shortbow','apprentice_staff']},
  capitol:   {name:'The Crown Armory',
    greet:'"Castle-forged steel, strung bows, charged staves — the Crown taxes it all, so buy plenty."',
    stock:['salmon','arrows','iron_sword','steel_sword','iron_armor','steel_armor','ironwood_bow','acolyte_staff']},
  dorne:     {name:'Sunspear Bazaar',
    greet:'"You crossed the Narrow Sea for the good wares, friend. Wise. Obsidian, weirwood, pyromancy — name it."',
    stock:['blackfish','arrows','obsidian_sword','obsidian_armor','weirwood_bow','pyromancer_staff']},
};

/* ---------------- Mob definitions ---------------- */
const MOB_DEFS = {
  bandit:    {name:'Kingsroad Bandit', lvl:5,  hp:18, atk:5,  def:4,  maxhit:2, aggro:false, color:'#8a6d3b',
              drops:[['coins',4,22,1],['bones',1,1,1],['arrows',4,12,0.5]]},
  direwolf:  {name:'Direwolf', lvl:10, hp:26, atk:10, def:8,  maxhit:3, aggro:false, color:'#8d949c',
              drops:[['bones',1,1,1],['raw_salmon',1,2,0.4]]},
  wight:     {name:'Wight', lvl:22, hp:42, atk:20, def:15, maxhit:5, aggro:true, color:'#a9c8d8',
              drops:[['bones',1,1,1],['dragonglass',1,2,0.35],['coins',10,40,0.6]]},
  sellsword: {name:'Sellsword', lvl:28, hp:55, atk:26, def:24, maxhit:6, aggro:false, color:'#9c3a34',
              drops:[['coins',20,80,1],['bones',1,1,1],['iron_ore',1,3,0.5],['steel_bar',1,1,0.15]]},
  drake:     {name:'Wild Drake', lvl:45, hp:90, atk:40, def:34, maxhit:9, aggro:true, color:'#b03326',
              drops:[['big_bones',1,1,1],['dragonglass',1,3,0.8],['valyrian_ore',1,1,0.2],['coins',40,150,0.8]]},
  /* Throne Guardians — elemental bosses of the four corners of the realm.
     Each wields (and drops) the max-tier item of its combat class:
     Gilded = archery, Venom = sorcery, Flame = melee, Frost = armor. */
  gilded_sentinel: {name:'The Gilded Sentinel', lvl:60, hp:150, atk:52, def:45, maxhit:11, aggro:true, boss:true,
              color:'#8a6a1a', glow:'#ffe95c',
              drops:[['aspect_gild',1,1,1],['sunforged_bow',1,1,0.3],['coins',150,400,1],['valyrian_ore',1,2,0.6],['arrows',30,60,0.8],['big_bones',1,1,1]]},
  venom_sentinel:  {name:'The Venom Sentinel', lvl:65, hp:170, atk:58, def:50, maxhit:12, aggro:true, boss:true,
              color:'#4a3060', glow:'#8cf03c',
              drops:[['aspect_venom',1,1,1],['serpent_staff',1,1,0.3],['coins',200,500,1],['valyrian_ore',1,2,0.6],['dragonglass',2,5,0.8],['big_bones',1,1,1]]},
  flame_sentinel:  {name:'The Flame Sentinel', lvl:70, hp:190, atk:64, def:56, maxhit:14, aggro:true, boss:true,
              color:'#8a2015', glow:'#ff7b2a',
              drops:[['aspect_flame',1,1,1],['flamebrand_katana',1,1,0.3],['coins',250,600,1],['valyrian_ore',1,3,0.7],['obsidian_bar',1,2,0.5],['big_bones',1,1,1]]},
  frost_sentinel:  {name:'The Frost Sentinel', lvl:75, hp:220, atk:70, def:62, maxhit:15, aggro:true, boss:true,
              color:'#26437a', glow:'#5ac8f0',
              drops:[['aspect_frost',1,1,1],['frostscale_armor',1,1,0.3],['coins',300,800,1],['valyrian_ore',2,4,0.8],['valyrian_bar',1,1,0.25],['big_bones',1,1,1]]},
  /* The final terror: chained on a drowned islet, reachable only on dragonback */
  chained_wraith:  {name:'The Chained Wraith', lvl:90, hp:300, atk:85, def:75, maxhit:18, aggro:true, boss:true,
              color:'#161c12', glow:'#aef05c',
              drops:[['aspect_wraith',1,1,1],['runed_chain',1,1,0.34],['coins',500,1500,1],['valyrian_bar',1,2,0.6],['big_bones',2,3,1]]},
};
const SENTINELS = ['gilded_sentinel', 'venom_sentinel', 'flame_sentinel', 'frost_sentinel'];
/* "the Bandit" but not "the The Chained Wraith" */
const mobTitle = d => d.name.startsWith('The ') ? d.name : 'the ' + d.name;

/* ---------------- Seeded RNG (world gen only) ---------------- */
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- World state ---------------- */
const map = new Uint8Array(W * H);
const nodes = {};            // "x,y" -> node object
let mobs = [];
let npcs = [];
let fakePlayers = [];
let particles = [];
let floaters = [];
let tickCount = 0;
let gameStarted = false;

const idx = (x, y) => y * W + x;
const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const tileAt = (x, y) => inB(x, y) ? map[idx(x, y)] : T.WATER;
const key = (x, y) => x + ',' + y;

function walkable(x, y) {
  if (!inB(x, y)) return false;
  if (BLOCKED.has(map[idx(x, y)])) return false;
  const n = nodes[key(x, y)];
  if (n && n.kind !== 'gate') return false;
  return true;
}

/* ---------------- World generation ---------------- */
/* Centerline of the Sunspit Strait — the narrow sea that cuts Dorne's
   deserts off from the mainland. Shared with regionName(). */
const chanY = x => 129 + Math.round(2 * Math.sin(x / 9));

function genWorld() {
  const rng = mulberry32(777001);
  const R = (a, b) => a + Math.floor(rng() * (b - a + 1));

  // Base terrain: snow in the north, grass elsewhere
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      map[idx(x, y)] = (y < 32 + Math.floor(3 * Math.sin(x / 9))) ? T.SNOW : T.GRASS;

  // Eastern sea
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (x >= 110 + Math.floor(3 * Math.sin(y / 7))) map[idx(x, y)] = T.WATER;

  // Western mountain spine
  for (let i = 0; i < 60; i++) {
    const cx = R(3, 14), cy = R(10, 130), r = R(2, 4);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
      if (inB(x, y) && (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r) map[idx(x, y)] = T.MTN;
  }

  // The river: north to south, west of the sea (it drains into the strait)
  let rx = 78;
  for (let y = 0; y < 124; y++) {
    rx += R(-1, 1); rx = Math.max(56, Math.min(100, rx));
    for (let dx = -1; dx <= 1; dx++) if (inB(rx + dx, y)) map[idx(rx + dx, y)] = T.WATER;
    if (y === 52 || y === 96) // bridges
      for (let dx = -2; dx <= 2; dx++) if (inB(rx + dx, y)) map[idx(rx + dx, y)] = T.STONE;
  }

  // A lake in the west
  for (let y = 62; y <= 74; y++) for (let x = 24; x <= 38; x++)
    if ((x-31)*(x-31)/49 + (y-68)*(y-68)/36 <= 1) map[idx(x, y)] = T.WATER;

  // The Sunspit Strait: a narrow sea severing the southern deserts of Dorne
  // from the mainland. No bridge crosses it — take the ferry, or fly.
  for (let x = 0; x <= 112; x++) {
    const cy = chanY(x);
    for (let y = cy - 2; y <= cy + 2; y++) if (inB(x, y)) map[idx(x, y)] = T.WATER;
    for (let y = cy + 3; y < H; y++) {
      const t = map[idx(x, y)];
      if (t !== T.WATER && t !== T.MTN) map[idx(x, y)] = T.SAND; // the Dornish wastes
    }
  }

  // Dragonmont: volcanic island in the sea
  for (let y = 38; y <= 76; y++) for (let x = 112; x <= 142; x++) {
    const d = (x-127)*(x-127)/196 + (y-57)*(y-57)/324;
    if (d <= 1) map[idx(x, y)] = d > 0.82 ? T.SAND : T.VOLC;
  }
  for (const [cx, cy] of [[124,46],[131,50],[126,55]])
    for (let y = cy-2; y <= cy+2; y++) for (let x = cx-2; x <= cx+2; x++)
      if (inB(x,y) && (x-cx)*(x-cx)+(y-cy)*(y-cy) <= 3 && map[idx(x,y)] === T.VOLC) map[idx(x,y)] = T.LAVA;

  // The Frostwall: great ice wall at y=20 with one gate
  for (let x = 2; x < 110; x++) if (map[idx(x,20)] !== T.WATER) map[idx(x, 20)] = T.WALL;
  map[idx(70, 20)] = T.FLOOR; map[idx(71, 20)] = T.FLOOR;
  nodes[key(70, 20)] = {kind:'gate', x:70, y:20};

  // Roads: Wolf Ridge -> Capitol
  for (let y = 42; y <= 94; y++) { map[idx(40, y)] = T.STONE; map[idx(41, y)] = T.STONE; }
  for (let x = 41; x <= 56; x++) { map[idx(x, 94)] = T.STONE; }

  // --- Towns ---
  function town(x0, y0, x1, y1, gates) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map[idx(x, y)] = T.FLOOR;
    for (let x = x0; x <= x1; x++) { map[idx(x, y0)] = T.WALL; map[idx(x, y1)] = T.WALL; }
    for (let y = y0; y <= y1; y++) { map[idx(x0, y)] = T.WALL; map[idx(x1, y)] = T.WALL; }
    for (const [gx, gy] of gates) map[idx(gx, gy)] = T.FLOOR;
  }
  // Wolf Ridge (northern home town)
  town(33, 29, 47, 41, [[40, 41], [41, 41], [33, 35]]);
  addNode(36, 32, 'bank'); addNode(43, 32, 'anvil'); addNode(39, 36, 'range');
  addNode(43, 36, 'shop').shop = 'wolfridge';
  // The Capitol (southern city)
  town(47, 87, 67, 105, [[56, 87], [57, 87], [47, 96], [54, 105]]); // south gate opens to the ferry road
  addNode(51, 91, 'bank'); addNode(62, 91, 'anvil'); addNode(55, 95, 'range');
  addNode(57, 102, 'throne');
  addNode(62, 95, 'shop').shop = 'capitol';
  // Sunspear (walled desert town of Dorne, across the Sunspit Strait)
  town(46, 134, 60, 142, [[54, 134]]);
  addNode(49, 137, 'bank'); addNode(53, 138, 'range');
  addNode(57, 137, 'shop').shop = 'dorne';
  // Ferry across the strait, with roads to either landing
  const fN = {x:54, y:chanY(54) - 3}, fS = {x:54, y:chanY(54) + 3};
  map[idx(fN.x, fN.y)] = T.STONE; map[idx(fS.x, fS.y)] = T.STONE;
  addNode(fN.x, fN.y, 'ferry').dest = fS;
  addNode(fS.x, fS.y, 'ferry').dest = fN;
  for (let y = 106; y < fN.y; y++) map[idx(54, y)] = T.STONE;   // Capitol -> north landing
  for (let y = fS.y + 1; y < 134; y++) map[idx(54, y)] = T.STONE; // south landing -> Sunspear
  // Dragon roost on Dragonmont
  addNode(127, 47, 'roost');
  // Ember Keep towers (southern half of Dragonmont)
  for (const [tx, ty] of [[120,62],[134,62],[120,69],[134,69],[127,72]]) {
    if (map[idx(tx,ty)] === T.WATER || map[idx(tx,ty)] === T.LAVA) map[idx(tx,ty)] = T.VOLC;
    addNode(tx, ty, 'tower');
  }

  // --- Resource nodes ---
  function scatter(kind, count, ok) {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 4000) {
      const x = R(2, W - 3), y = R(2, H - 3);
      if (nodes[key(x, y)] || BLOCKED.has(map[idx(x, y)])) continue;
      if (!ok(x, y, map[idx(x, y)])) continue;
      addNode(x, y, kind); placed++;
    }
  }
  scatter('pine', 90, (x, y, t) => t === T.GRASS && y > 34);
  scatter('ironwood', 30, (x, y, t) => t === T.SNOW && y > 21);
  scatter('weirwood', 12, (x, y, t) => t === T.SNOW && y < 20);
  scatter('copper', 26, (x, y, t) => t === T.GRASS && y > 40 && y < 100);
  scatter('iron', 20, (x, y, t) => (t === T.SNOW && y > 21) || (t === T.GRASS && x < 26));
  scatter('glassrock', 14, (x, y, t) => t === T.VOLC);
  scatter('valrock', 6, (x, y, t) => t === T.VOLC);
  // the Dornish wastes hide obsidian and Valyrian veins under the sand
  scatter('glassrock', 8, (x, y, t) => t === T.SAND && y > chanY(x) + 3);
  scatter('valrock', 3, (x, y, t) => t === T.SAND && y > chanY(x) + 3);

  // Fishing spots: on water adjacent to land
  function fishSpots(kind, count, ok) {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 6000) {
      const x = R(2, W - 3), y = R(2, H - 3);
      if (map[idx(x, y)] !== T.WATER || nodes[key(x, y)]) continue;
      let land = false;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]])
        if (!BLOCKED.has(tileAt(x + dx, y + dy))) land = true;
      if (!land || !ok(x, y)) continue;
      addNode(x, y, kind); placed++;
    }
  }
  fishSpots('fish_trout', 14, (x, y) => x < 105 && y > 34);
  fishSpots('fish_salmon', 8, (x, y) => x < 105 && y <= 60);
  fishSpots('fish_black', 6, (x, y) => x >= 105 || (x >= 24 && x <= 38 && y >= 62) || y >= 122);

  // --- NPCs ---
  npcs = [
    {id:'maera',  name:'Lady Maera Wolfhart', x:40, y:31, color:'#c8ccd8'},
    {id:'pyros',  name:'Grand Maester Pyros', x:53, y:99, color:'#c9a558'},
    {id:'rhaella',name:'Dragonkeeper Rhaella', x:125, y:48, color:'#c46a5a'},
  ];

  // --- Mob spawns ---
  mobs = [];
  function spawn(type, count, x0, y0, x1, y1) {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 3000) {
      const x = R(x0, x1), y = R(y0, y1);
      if (!walkable(x, y)) continue;
      mobs.push(makeMob(type, x, y)); placed++;
    }
  }
  spawn('bandit', 9, 30, 44, 100, 86);
  spawn('direwolf', 8, 8, 22, 100, 40);
  spawn('wight', 9, 6, 3, 100, 18);
  spawn('sellsword', 7, 30, 106, 100, 122);
  spawn('sellsword', 6, 6, 133, 100, 142); // Dornish sellswords roam the wastes
  spawn('drake', 7, 114, 40, 140, 74);

  // Throne Guardians: one per corner of the realm (nudged to nearest open ground)
  function placeBoss(type, x, y) {
    for (let r = 0; r < 8; r++)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
        if (walkable(x + dx, y + dy)) { mobs.push(makeMob(type, x + dx, y + dy)); return; }
  }
  placeBoss('gilded_sentinel', 20, 108);  // the Gilded Barrow, southwest
  placeBoss('venom_sentinel', 40, 124);   // the Rotwood, deep south
  placeBoss('flame_sentinel', 127, 65);   // heart of the Ember Keep
  placeBoss('frost_sentinel', 70, 7);     // the Frozen Throne, beyond the Frostwall

  // The Drowned Bastion: a ruined islet deep in the southern sea.
  // No bridge leads here — only a dragon's wings.
  for (let y = 114; y <= 126; y++) for (let x = 118; x <= 130; x++) {
    const d = (x-124)*(x-124) + (y-120)*(y-120);
    if (d <= 25) map[idx(x, y)] = d <= 9 ? T.FLOOR : T.SAND;
  }
  for (const [wx, wy] of [[121,117],[127,117],[121,123],[127,123]])
    map[idx(wx, wy)] = T.WALL; // broken corner towers of the sunken keep
  placeBoss('chained_wraith', 124, 120);
  // the islet carve may have beached earlier-placed fishing spots — remove any now on land
  for (const k in nodes) {
    const n = nodes[k];
    if (n.kind.startsWith('fish_') && map[idx(n.x, n.y)] !== T.WATER) delete nodes[k];
  }

  // --- Simulated fellow players (MMO ambience) ---
  const fpNames = [
    ['Snowbastard92', '#7fd48f'], ['Khaleesi_Kate', '#8fc8e8'], ['HodorTheDoor', '#d8b06a'],
    ['ImpOfTheWest', '#c88fd4'], ['NoOneGirl', '#9ad4c0'], ['BuilderBran', '#d49a8f'],
  ];
  fakePlayers = fpNames.map(([nm, c], i) => ({
    name: nm, color: c,
    x: i < 3 ? 38 + i * 2 : 52 + i, y: i < 3 ? 34 : 92,
    hx: i < 3 ? 40 : 56, hy: i < 3 ? 35 : 95,
    px: 0, py: 0, chatCd: 60 + i * 55,
  }));
  fakePlayers.forEach(f => { f.px = f.x; f.py = f.y; });
}

function addNode(x, y, kind) {
  const def = NODE_DEFS[kind];
  const n = {kind, x, y, dead:false, respawnAt:0};
  if (def.hp) n.hp = def.hp;
  nodes[key(x, y)] = n;
  return n;
}

function makeMob(type, x, y) {
  const d = MOB_DEFS[type];
  return {type, x, y, px:x, py:y, hp:d.hp, maxhp:d.hp, homeX:x, homeY:y,
          dead:false, respawnAt:0, target:null, atkCd:0, wanderCd:0, hurtAt:-99};
}

/* ---------------- Player ---------------- */
const player = {
  x:40, y:43, px:40, py:43,
  skills:{}, hp:10,
  inv:[], bank:[],
  equip:{weapon:null, armor:null},
  style:'melee',
  path:[], goal:null,
  combat:null, atkCd:0, gatherCd:0, cookCd:0, breathCd:0,
  mounted:false, dragonTamed:false,
  flightXpAcc:0, regenCd:0,
  quests:{q1:0, q2:0, q3:0, q4:0, q5:0, q3burned:0, throne:false, slain:{}},
  dragonAspect:'ruby',
  dead:false,
};

function initSkills() {
  for (const s of SKILLS) player.skills[s.id] = 0;
  player.skills.hitpoints = XP_TABLE[10];   // Hitpoints starts at level 10
  player.hp = 10;
}
const lvlOf = id => toLevel(player.skills[id]);
const maxHp = () => lvlOf('hitpoints');
function combatLevel() {
  const base = 0.25 * (lvlOf('defence') + lvlOf('hitpoints') + Math.floor(lvlOf('faith') / 2));
  const off = 0.325 * Math.max(lvlOf('attack') + lvlOf('strength'), 1.5 * lvlOf('archery'), 1.5 * lvlOf('sorcery'));
  return Math.max(3, Math.floor(base + off));
}

function addXp(id, amt) {
  amt = Math.round(amt * 10) / 10;
  if (amt <= 0) return;
  const before = lvlOf(id);
  player.skills[id] = Math.min(200000000, player.skills[id] + amt);
  const after = lvlOf(id);
  xpDrop(SKILLS.find(s => s.id === id).icon + ' +' + amt);
  if (after > before) {
    log(`<span class="lvl">✦ Congratulations! Your ${SKILLS.find(s=>s.id===id).name} level is now ${after}.</span>`);
    floaters.push({x:player.x, y:player.y - 1, text:'Level up! ' + after, color:'#7fd47f', life:2.4});
    burst(player.x, player.y, '#f4e3a1', 14);
    if (id === 'hitpoints') player.hp++;
    if (after === 99) log(`<span class="lvl">🏆 You have MASTERED ${SKILLS.find(s=>s.id===id).name}! The realm sings of your deeds.</span>`);
  }
  renderSkills();
}

/* ---------------- Inventory / bank ---------------- */
const INV_MAX = 28;
function invCount(id) {
  return player.inv.reduce((a, s) => a + (s.id === id ? s.qty : 0), 0);
}
function addItem(id, qty = 1, silent = false) {
  const def = ITEMS[id];
  if (def.stack) {
    const s = player.inv.find(s => s.id === id);
    if (s) { s.qty += qty; renderInv(); return true; }
  }
  for (let i = 0; i < qty; i++) {
    if (player.inv.length >= INV_MAX) { if (!silent) log('<span class="bad">Your pack is full.</span>'); renderInv(); return false; }
    player.inv.push({id, qty: def.stack ? qty : 1});
    if (def.stack) break;
  }
  renderInv(); return true;
}
function removeItem(id, qty = 1) {
  let need = qty;
  for (let i = player.inv.length - 1; i >= 0 && need > 0; i--) {
    const s = player.inv[i];
    if (s.id !== id) continue;
    const take = Math.min(s.qty, need);
    s.qty -= take; need -= take;
    if (s.qty <= 0) player.inv.splice(i, 1);
  }
  renderInv(); return need === 0;
}
function bankAdd(id, qty) {
  const s = player.bank.find(s => s.id === id);
  if (s) s.qty += qty; else player.bank.push({id, qty});
}

/* ---------------- Logging & fx ---------------- */
const logEl = document.getElementById('logbar');
function log(html, cls) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.innerHTML = html;
  logEl.appendChild(d);
  while (logEl.children.length > 120) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}
const xpDropsEl = document.getElementById('xpDrops');
function xpDrop(text) {
  const d = document.createElement('div');
  d.className = 'xpdrop'; d.textContent = text;
  xpDropsEl.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * 1.6;
    particles.push({x:x + 0.5, y:y + 0.5, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp - 0.6,
                    life:0.5 + Math.random() * 0.7, color, size:2 + Math.random() * 3});
  }
}
function fireLine(x0, y0, x1, y1) {
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    particles.push({x:x0 + 0.5 + (x1 - x0) * t + (Math.random()-0.5)*0.5,
                    y:y0 + 0.5 + (y1 - y0) * t + (Math.random()-0.5)*0.5,
                    vx:(Math.random()-0.5)*0.8, vy:-0.4 - Math.random()*0.8,
                    life:0.35 + Math.random()*0.5,
                    color:['#ff9d3c','#ff5e2a','#ffd66b'][Math.floor(Math.random()*3)],
                    size:3 + Math.random()*4});
  }
}

/* ---------------- Pathfinding ---------------- */
function findPath(sx, sy, tx, ty) {
  if (player.mounted) { // dragons fly straight
    const path = [];
    let x = sx, y = sy, guard = 0;
    tx = Math.max(0, Math.min(W - 1, tx)); ty = Math.max(0, Math.min(H - 1, ty));
    while ((x !== tx || y !== ty) && guard++ < 400) {
      x += Math.sign(tx - x); y += Math.sign(ty - y);
      path.push({x, y});
    }
    return path;
  }
  const prev = new Map(), q = [[sx, sy]];
  prev.set(key(sx, sy), null);
  let best = null, bestD = Infinity, seen = 0;
  while (q.length && seen < 7000) {
    const [x, y] = q.shift(); seen++;
    const d = Math.abs(x - tx) + Math.abs(y - ty);
    if (d < bestD) { bestD = d; best = [x, y]; }
    if (x === tx && y === ty) break;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k) || !walkable(nx, ny)) continue;
      if (dx && dy && (!walkable(x + dx, y) || !walkable(x, y + dy))) continue; // no corner cutting
      prev.set(k, [x, y]); q.push([nx, ny]);
    }
  }
  if (!best) return [];
  const path = [];
  let cur = best;
  while (cur && !(cur[0] === sx && cur[1] === sy)) {
    path.unshift({x:cur[0], y:cur[1]});
    cur = prev.get(key(cur[0], cur[1]));
  }
  return path;
}
const dist = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/* ---------------- Goals & interaction ---------------- */
function setGoal(goal, tx, ty) {
  player.goal = goal;
  player.combat = null;
  player.path = findPath(player.x, player.y, tx, ty);
}
function walkTo(x, y) { setGoal({type:'walk', x, y}, x, y); }

function clickWorld(tx, ty) {
  if (!gameStarted || player.dead) return;
  // Mob?
  const mob = mobs.find(m => !m.dead && dist(m.x, m.y, tx, ty) === 0);
  if (mob) {
    setGoal({type:'mob', mob}, mob.x, mob.y);
    log(`<span class="sys">You move to attack ${mobTitle(MOB_DEFS[mob.type])}...</span>`);
    return;
  }
  // NPC?
  const npc = npcs.find(n => n.x === tx && n.y === ty);
  if (npc) { setGoal({type:'npc', npc}, npc.x, npc.y); return; }
  // Fake player?
  const fp = fakePlayers.find(f => f.x === tx && f.y === ty);
  if (fp) { log(`<span class="sys">${fp.name} is busy skilling. They wave at you.</span>`); return; }
  // Node?
  const node = nodes[key(tx, ty)];
  if (node && node.kind !== 'gate') { setGoal({type:'node', node}, tx, ty); return; }
  walkTo(tx, ty);
}

/* ---------------- Combat ---------------- */
/* Weapon power counts only toward its own class — a bow does nothing for a
   melee swing. Unarmed melee is fists (1); archery/sorcery fall back to
   thrown stones / raw cantrips (2) until a bow or staff is equipped. */
function classPower(cls) {
  const w = player.equip.weapon;
  if (w && weaponClass(w) === cls) return ITEMS[w].power;
  return cls === 'melee' ? 1 : 2;
}
function armorValue()  { return player.equip.armor ? ITEMS[player.equip.armor].armor : 0; }

function styleReach() { return player.style === 'melee' ? 1 : player.style === 'archery' ? 6 : 7; }
function playerMaxHit() {
  if (player.style === 'melee')   return Math.max(1, Math.floor(1 + lvlOf('strength') * 0.12 + classPower('melee') * 0.6));
  if (player.style === 'archery') return Math.max(1, Math.floor(1 + lvlOf('archery') * 0.12 + classPower('archery') * 0.6));
  return Math.max(1, Math.floor(1 + lvlOf('sorcery') * 0.11 + classPower('sorcery') * 0.6));
}
function playerAccStat() {
  if (player.style === 'melee')   return lvlOf('attack') + classPower('melee');
  if (player.style === 'archery') return lvlOf('archery') + classPower('archery');
  return lvlOf('sorcery') + classPower('sorcery');
}

function playerAttack(mob) {
  const d = MOB_DEFS[mob.type];
  if (player.style === 'archery' && invCount('arrows') < 1) {
    log('<span class="bad">You have no arrows! Smith some at an anvil, or switch style.</span>');
    player.goal = null; player.combat = null; return;
  }
  if (player.style === 'archery') removeItem('arrows', 1);
  const a = playerAccStat(), def = d.def;
  const chance = Math.max(0.15, Math.min(0.95, a / (a + def)));
  let dmg = 0;
  if (Math.random() < chance) dmg = 1 + Math.floor(Math.random() * playerMaxHit());
  dmg = Math.min(dmg, mob.hp);
  mob.hp -= dmg; mob.hurtAt = tickCount;
  mob.target = 'player';
  floaters.push({x:mob.x, y:mob.y, text:String(dmg), color:dmg ? '#ff5e4a' : '#7a8bc8', life:1.1});
  if (dmg > 0) {
    if (player.style === 'melee') { addXp('attack', dmg * 2); addXp('strength', dmg * 2); }
    else if (player.style === 'archery') addXp('archery', dmg * 4);
    else addXp('sorcery', dmg * 4);
    addXp('defence', dmg * 1);
    addXp('hitpoints', dmg * 1.33);
  }
  if (player.style !== 'melee') {
    particles.push({x:player.x+0.5, y:player.y+0.5,
      vx:(mob.x-player.x)*1.8, vy:(mob.y-player.y)*1.8, life:0.4,
      color:player.style==='archery' ? '#d8cba0' : '#8f6ee8', size:4});
  }
  if (mob.hp <= 0) killMob(mob);
}

function killMob(mob) {
  const d = MOB_DEFS[mob.type];
  mob.dead = true; mob.respawnAt = tickCount + (d.boss ? 300 : 25);
  mob.target = null;
  burst(mob.x, mob.y, d.boss ? d.glow : d.color, d.boss ? 34 : 10);
  if (d.boss) {
    log(`<span class="lvl">⭐ You have felled ${d.name}! Its power seeps into the earth...</span>`);
    player.quests.slain[mob.type] = 1;
    if (mob.type === 'chained_wraith' && !player.quests.q5) {
      player.quests.q5 = 1;
      log('<span class="lvl">❗ Quest complete: The Chained Wraith! Its chains crumble to rust. Nothing in the realm can stand against you now.</span>');
    }
    if (SENTINELS.filter(k => player.quests.slain[k]).length >= 4 && !player.quests.q4) {
      player.quests.q4 = 1;
      addItem('coins', 2500, true);
      addXp('dragonriding', 1500);
      log('<span class="lvl">❗ Quest complete: Thrones of the Elements! All four Throne Guardians lie broken. (2500 gold, 1500 Dragonriding XP)</span>');
    }
    renderQuests();
  } else {
    log(`<span class="good">You have defeated ${mobTitle(d)}.</span>`);
  }
  for (const [item, lo, hi, prob] of d.drops)
    if (Math.random() < prob) addItem(item, lo + Math.floor(Math.random() * (hi - lo + 1)), true);
  if (player.combat && player.combat.mob === mob) { player.combat = null; player.goal = null; }
}

function mobAttack(mob) {
  const d = MOB_DEFS[mob.type];
  const a = d.atk, def = lvlOf('defence') + armorValue();
  const chance = Math.max(0.1, Math.min(0.9, a / (a + def)));
  let dmg = 0;
  if (Math.random() < chance) dmg = 1 + Math.floor(Math.random() * d.maxhit);
  hurtPlayer(dmg, d.name);
}
function hurtPlayer(dmg, source) {
  dmg = Math.min(dmg, player.hp);
  player.hp -= dmg;
  floaters.push({x:player.x, y:player.y, text:String(dmg), color:dmg ? '#ff5e4a' : '#7a8bc8', life:1.1});
  renderHud();
  if (player.hp <= 0) diePlayer(source);
}
function diePlayer(source) {
  player.dead = true;
  log(`<span class="bad">☠ You have been slain by ${source}! You awaken in the Capitol, tended by the silent sisters.</span>`);
  setTimeout(() => {
    player.x = 57; player.y = 90; player.px = 57; player.py = 90;
    player.hp = maxHp(); player.dead = false; player.mounted = false;
    player.goal = null; player.path = []; player.combat = null;
    renderHud(); updateMountBtn();
  }, 1200);
}

/* ---------------- Dragonfire ---------------- */
function dragonBreath(target) { // target: mob or tower node
  const drl = lvlOf('dragonriding');
  const isTower = !!target.kind;
  const tx = target.x, ty = target.y;
  fireLine(player.x, player.y, tx, ty);
  burst(tx, ty, '#ff7b2a', 12);
  let dmg = 2 + Math.floor(Math.random() * (3 + drl * 0.3));
  if (isTower) {
    target.hp -= dmg;
    floaters.push({x:tx, y:ty, text:String(dmg), color:'#ffb14a', life:1.1});
    addXp('dragonriding', dmg * 2);
    if (target.hp <= 0) {
      target.dead = true; target.respawnAt = tickCount + 600;
      player.quests.q3burned = Math.min(5, player.quests.q3burned + 1);
      burst(tx, ty, '#ff5e2a', 30);
      addXp('dragonriding', 150);
      log(`<span class="good">🔥 The tower collapses in flame! (${player.quests.q3burned}/5 Ember Keep towers razed)</span>`);
      if (player.quests.q3burned >= 5 && !player.quests.q3)
        log('<span class="lvl">The Ember Keep burns! Return to Dragonkeeper Rhaella to claim your reward.</span>');
      renderQuests();
      player.goal = null;
    }
  } else {
    const d = MOB_DEFS[target.type];
    if (target.type === 'wight') dmg *= 2; // fire purges the dead
    dmg = Math.min(dmg, target.hp);
    target.hp -= dmg; target.hurtAt = tickCount; target.target = null;
    floaters.push({x:tx, y:ty, text:String(dmg), color:'#ffb14a', life:1.1});
    addXp('dragonriding', dmg * 3);
    addXp('hitpoints', dmg * 0.5);
    // splash damage to adjacent mobs
    for (const m of mobs) {
      if (m === target || m.dead || dist(m.x, m.y, tx, ty) > 1) continue;
      const s = Math.min(m.hp, Math.ceil(dmg / 2));
      m.hp -= s; m.hurtAt = tickCount;
      floaters.push({x:m.x, y:m.y, text:String(s), color:'#ffb14a', life:1.1});
      if (m.hp <= 0) killMob(m);
    }
    if (target.hp <= 0) killMob(target);
    else void 0;
    if (d) void d;
  }
}

/* ---------------- Node interactions ---------------- */
function performNodeAction(node) {
  const def = NODE_DEFS[node.kind];
  if (player.mounted && node.kind !== 'tower') {
    log('<span class="sys">You cannot do that from dragonback. Dismount first (M).</span>');
    player.goal = null; return;
  }
  switch (node.kind) {
    case 'bank':   openBank(); player.goal = null; break;
    case 'anvil':  openSmith(); player.goal = null; break;
    case 'shop':   openShop(node.shop); player.goal = null; break;
    case 'ferry':  rideFerry(node); player.goal = null; break;
    case 'range':  startCooking(); break;
    case 'roost':  openRoost(); player.goal = null; break;
    case 'throne': sitThrone(); player.goal = null; break;
    case 'tower':
      log('<span class="sys">Sorcerous wards shimmer across the stone. Only dragonfire can bring it down.</span>');
      player.goal = null; break;
    default: gatherTick(node); break;
  }
}

function gatherTick(node) {
  const def = NODE_DEFS[node.kind];
  if (node.dead) { player.goal = null; return; }
  const lvl = lvlOf(def.skill);
  if (lvl < def.lvl) {
    log(`<span class="bad">You need ${SKILLS.find(s=>s.id===def.skill).name} level ${def.lvl} for the ${def.name}.</span>`);
    player.goal = null; return;
  }
  if (player.gatherCd > 0) return;
  player.gatherCd = 3;
  const chance = Math.min(0.95, 0.45 + (lvl - def.lvl) * 0.012);
  if (Math.random() < chance) {
    if (!addItem(def.item)) { player.goal = null; return; }
    addXp(def.skill, def.xp);
    log(`<span class="sys">You get some ${ITEMS[def.item].name.toLowerCase()}.</span>`);
    if (def.respawn > 0 && Math.random() < 0.4) {
      node.dead = true; node.respawnAt = tickCount + def.respawn;
      player.goal = null;
    }
  }
}

function startCooking() {
  const raw = player.inv.find(s => COOK_RECIPES[s.id]);
  if (!raw) {
    log('<span class="sys">You have nothing raw to cook. Catch some fish first.</span>');
    player.goal = null; return;
  }
  const r = COOK_RECIPES[raw.id];
  const lvl = lvlOf('cooking');
  if (lvl < r.lvl) {
    log(`<span class="bad">You need Cooking level ${r.lvl} to cook ${ITEMS[raw.id].name.toLowerCase()}.</span>`);
    player.goal = null; return;
  }
  if (player.cookCd > 0) return;
  player.cookCd = 2;
  removeItem(raw.id, 1);
  const burnChance = lvl >= r.stopBurn ? 0.02 : Math.max(0.05, 0.4 - (lvl - r.lvl) * 0.02);
  if (Math.random() < burnChance) {
    log('<span class="bad">You accidentally burn the fish. The fire cackles.</span>');
  } else {
    addItem(r.out); addXp('cooking', r.xp);
    log(`<span class="sys">You cook a ${ITEMS[r.out].name.toLowerCase()}.</span>`);
  }
}

function sitThrone() {
  if (player.quests.q3) {
    if (!player.quests.throne) {
      player.quests.throne = true;
      burst(player.x, player.y, '#f4e3a1', 30);
      log('<span class="lvl">👑 You seat yourself upon the EMBER THRONE. Dragonlord, Warden of the Wolf Ridge — the realm is yours. (You can keep playing forever, Your Grace.)</span>');
      renderQuests();
    } else log('<span class="good">You lounge on your throne. Being monarch is exhausting.</span>');
  } else {
    log('<span class="sys">The Ember Throne\'s barbs glint coldly. The realm would never accept you... yet. (Complete all three quests.)</span>');
  }
}

/* ---------------- Quests & NPC dialogue ---------------- */
const QUESTS = [
  {id:'q1', name:'Winter Is Coming',
   desc:'Lady Maera of Wolf Ridge needs stores for winter: 10 pine logs and 5 cooked river trout.',
   progress:() => player.quests.q1 ? 'Complete' : `Logs ${Math.min(10,invCount('logs'))}/10 · Trout ${Math.min(5,invCount('trout'))}/5 — deliver to Lady Maera`},
  {id:'q2', name:'Blood of the Dragon',
   desc:'Dragonkeeper Rhaella on Dragonmont will bond you to a red drake — if you bring 5 smoked salmon to win its trust. (Requires: Winter Is Coming)',
   progress:() => player.quests.q2 ? 'Complete — your drake answers your call (M)' : `Smoked salmon ${Math.min(5,invCount('salmon'))}/5 — deliver to Rhaella`},
  {id:'q3', name:'Fire and Blood',
   desc:'Take wing and raze the five towers of the Ember Keep on southern Dragonmont with dragonfire. Beware their ballistae. (Requires: Blood of the Dragon)',
   progress:() => player.quests.q3 ? 'Complete — you are a true Dragonlord' : `Towers razed ${player.quests.q3burned}/5 — then return to Rhaella`},
  {id:'q4', name:'Thrones of the Elements',
   desc:'Four Throne Guardians haunt the corners of the realm — the Gilded Sentinel in the southwest barrows, the Venom Sentinel in the deep south, the Flame Sentinel in the Ember Keep, and the Frost Sentinel beyond the Frostwall. Each guards a Dragon Aspect that can recolor your drake, and wields the finest gear of its combat class — bow, staff, katana and armor.',
   progress:() => player.quests.q4 ? 'Complete — the elements kneel' : `Guardians felled ${SENTINELS.filter(k => player.quests.slain[k]).length}/4`},
  {id:'q5', name:'The Chained Wraith',
   desc:'A fifth terror is bound to the Drowned Bastion, a ruined islet deep in the southern sea where no bridge reaches — only a dragon\'s wings. Slay the level 90 Chained Wraith to claim the Wraith Dragon Aspect and, if fortune favors you, its Runed Chain-Glaive.',
   progress:() => player.quests.q5 ? 'Complete — the chains lie broken' : 'The Wraith still stirs on its islet'},
];

function talkTo(npc) {
  player.goal = null;
  if (npc.id === 'maera') {
    if (!player.quests.q1) {
      const have = invCount('logs') >= 10 && invCount('trout') >= 5;
      openModal(npc.name, `
        <p>"Winter is coming, stranger, and the Wolf Ridge granaries stand empty. Bring me
        <b>10 pine logs</b> and <b>5 cooked river trout</b> and you'll have the friendship of my house."</p>
        <p class="sub" style="color:var(--dim); margin-top:8px">Chop the pines south of town. Fish the river to the east, and cook your catch on the town fire.</p>
        ${have ? '<button class="mbtn" id="qbtn">Hand over the supplies</button>' : ''}`);
      if (have) document.getElementById('qbtn').onclick = () => {
        removeItem('logs', 10); removeItem('trout', 5);
        player.quests.q1 = 1;
        addItem('coins', 400); addXp('woodcutting', 500); addXp('cooking', 500);
        log('<span class="lvl">❗ Quest complete: Winter Is Coming! (400 gold, 500 Woodcutting XP, 500 Cooking XP)</span>');
        renderQuests(); closeModal();
      };
    } else {
      openModal(npc.name, '<p>"The North remembers your service. If you seek glory, sail your eyes east — Dragonkeeper Rhaella tends the roost on Dragonmont, across the eastern bridge... though only the worthy walk away with wings."</p>');
    }
  }
  if (npc.id === 'pyros') {
    player.hp = maxHp(); renderHud();
    openModal(npc.name, `
      <p>"Ah, a smallfolk with ambitions. The Ember Throne has sat empty since the last king burned.
      Prove yourself in the North, bond a dragon, break the Ember Keep — and the realm may yet kneel."</p>
      <p style="margin-top:8px">"There. I've tended your wounds — <b>your health is restored</b>. The Capitol bank and forge are at your disposal."</p>`);
  }
  if (npc.id === 'rhaella') {
    if (!player.quests.q1) {
      openModal(npc.name, '<p>"The drakes do not suffer strangers. Earn a name for yourself first — Lady Maera of Wolf Ridge has need of capable hands."</p>');
    } else if (!player.quests.q2) {
      const have = invCount('salmon') >= 5;
      openModal(npc.name, `
        <p>"So the North speaks well of you. See her? The red one, wings like sunset. She has thrown
        every rider who tried. Win her trust with <b>5 smoked salmon</b> — dragons are gluttons — and
        she may carry you."</p>
        ${have ? '<button class="mbtn" id="qbtn">Offer the salmon</button>' : '<p class="sub" style="color:var(--dim); margin-top:8px">Salmon runs swim in the northern rivers (Fishing 20). Smoke them over any fire (Cooking 15).</p>'}`);
      if (have) document.getElementById('qbtn').onclick = () => {
        removeItem('salmon', 5);
        player.quests.q2 = 1; player.dragonTamed = true;
        addXp('dragonriding', 500);
        log('<span class="lvl">❗ Quest complete: Blood of the Dragon! 🐉 The red drake bows her neck to you. Press M to mount, anywhere, any time.</span>');
        renderQuests(); updateMountBtn(); closeModal();
      };
    } else if (player.quests.q3burned >= 5 && !player.quests.q3) {
      openModal(npc.name, `
        <p>"The Ember Keep burns! You ride like the dragonlords of old. Take this — pulled from the
        rubble, forged in the old way. Wear the name well... <b>Dragonlord</b>."</p>
        <button class="mbtn" id="qbtn">Claim the Valyrian Steel Sword</button>`);
      document.getElementById('qbtn').onclick = () => {
        addItem('valyrian_sword', 1);
        player.quests.q3 = 1;
        addXp('dragonriding', 2000);
        log('<span class="lvl">❗ Quest complete: Fire and Blood! (Valyrian Steel Sword, 2000 Dragonriding XP). The Ember Throne awaits in the Capitol...</span>');
        renderQuests(); closeModal();
      };
    } else if (!player.quests.q3) {
      openModal(npc.name, '<p>"South of here stands the Ember Keep — five towers of the usurpers who slew the last dragonlords. <b>Burn all five with dragonfire</b>. Mind the ballistae; even dragons bleed. Fly low, strike fast, and feed her well between raids."</p>');
    } else {
      openModal(npc.name, '<p>"Dragonlord. The keep\'s towers rebuild themselves by foul sorcery every so often — burn them again whenever you wish. She enjoys it, honestly. Best Dragonriding training in the realm."</p>');
    }
  }
}

function openRoost() {
  if (player.dragonTamed) {
    openModal('Dragon Roost', '<p>Your red drake dozes in the warm ash, one eye cracked open. She will come whenever you whistle — press <b>M</b> anywhere to mount or dismount.</p>');
  } else {
    openModal('Dragon Roost', '<p>A wild red drake circles the roost, all fang and fury. Dragonkeeper Rhaella stands nearby — she knows how such beasts are won.</p>');
  }
}

/* ---------------- Ferry ---------------- */
function rideFerry(node) {
  if (invCount('coins') < FERRY_FARE) {
    log(`<span class="bad">The ferryman spits over the rail. "Fare's ${FERRY_FARE} gold. No coin, no crossing."</span>`);
    return;
  }
  removeItem('coins', FERRY_FARE);
  player.x = node.dest.x; player.y = node.dest.y;
  player.px = player.x; player.py = player.y;
  player.path = []; player.goal = null; player.combat = null;
  log(`<span class="good">⛵ You pay ${FERRY_FARE} gold and the ferry hauls you across the Narrow Sea. ${node.dest.y > node.y ? 'The heat of Dorne rolls over you like an open forge.' : 'The green of the mainland never looked so kind.'}</span>`);
  renderHud();
}

/* ---------------- Stores ---------------- */
const sellPrice = id => Math.max(1, Math.floor((ITEMS[id].value || 0) * 0.4));
let shopOpen = null;
function openShop(shopId) {
  shopOpen = shopId;
  renderShop();
}
function renderShop() {
  if (!shopOpen) return;
  const shop = SHOPS[shopOpen];
  const coins = invCount('coins');
  let html = `<p style="color:var(--dim); font-size:12px; margin-bottom:8px">${shop.greet}<br>You have <b style="color:var(--gold)">💰 ${fmtQty(coins)}</b>. Click wares to buy; click your pack to sell (40% value).</p>`;
  html += '<h3 class="pane">Wares</h3>';
  for (const id of shop.stock) {
    const def = ITEMS[id];
    const can = coins >= def.value;
    const stat = def.power ? ` · power ${def.power}` : def.armor ? ` · armor ${def.armor}` : def.heal ? ` · heals ${def.heal}` : '';
    html += `<div class="mrow ${can ? '' : 'off'}" data-buy="${id}">
      <span class="ico">${def.icon}</span>
      <span>${def.name}<div class="sub">${def.slot ? 'lvl ' + def.lvl + ' ' + (def.slot === 'armor' ? 'defence' : def.class || 'attack') : ''}${stat}</div></span>
      <span class="right">${def.value} gold</span></div>`;
  }
  html += '<h3 class="pane" style="margin-top:10px">Your pack</h3><div class="bankGrid" id="shopGridI">';
  player.inv.forEach((s, i) => {
    const def = ITEMS[s.id];
    const sellable = s.id !== 'coins' && def.value;
    html += `<div class="slot" data-i="${i}" title="${def.name}${sellable ? ' — sell for ' + sellPrice(s.id) + ' gold' : ' — the merchant has no interest'}">${def.icon}<span class="qty">${s.qty > 1 ? fmtQty(s.qty) : ''}</span></div>`;
  });
  html += '</div>';
  openModal('🪙 ' + shop.name, html, () => { shopOpen = null; });
  document.querySelectorAll('#modalBody .mrow[data-buy]').forEach(el => el.onclick = () => {
    const id = el.dataset.buy, def = ITEMS[id];
    if (invCount('coins') < def.value) { log('<span class="bad">You cannot afford that.</span>'); return; }
    const room = def.stack ? player.inv.some(x => x.id === id) || player.inv.length < INV_MAX : player.inv.length < INV_MAX;
    if (!room) { log('<span class="bad">Your pack is full.</span>'); return; }
    removeItem('coins', def.value);
    addItem(id, 1, true);
    log(`<span class="sys">You buy a ${def.name} for ${def.value} gold.</span>`);
    renderShop();
  });
  document.querySelectorAll('#shopGridI .slot').forEach(el => el.onclick = () => {
    const s = player.inv[+el.dataset.i];
    if (!s || s.id === 'coins' || !ITEMS[s.id].value) { log('<span class="sys">"I\'ve no use for that," the merchant shrugs.</span>'); return; }
    const price = sellPrice(s.id);
    removeItem(s.id, 1);
    addItem('coins', price, true);
    log(`<span class="sys">You sell a ${ITEMS[s.id].name} for ${price} gold.</span>`);
    renderShop();
  });
}

/* ---------------- Bank / Smith modals ---------------- */
let bankOpen = false;
function openBank() {
  bankOpen = true;
  renderBank();
}
function renderBank() {
  if (!bankOpen) return;
  let html = '<p style="color:var(--dim); font-size:12px; margin-bottom:8px">Click items to move them. The Iron Bank forgets nothing.</p>';
  html += '<h3 class="pane">Bank vault</h3><div class="bankGrid" id="bankGridB">';
  if (!player.bank.length) html += '<div style="grid-column:1/-1; color:var(--dim); font-size:12px">Empty. A Wolfhart always pays their deposits.</div>';
  player.bank.forEach((s, i) => {
    html += `<div class="slot" data-b="${i}" title="${ITEMS[s.id].name}">${ITEMS[s.id].icon}<span class="qty">${s.qty > 1 ? fmtQty(s.qty) : ''}</span></div>`;
  });
  html += '</div><h3 class="pane" style="margin-top:10px">Your pack</h3><div class="bankGrid" id="bankGridI">';
  player.inv.forEach((s, i) => {
    html += `<div class="slot" data-i="${i}" title="${ITEMS[s.id].name}">${ITEMS[s.id].icon}<span class="qty">${s.qty > 1 ? fmtQty(s.qty) : ''}</span></div>`;
  });
  html += '</div><button class="mbtn" id="depAll">Deposit all</button>';
  openModal('🏦 Bank of the Iron Coin', html, () => { bankOpen = false; });
  document.querySelectorAll('#bankGridB .slot').forEach(el => el.onclick = () => {
    const s = player.bank[+el.dataset.b];
    if (!s) return;
    const def = ITEMS[s.id];
    const room = def.stack ? player.inv.some(x=>x.id===s.id) || player.inv.length < INV_MAX : player.inv.length < INV_MAX;
    if (!room) { log('<span class="bad">Your pack is full.</span>'); return; }
    const take = def.stack ? s.qty : 1;
    addItem(s.id, take, true);
    s.qty -= take;
    if (s.qty <= 0) player.bank.splice(+el.dataset.b, 1);
    renderBank();
  });
  document.querySelectorAll('#bankGridI .slot').forEach(el => el.onclick = () => {
    const s = player.inv[+el.dataset.i];
    if (!s) return;
    bankAdd(s.id, s.qty);
    player.inv.splice(+el.dataset.i, 1);
    renderInv(); renderBank();
  });
  document.getElementById('depAll').onclick = () => {
    for (const s of player.inv) bankAdd(s.id, s.qty);
    player.inv = [];
    renderInv(); renderBank();
  };
}
function fmtQty(q) { return q >= 100000 ? Math.floor(q/1000) + 'k' : q; }

function openSmith() {
  const lvl = lvlOf('smithing');
  let html = `<p style="color:var(--dim); font-size:12px; margin-bottom:8px">Smithing level ${lvl}. The forge roars. Click to craft.</p>`;
  for (const r of SMITH_RECIPES) {
    const can = lvl >= r.lvl && Object.entries(r.cost).every(([id, q]) => invCount(id) >= q);
    const costTxt = Object.entries(r.cost).map(([id, q]) => `${q}× ${ITEMS[id].name}`).join(', ');
    html += `<div class="mrow ${can ? '' : 'off'}" data-r="${r.out}">
      <span class="ico">${ITEMS[r.out].icon}</span>
      <span>${r.qty > 1 ? r.qty + '× ' : ''}${ITEMS[r.out].name}<div class="sub">${costTxt}</div></span>
      <span class="right">lvl ${r.lvl} · ${r.xp}xp</span></div>`;
  }
  openModal('⚒️ Forge & Anvil', html);
  document.querySelectorAll('#modalBody .mrow').forEach(el => el.onclick = () => {
    const r = SMITH_RECIPES.find(x => x.out === el.dataset.r);
    if (lvlOf('smithing') < r.lvl) return;
    if (!Object.entries(r.cost).every(([id, q]) => invCount(id) >= q)) return;
    for (const [id, q] of Object.entries(r.cost)) removeItem(id, q);
    addItem(r.out, r.qty);
    addXp('smithing', r.xp);
    log(`<span class="sys">You hammer out ${r.qty > 1 ? r.qty + '× ' : ''}${ITEMS[r.out].name}.</span>`);
    openSmith(); // refresh
  });
}

/* ---------------- Modal helpers ---------------- */
const modalWrap = document.getElementById('modalWrap');
let modalOnClose = null;
function openModal(title, bodyHtml, onClose) {
  document.getElementById('modalTitleText').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  modalWrap.style.display = 'flex';
  modalOnClose = onClose || null;
}
function closeModal() {
  modalWrap.style.display = 'none';
  if (modalOnClose) { modalOnClose(); modalOnClose = null; }
}
document.getElementById('modalClose').onclick = closeModal;
modalWrap.addEventListener('click', e => { if (e.target === modalWrap) closeModal(); });

function openHelp() {
  openModal('❓ How to play Kandarin', `
    <img src="assets/dragon-rider-valley.webp" alt="A dragonrider over the realm">
    <p><b>Click</b> anywhere to walk. Click trees, rocks and fishing spots to gather; monsters to fight;
    people to talk. Everything grants XP — levels 1 to 99 per skill, with the classic exponential curve.</p>
    <p style="margin-top:8px"><b>Getting started:</b> take Lady Maera's quest in Wolf Ridge (the walled town where you begin).
    Chop pines, fish the river, cook at the town fire, mine copper and smith your first blade at the anvil.</p>
    <p style="margin-top:8px"><b>Dragonriding 🐉:</b> complete <i>Winter Is Coming</i>, then bring Dragonkeeper Rhaella
    (on Dragonmont, across the eastern sea — use the bridges and the sand spit) 5 smoked salmon. Once bonded,
    press <b>M</b> to mount anywhere. Flying is fast, crosses water and mountains, and earns Dragonriding XP.
    Click any monster from the air to roast it with <b>dragonfire</b> (bonus vs wights). Raze the Ember Keep's
    towers for the best XP in the game — but its ballistae shoot back.</p>
    <p style="margin-top:8px"><b>Combat classes</b> (Equipment tab): Melee trains Attack/Strength with swords; Archery needs
    arrows and a <b>bow</b>; Sorcery needs a <b>staff</b>. Each class has its own gear ladder to level 60 — a weapon only
    helps its own class. Eat cooked fish to heal. Bury bones for Faith. Death is gentle — you keep everything.</p>
    <p style="margin-top:8px"><b>Stores 🪙:</b> the Wolf Ridge General Store sells starter gear, the Capitol's Crown Armory
    stocks mid tiers, and the Sunspear Bazaar in Dorne carries the level 30–40 wares. Shops buy your goods at 40% value.</p>
    <p style="margin-top:8px"><b>Dorne & the Narrow Sea ⛵:</b> the deserts of Dorne lie across the Sunspit Strait, severed
    from the mainland. Board the ferry south of the Capitol (${FERRY_FARE} gold each way) or fly over on dragonback. The wastes
    hide dragonglass and Valyrian veins — and Dornish sellswords.</p>
    <p style="margin-top:8px"><b>Throne Guardians ⭐:</b> four elemental bosses haunt the corners of the realm —
    <b>Gilded</b> (southwest barrows, lvl 60), <b>Venom</b> (deep south, lvl 65), <b>Flame</b> (Ember Keep, lvl 70) and
    <b>Frost</b> (beyond the Frostwall, lvl 75). Each drops a <b>Dragon Aspect</b> — click it in your pack to
    recolor your drake in that Guardian's element — and each wields (and can drop) the <b>max-tier gear of its
    class</b>: the Gilded Sentinel's Sunforged Bow, the Venom Sentinel's Serpent Staff, the Flame Sentinel's
    Flamebrand Katana and the Frost Sentinel's Frostscale Armor. And sailors whisper of a fifth: <b>The Chained Wraith</b>
    (lvl 90), bound to the Drowned Bastion islet in the southern sea, where only a dragon can carry you.
    It guards the black-and-viridian <b>Wraith aspect</b> and a Runed Chain-Glaive, the finest weapon in the realm.</p>
    <p style="margin-top:8px"><b>Keys:</b> M mount/dismount · Esc close windows · ← → swing the camera around you ·
    ↑ ↓ or scroll wheel zoom in and out.</p>
    <p style="margin-top:8px"><b>Map 🗺️:</b> click the minimap to unroll a chart of the whole realm.</p>`);
}

function openSkillGuide(id) {
  const s = SKILLS.find(x => x.id === id);
  const lvl = lvlOf(id), xp = Math.floor(player.skills[id]);
  const next = lvl < 99 ? XP_TABLE[lvl + 1] - xp : 0;
  const guides = {
    attack:'Trains with melee combat. Higher Attack = more accurate blows. Melee tiers: bronze 1 · iron 10 · steel 20 · obsidian 30 · Valyrian steel 50 · Flamebrand Katana 60 (Flame Sentinel) · Runed Chain-Glaive 60 (Chained Wraith).',
    strength:'Trains with melee combat. Raises your max hit.',
    defence:'Trains from all combat. Reduces damage taken. Armor tiers: bronze 1 · iron 10 · steel 20 · obsidian 30 · Valyrian 50 · Frostscale 60 (Frost Sentinel).',
    hitpoints:'Your life force. Trains from all damage you deal. Eat cooked fish to heal.',
    archery:'Shoot from 6 tiles away. Consumes arrows — smith 15 per bronze bar (Smithing 5). Bow tiers: shortbow 1 · ironwood 20 · weirwood 40 · Sunforged Bow 60 (Gilded Sentinel). Buy bows from stores; without one you sling stones.',
    sorcery:'Hurl fire from 7 tiles with no ammunition. Staff tiers: apprentice 1 · acolyte 20 · pyromancer 40 · Serpent Staff 60 (Venom Sentinel). Buy staves from stores; without one your cantrips are feeble.',
    faith:'Bury bones (15xp) and drake bones (45xp). The Old Gods speed your natural healing as Faith rises.',
    woodcutting:'Sentinel pine lvl 1 · Ironwood (northern snows) lvl 20 · Weirwood (beyond the Frostwall) lvl 45.',
    mining:'Copper lvl 1 · Iron lvl 15 · Dragonglass (Dragonmont) lvl 30 · Valyrian ore lvl 55.',
    fishing:'River trout lvl 1 · Salmon runs (northern rivers) lvl 20 · Deepwater blackfish lvl 40.',
    smithing:'Smelt bars and forge weapons, armor and arrows at any anvil. Valyrian steel needs level 55+.',
    cooking:'Cook at any fire. Trout lvl 1 · Salmon lvl 15 · Blackfish lvl 40. Higher levels stop burning.',
    dragonriding:'The skill of dragonlords. Fly (M) for XP; dragonfire kills give triple XP; razing Ember Keep towers gives 150xp each.\n\nUnlocks — lvl 1: flight & dragonfire · lvl 20: swifter wings (speed +1) · lvl 40: swifter still · lvl 60: your drake\'s flame burns ever hotter · lvl 99: legend of the skies.',
  };
  openModal(`${s.icon} ${s.name} — level ${lvl}`, `
    <p style="white-space:pre-line">${guides[id]}</p>
    <p style="margin-top:10px; color:var(--dim); font-size:13px">XP: ${xp.toLocaleString()}${lvl < 99 ? ` · ${next.toLocaleString()} to level ${lvl + 1}` : ' · MASTERED'}</p>`);
}

/* ---------------- Game tick ---------------- */
function tick() {
  tickCount++;
  if (!gameStarted) return;

  // respawns
  for (const k in nodes) {
    const n = nodes[k];
    if (n.dead && tickCount >= n.respawnAt) {
      n.dead = false;
      if (NODE_DEFS[n.kind].hp) n.hp = NODE_DEFS[n.kind].hp;
    }
  }
  for (const m of mobs) {
    if (m.dead && tickCount >= m.respawnAt) {
      m.dead = false; m.hp = m.maxhp; m.x = m.homeX; m.y = m.homeY; m.px = m.x; m.py = m.y; m.target = null;
    }
  }

  if (player.dead) return;

  if (player.gatherCd > 0) player.gatherCd--;
  if (player.cookCd > 0) player.cookCd--;
  if (player.atkCd > 0) player.atkCd--;
  if (player.breathCd > 0) player.breathCd--;

  // movement
  const speed = player.mounted ? 3 + Math.min(3, Math.floor(lvlOf('dragonriding') / 20)) : 2;
  let moved = 0;
  while (player.path.length && moved < speed) {
    const next = player.path[0];
    if (!player.mounted && !walkable(next.x, next.y)) { player.path = []; break; }
    player.x = next.x; player.y = next.y;
    player.path.shift(); moved++;
  }
  if (player.mounted && moved > 0) {
    player.flightXpAcc += moved * 0.4;
    if (player.flightXpAcc >= 1) {
      const gain = Math.floor(player.flightXpAcc);
      player.flightXpAcc -= gain;
      addXp('dragonriding', gain);
    }
  }

  // goal handling
  const g = player.goal;
  if (g) {
    if (g.type === 'mob') {
      const mob = g.mob;
      if (mob.dead) { player.goal = null; }
      else if (player.mounted) {
        if (dist(player.x, player.y, mob.x, mob.y) <= 5) {
          player.path = [];
          if (player.breathCd <= 0) { player.breathCd = 2; dragonBreath(mob); }
        } else if (!player.path.length) player.path = findPath(player.x, player.y, mob.x, mob.y);
      } else {
        const reach = styleReach();
        if (dist(player.x, player.y, mob.x, mob.y) <= reach) {
          player.path = [];
          player.combat = {mob};
          if (player.atkCd <= 0) { player.atkCd = 3; playerAttack(mob); }
        } else if (!player.path.length) player.path = findPath(player.x, player.y, mob.x, mob.y);
        else if (tickCount % 4 === 0) player.path = findPath(player.x, player.y, mob.x, mob.y); // chase
      }
    } else if (g.type === 'node') {
      const n = g.node;
      if (n.kind === 'tower' && player.mounted) {
        if (n.dead) player.goal = null;
        else if (dist(player.x, player.y, n.x, n.y) <= 5) {
          player.path = [];
          if (player.breathCd <= 0) { player.breathCd = 2; dragonBreath(n); }
        }
      } else if (dist(player.x, player.y, n.x, n.y) <= 1) {
        player.path = [];
        performNodeAction(n);
      } else if (!player.path.length) {
        player.goal = null; // unreachable
      }
    } else if (g.type === 'npc') {
      if (dist(player.x, player.y, g.npc.x, g.npc.y) <= 1) { player.path = []; talkTo(g.npc); }
      else if (!player.path.length) player.goal = null;
    } else if (g.type === 'walk' && !player.path.length) {
      player.goal = null;
    }
  }

  // mobs AI
  for (const m of mobs) {
    if (m.dead) continue;
    const d = MOB_DEFS[m.type];
    if (m.atkCd > 0) m.atkCd--;
    const pd = dist(m.x, m.y, player.x, player.y);
    if (player.mounted || player.dead) m.target = null;
    else if (d.aggro && pd <= 4 && !m.target) {
      m.target = 'player';
      if (player.goal === null) log(`<span class="bad">${mobTitle(d).charAt(0).toUpperCase() + mobTitle(d).slice(1)} lunges at you!</span>`);
    }
    if (m.target === 'player') {
      if (pd <= 1) {
        if (m.atkCd <= 0) { m.atkCd = 4; mobAttack(m); }
        // auto-retaliate
        if (!player.goal && !player.combat && !player.dead) {
          player.goal = {type:'mob', mob:m}; player.combat = {mob:m};
        }
      } else if (pd <= 9) {
        const step = [Math.sign(player.x - m.x), Math.sign(player.y - m.y)];
        const nx = m.x + step[0], ny = m.y + step[1];
        if (walkable(nx, ny)) { m.x = nx; m.y = ny; }
        else if (walkable(nx, m.y)) m.x = nx;
        else if (walkable(m.x, ny)) m.y = ny;
      } else m.target = null;
    } else {
      if (m.wanderCd-- <= 0) {
        m.wanderCd = 3 + Math.floor(Math.random() * 6);
        const dx = Math.floor(Math.random() * 3) - 1, dy = Math.floor(Math.random() * 3) - 1;
        const nx = m.x + dx, ny = m.y + dy;
        if (walkable(nx, ny) && dist(nx, ny, m.homeX, m.homeY) <= 7) { m.x = nx; m.y = ny; }
      }
    }
  }

  // Ember Keep ballistae fire at mounted riders
  if (player.mounted) {
    for (const k in nodes) {
      const n = nodes[k];
      if (n.kind !== 'tower' || n.dead) continue;
      if (dist(n.x, n.y, player.x, player.y) > 8) continue;
      n.ballistaCd = (n.ballistaCd || 0) - 1;
      if (n.ballistaCd <= 0) {
        n.ballistaCd = 4;
        const dodge = Math.min(0.6, lvlOf('dragonriding') * 0.008);
        if (Math.random() < dodge) {
          floaters.push({x:player.x, y:player.y, text:'dodged!', color:'#8fd48f', life:1});
        } else {
          particles.push({x:n.x+0.5, y:n.y+0.5, vx:(player.x-n.x)*2, vy:(player.y-n.y)*2, life:0.35, color:'#d8cba0', size:4});
          hurtPlayer(1 + Math.floor(Math.random() * 4), 'an Ember Keep ballista');
        }
      }
    }
  }

  // regen (Faith speeds healing)
  if (player.hp < maxHp()) {
    player.regenCd--;
    if (player.regenCd <= 0) {
      player.regenCd = Math.max(8, 20 - Math.floor(lvlOf('faith') / 10) * 2);
      player.hp++;
      renderHud();
    }
  } else player.regenCd = 20;

  // fake players
  for (const f of fakePlayers) {
    if (Math.random() < 0.35) {
      const dx = Math.floor(Math.random() * 3) - 1, dy = Math.floor(Math.random() * 3) - 1;
      const nx = f.x + dx, ny = f.y + dy;
      if (walkable(nx, ny) && dist(nx, ny, f.hx, f.hy) <= 12) { f.x = nx; f.y = ny; }
    }
    if (f.chatCd-- <= 0) {
      f.chatCd = 220 + Math.floor(Math.random() * 320);
      const lines = [
        'anyone selling iron bars?', 'wights hit HARD lol', 'just got 40 dragonriding!!',
        'the salmon spot up north is free', 'W ridge bank is closest to the pines fyi',
        'who keeps burning the ember keep before me >:(', 'gz', 'winter is coming... to grind wc',
        'lost my whole inv to a drake... jk you keep stuff here haha', 'selling 200 arrows, meet @ capitol',
        'sunspear bazaar has weirwood bows!!', 'ferry took my last 25gp and a sellsword jumped me lol',
        'got the serpent staff drop first kill :o', 'dorne valyrian rocks are free rn',
      ];
      log(`<span class="chat"><b>${f.name}:</b> ${lines[Math.floor(Math.random() * lines.length)]}</span>`);
    }
  }

  renderHud();
  if (tickCount % 20 === 0) saveGame();
}

/* ---------------- Save / load ---------------- */
function saveGame() {
  if (!gameStarted) return;
  const data = {
    v:1, skills:player.skills, hp:player.hp, inv:player.inv, bank:player.bank,
    equip:player.equip, style:player.style, x:player.x, y:player.y,
    dragonTamed:player.dragonTamed, dragonAspect:player.dragonAspect,
    quests:player.quests, t:tickCount,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    Object.assign(player.skills, d.skills);
    player.hp = d.hp; player.inv = d.inv || []; player.bank = d.bank || [];
    player.equip = d.equip || {weapon:null, armor:null};
    player.style = d.style || 'melee';
    player.x = d.x; player.y = d.y; player.px = d.x; player.py = d.y;
    player.dragonTamed = !!d.dragonTamed;
    player.dragonAspect = d.dragonAspect || 'ruby';
    Object.assign(player.quests, d.quests);
    if (!player.quests.slain) player.quests.slain = {};
    tickCount = d.t || 0;
    return true;
  } catch (e) { return false; }
}

/* ---------------- UI rendering ---------------- */
const tabContent = document.getElementById('tabContent');
let curTab = 'inv';
document.querySelectorAll('.tab').forEach(el => el.onclick = () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('sel'));
  el.classList.add('sel');
  curTab = el.dataset.tab;
  renderTab();
});
function renderTab() {
  if (curTab === 'inv') renderInv();
  else if (curTab === 'skills') renderSkills();
  else if (curTab === 'equip') renderEquip();
  else renderQuests();
}

function renderInv() {
  updateCoinHud();
  if (curTab !== 'inv') return;
  let html = '<h3 class="pane">Pack — ' + player.inv.length + '/' + INV_MAX + '</h3><div id="invGrid">';
  for (let i = 0; i < INV_MAX; i++) {
    const s = player.inv[i];
    if (!s) { html += '<div class="slot empty"></div>'; continue; }
    const def = ITEMS[s.id];
    let hint = def.name;
    if (def.heal) hint += ' — click to eat (+' + def.heal + ' hp)';
    else if (def.faith) hint += ' — click to bury';
    else if (def.slot) hint += ' — click to equip';
    html += `<div class="slot" data-i="${i}" title="${hint}">${def.icon}<span class="qty">${s.qty > 1 ? fmtQty(s.qty) : ''}</span></div>`;
  }
  html += '</div>';
  tabContent.innerHTML = html;
  document.querySelectorAll('#invGrid .slot[data-i]').forEach(el => el.onclick = () => useItem(+el.dataset.i));
}

function useItem(i) {
  const s = player.inv[i];
  if (!s) return;
  const def = ITEMS[s.id];
  if (def.heal) {
    if (player.hp >= maxHp()) { log('<span class="sys">You are already at full health.</span>'); return; }
    removeItem(s.id, 1);
    player.hp = Math.min(maxHp(), player.hp + def.heal);
    log(`<span class="sys">You eat the ${def.name.toLowerCase()}. It heals ${def.heal}.</span>`);
    renderHud();
  } else if (def.faith) {
    removeItem(s.id, 1);
    addXp('faith', def.faith);
    log('<span class="sys">You bury the bones beneath the cold earth. The Old Gods take notice.</span>');
  } else if (def.aspect) {
    if (!player.dragonTamed) { log('<span class="sys">A strange scale thrums with power... but you have no dragon to attune it to yet.</span>'); return; }
    removeItem(s.id, 1);
    player.dragonAspect = def.aspect;
    log(`<span class="lvl">🐉 Your drake sheds her scales and is reborn in ${ASPECTS[def.aspect].label} colors!</span>`);
    burst(player.x, player.y, ASPECTS[def.aspect].eye, 20);
    renderEquip();
  } else if (def.slot) {
    const req = def.slot === 'armor' ? 'defence' : def.class === 'archery' ? 'archery' : def.class === 'sorcery' ? 'sorcery' : 'attack';
    if (lvlOf(req) < def.lvl) {
      log(`<span class="bad">You need ${SKILLS.find(s => s.id === req).name} level ${def.lvl} to equip the ${def.name}.</span>`);
      return;
    }
    const old = player.equip[def.slot];
    player.inv.splice(i, 1);
    if (old) player.inv.push({id:old, qty:1});
    player.equip[def.slot] = s.id;
    log(`<span class="sys">You wield the ${def.name}.</span>`);
    renderInv(); renderEquip();
  } else {
    log(`<span class="sys">${def.name}: a fine material. Banks, anvils and fires will want this.</span>`);
  }
}

function renderSkills() {
  if (curTab !== 'skills') return;
  let html = '<h3 class="pane">Skills — click for guide</h3><div id="skillGrid">';
  for (const s of SKILLS) {
    const lvl = lvlOf(s.id), xp = player.skills[s.id];
    const cur = XP_TABLE[lvl], nxt = lvl < 99 ? XP_TABLE[lvl + 1] : cur + 1;
    const pct = lvl >= 99 ? 100 : Math.floor(100 * (xp - cur) / (nxt - cur));
    html += `<div class="skill" data-s="${s.id}" title="${Math.floor(xp).toLocaleString()} xp">
      <span class="ico">${s.icon}</span>
      <span style="flex:1">${s.name}<div class="bar"><i style="width:${pct}%"></i></div></span>
      <span class="lv">${lvl}</span></div>`;
  }
  const total = SKILLS.reduce((a, s) => a + lvlOf(s.id), 0);
  html += `</div><div id="totalLv">Total level: <b style="color:var(--gold)">${total}</b> · Combat level: <b style="color:var(--gold)">${combatLevel()}</b></div>`;
  tabContent.innerHTML = html;
  document.querySelectorAll('.skill').forEach(el => el.onclick = () => openSkillGuide(el.dataset.s));
}

function renderEquip() {
  if (curTab !== 'equip') return;
  const w = player.equip.weapon, a = player.equip.armor;
  let html = '<h3 class="pane">Equipment</h3>';
  html += `<div class="eqslot" id="eqW"><span class="ico">${w ? ITEMS[w].icon : '✋'}</span>
    <span>${w ? ITEMS[w].name : 'Bare fists'}<div class="lbl">WEAPON${w ? ' (' + weaponClass(w) + ') — click to unequip' : ''}</div></span></div>`;
  html += `<div class="eqslot" id="eqA"><span class="ico">${a ? ITEMS[a].icon : '👕'}</span>
    <span>${a ? ITEMS[a].name : 'Roughspun tunic'}<div class="lbl">ARMOR${a ? ' — click to unequip' : ''}</div></span></div>`;
  html += '<h3 class="pane" style="margin-top:12px">Combat style</h3><div class="stylebtns">';
  for (const [id, nm] of [['melee','⚔️ Melee'],['archery','🏹 Archery'],['sorcery','🔮 Sorcery']])
    html += `<div class="stylebtn ${player.style === id ? 'sel' : ''}" data-st="${id}">${nm}</div>`;
  html += '</div>';
  html += `<div id="eqStats">Max hit: <b>${playerMaxHit()}</b><br>
    Armor: <b>${armorValue()}</b> · Combat level: <b>${combatLevel()}</b><br>
    Arrows: <b>${invCount('arrows')}</b><br>
    ${w && weaponClass(w) !== player.style ? '<span style="color:var(--dim)">⚠ Your ' + ITEMS[w].name + ' is a ' + weaponClass(w) + ' weapon — it lends no power to ' + player.style + '.</span><br>' : ''}
    ${player.dragonTamed ? '🐉 Drake bonded (' + ASPECTS[player.dragonAspect].label + ') — dragonfire max ~<b>' + (2 + Math.floor(3 + lvlOf('dragonriding') * 0.3)) + '</b>' : '🐉 No drake bonded yet'}</div>`;
  tabContent.innerHTML = html;
  document.getElementById('eqW').onclick = () => unequip('weapon');
  document.getElementById('eqA').onclick = () => unequip('armor');
  document.querySelectorAll('.stylebtn').forEach(el => el.onclick = () => {
    player.style = el.dataset.st; renderEquip();
    log(`<span class="sys">Combat style: ${el.dataset.st}.</span>`);
  });
}
function unequip(slot) {
  const id = player.equip[slot];
  if (!id) return;
  if (player.inv.length >= INV_MAX) { log('<span class="bad">Your pack is full.</span>'); return; }
  player.equip[slot] = null;
  player.inv.push({id, qty:1});
  renderInv(); renderEquip();
}

function renderQuests() {
  if (curTab !== 'quests') return;
  let html = '<h3 class="pane">Quest journal</h3>';
  for (const q of QUESTS) {
    const done = player.quests[q.id] === 1;
    html += `<div class="quest ${done ? 'done' : ''}"><h4>${done ? '✓ ' : '❗ '}${q.name}</h4>
      <p>${q.desc}</p><div class="prog">${q.progress()}</div></div>`;
  }
  if (player.quests.throne)
    html += '<div class="quest done"><h4>👑 Monarch of the Realm</h4><p>You sat the Ember Throne. All hail.</p></div>';
  tabContent.innerHTML = html;
}

function updateCoinHud() {
  document.getElementById('coinHud').textContent = '💰 ' + fmtQty(invCount('coins'));
}
function renderHud() {
  const hpEl = document.getElementById('hpText');
  hpEl.textContent = player.hp;
  const pct = 100 - Math.floor(100 * player.hp / maxHp());
  document.getElementById('hpFill').style.height = pct + '%';
  document.getElementById('region').textContent = regionName(player.x, player.y);
}
function regionName(x, y) {
  if (x >= 118 && x <= 130 && y >= 114 && y <= 126 && tileAt(x, y) !== T.WATER) return 'The Drowned Bastion';
  if (y < 20) return 'Beyond the Frostwall';
  if (x >= 33 && x <= 47 && y >= 29 && y <= 41) return 'Wolf Ridge';
  if (x >= 47 && x <= 67 && y >= 87 && y <= 105) return 'The Capitol';
  if (x >= 46 && x <= 60 && y >= 134 && y <= 142) return 'Sunspear';
  if (x <= 112 && y >= chanY(x) + 3 && tileAt(x, y) !== T.WATER) return 'Dorne';
  if (x >= 110 && y >= 56 && tileAt(x, y) !== T.WATER) return 'The Ember Keep';
  if (x >= 110 && tileAt(x, y) !== T.WATER) return 'Dragonmont';
  if (tileAt(x, y) === T.WATER && (x > 100 || y >= chanY(x) - 2)) return 'The Narrow Sea';
  if (y < 34) return 'The North';
  if (y > 100) return 'The Southern Reach';
  return 'The Riverlands';
}
function updateMountBtn() {
  const b = document.getElementById('mountBtn');
  b.style.display = player.dragonTamed ? '' : 'none';
  b.classList.toggle('active', player.mounted);
  b.textContent = player.mounted ? '🐉 Dismount' : '🐉 Mount';
}

/* ---------------- Mount / dismount ---------------- */
function toggleMount() {
  if (!player.dragonTamed) { log('<span class="sys">You have no dragon... yet. Seek Dragonkeeper Rhaella on Dragonmont.</span>'); return; }
  if (player.dead) return;
  if (!player.mounted) {
    player.mounted = true;
    player.goal = null; player.path = []; player.combat = null;
    log('<span class="good">🐉 Your drake plunges from the clouds and you swing into the saddle. The realm shrinks beneath you.</span>');
    burst(player.x, player.y, '#c8563c', 16);
  } else {
    if (!walkable(player.x, player.y)) {
      log('<span class="bad">You cannot dismount here — find solid ground.</span>');
      return;
    }
    player.mounted = false;
    player.goal = null; player.path = [];
    log('<span class="sys">You slide from the saddle. Your drake circles up into the sun.</span>');
  }
  updateMountBtn();
}

/* ---------------- Canvas & rendering ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx = mmCanvas.getContext('2d');
let mmBase = null;

/* camera: arrows swing the view around the hero, wheel / ↑↓ zoom — all eased */
let camAngle = 0, camAngleT = 0, camZoom = 1, camZoomT = 1;
const ZOOM_MIN = 0.45, ZOOM_MAX = 2.4;
const keysHeld = {};
function screenToTile(sx, sy) { // invert the camera transform: screen px → tile
  const dx = (sx - viewW / 2) / camZoom, dy = (sy - viewH / 2) / camZoom;
  const cos = Math.cos(camAngle), sin = Math.sin(camAngle);
  const wx = dx * cos + dy * sin + player.px * TILE + TILE / 2;
  const wy = -dx * sin + dy * cos + player.py * TILE + TILE / 2;
  return [Math.floor(wx / TILE), Math.floor(wy / TILE)];
}

let viewW = 0, viewH = 0, DPR = 1, vignette = null;
function resize() {
  const vp = document.getElementById('viewport');
  DPR = Math.min(2, window.devicePixelRatio || 1);
  viewW = vp.clientWidth; viewH = vp.clientHeight;
  canvas.width = Math.max(1, Math.round(viewW * DPR));
  canvas.height = Math.max(1, Math.round(viewH * DPR));
  mmCanvas.width = Math.round(150 * DPR); mmCanvas.height = Math.round(150 * DPR);
  // soft vignette, rebuilt at half resolution per size
  vignette = document.createElement('canvas');
  vignette.width = Math.max(2, Math.round(viewW / 2));
  vignette.height = Math.max(2, Math.round(viewH / 2));
  const vc = vignette.getContext('2d');
  const g = vc.createRadialGradient(
    vignette.width / 2, vignette.height / 2, Math.min(vignette.width, vignette.height) * 0.45,
    vignette.width / 2, vignette.height / 2, Math.max(vignette.width, vignette.height) * 0.75);
  g.addColorStop(0, 'rgba(8,6,10,0)'); g.addColorStop(1, 'rgba(8,6,10,0.42)');
  vc.fillStyle = g; vc.fillRect(0, 0, vignette.width, vignette.height);
}
window.addEventListener('resize', resize);

const TILE_COLORS = {
  [T.GRASS]:'#4a7c3f', [T.WATER]:'#1d4e79', [T.SNOW]:'#d8e2e8', [T.SAND]:'#c4ad6b',
  [T.STONE]:'#8d8a80', [T.WALL]:'#5b5d68', [T.LAVA]:'#d84b1f', [T.VOLC]:'#4a3f3b',
  [T.FLOOR]:'#a5977f', [T.MTN]:'#6b6f77',
};
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }
function shade(color, f) {
  if (color[0] !== '#') return color;
  const n = parseInt(color.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const adj = v => Math.max(0, Math.min(255, Math.round(v + (f > 0 ? (255 - v) : v) * f)));
  return 'rgb(' + adj(r) + ',' + adj(g) + ',' + adj(b) + ')';
}

/* --- pre-rendered terrain: the whole map is painted once, in detail,
       into chunk canvases; per-frame drawing is a handful of blits --- */
const CHUNK = 36, CHUNK_PX = CHUNK * TILE;
let terrainChunks = null;

function paintTile(c, x, y, ox, oy) {
  const t = map[idx(x, y)];
  const h = hash2(x, y), h2 = hash2(x * 3 + 1, y * 7 + 2), h3 = hash2(x * 5 + 3, y * 11 + 5);
  c.fillStyle = shade(TILE_COLORS[t], (h - 0.5) * 0.14);
  c.fillRect(ox, oy, TILE, TILE);
  switch (t) {
    case T.GRASS: {
      for (let i = 0; i < 3; i++) { // mottled undergrowth
        const px = ox + hash2(x * 13 + i, y * 17) * TILE, py = oy + hash2(x * 19, y * 23 + i) * TILE;
        c.fillStyle = 'rgba(20,40,16,' + (0.10 + 0.10 * hash2(x + i, y - i)).toFixed(3) + ')';
        c.beginPath(); c.ellipse(px, py, 5 + 4 * h2, 3 + 3 * h3, h * 3, 0, 7); c.fill();
      }
      c.strokeStyle = 'rgba(150,200,110,0.45)'; c.lineWidth = 1;
      for (let i = 0; i < 4; i++) { // grass blades
        const bx = ox + 3 + hash2(x * 29 + i, y * 31) * (TILE - 6), by = oy + 5 + hash2(x * 37, y * 41 + i) * (TILE - 9);
        c.beginPath(); c.moveTo(bx, by + 3); c.quadraticCurveTo(bx + 1, by, bx + 2 - 4 * hash2(x + i, y + i), by - 3); c.stroke();
      }
      if (h > 0.96) { // rare wildflowers
        c.fillStyle = h2 > 0.5 ? '#e8d868' : '#d8788a';
        c.fillRect(ox + h2 * 24 + 3, oy + h3 * 24 + 3, 2, 2);
      }
      break;
    }
    case T.SNOW: {
      c.fillStyle = 'rgba(150,175,210,0.22)'; // wind-carved drifts
      c.beginPath(); c.ellipse(ox + h2 * TILE, oy + h3 * TILE, 8, 5, h * 3, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 3; i++) c.fillRect(ox + hash2(x * 7 + i, y * 13) * 29 + 1, oy + hash2(x * 17, y * 19 + i) * 29 + 1, 1.5, 1.5);
      break;
    }
    case T.SAND: {
      c.strokeStyle = 'rgba(120,95,45,0.28)'; c.lineWidth = 1;
      for (let i = 0; i < 3; i++) { // wind ripples
        const ry = oy + 5 + i * 10 + h2 * 4;
        c.beginPath(); c.moveTo(ox + 2, ry); c.quadraticCurveTo(ox + TILE / 2, ry + (h - 0.5) * 7, ox + TILE - 2, ry); c.stroke();
      }
      c.fillStyle = 'rgba(255,240,190,0.4)';
      c.fillRect(ox + h2 * 28 + 1, oy + h3 * 28 + 1, 2, 2);
      break;
    }
    case T.WATER: {
      if (h2 > 0.55) { // occasional deep-water shadow
        c.fillStyle = 'rgba(6,22,44,0.14)';
        c.beginPath(); c.ellipse(ox + h2 * TILE, oy + h3 * TILE, 6 + 5 * h, 4 + 3 * h2, h * 3, 0, 7); c.fill();
      }
      if (h3 > 0.7) { // pale caustic wisp
        c.strokeStyle = 'rgba(150,200,230,0.14)'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(ox + 3, oy + h * 26 + 3);
        c.quadraticCurveTo(ox + TILE / 2, oy + h * 26 - 4, ox + TILE - 3, oy + h * 26 + 3); c.stroke();
      }
      break;
    }
    case T.STONE: case T.FLOOR: {
      c.strokeStyle = t === T.FLOOR ? 'rgba(70,58,42,0.5)' : 'rgba(50,48,44,0.5)';
      c.lineWidth = 1.5;
      const off = (x + y) % 2 ? TILE / 4 : -TILE / 4; // staggered flagstones
      c.beginPath();
      c.moveTo(ox, oy + TILE / 2); c.lineTo(ox + TILE, oy + TILE / 2);
      c.moveTo(ox + TILE / 2 + off, oy); c.lineTo(ox + TILE / 2 + off, oy + TILE / 2);
      c.moveTo(ox + TILE / 2 - off, oy + TILE / 2); c.lineTo(ox + TILE / 2 - off, oy + TILE);
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(ox, oy, TILE, 2);
      if (h > 0.85) { c.strokeStyle = 'rgba(40,38,34,0.4)'; c.beginPath(); c.moveTo(ox + h2 * 20 + 4, oy + 6); c.lineTo(ox + h3 * 20 + 8, oy + TILE - 8); c.stroke(); }
      break;
    }
    case T.WALL: {
      c.fillStyle = shade('#5b5d68', (h - 0.5) * 0.18);
      c.fillRect(ox, oy, TILE, TILE);
      c.strokeStyle = 'rgba(26,26,32,0.75)'; c.lineWidth = 1; // brick courses
      for (let r = 0; r < 4; r++) {
        const by = oy + r * 8;
        c.beginPath(); c.moveTo(ox, by + 8); c.lineTo(ox + TILE, by + 8); c.stroke();
        for (let bx = (r % 2) * 8; bx < TILE; bx += 16) { c.beginPath(); c.moveTo(ox + bx, by); c.lineTo(ox + bx, by + 8); c.stroke(); }
      }
      c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(ox, oy, TILE, 4);
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(ox, oy + TILE - 4, TILE, 4);
      break;
    }
    case T.MTN: {
      const ax = ox + TILE * (0.35 + h * 0.3), ay = oy + 3 + h2 * 4; // each peak its own summit
      c.fillStyle = shade('#6b6f77', -0.22);
      c.beginPath(); c.moveTo(ox + 1 + h3 * 3, oy + TILE - 2); c.lineTo(ax, ay); c.lineTo(ox + TILE - 1 - h2 * 3, oy + TILE - 2); c.closePath(); c.fill();
      c.fillStyle = 'rgba(235,240,248,' + (0.3 + h3 * 0.35).toFixed(3) + ')'; // snow cap
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + 5, ay + 7 + h * 3); c.lineTo(ax - 5, ay + 8); c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.22)'; // shaded east face
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ox + TILE - 1 - h2 * 3, oy + TILE - 2); c.lineTo(ax + 3, oy + TILE - 2); c.closePath(); c.fill();
      break;
    }
    case T.VOLC: {
      c.strokeStyle = 'rgba(255,96,40,' + (0.2 + 0.3 * h2).toFixed(3) + ')'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(ox + h2 * 20, oy + TILE); c.lineTo(ox + 6 + h * 16, oy + h3 * 16 + 8); c.lineTo(ox + h3 * 24 + 4, oy + 2); c.stroke();
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.beginPath(); c.ellipse(ox + h * TILE, oy + h2 * TILE, 6, 4, 0, 0, 7); c.fill();
      break;
    }
    case T.LAVA: {
      c.fillStyle = 'rgba(40,10,4,0.55)'; // cooling crust islands
      c.beginPath(); c.ellipse(ox + h2 * TILE, oy + h3 * TILE, 7 + 5 * h, 5 + 3 * h2, h * 3, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,220,90,0.5)';
      c.fillRect(ox + h * 24 + 2, oy + h2 * 24 + 2, 3, 2);
      break;
    }
  }
}

const SOFT = new Set([T.GRASS, T.SNOW, T.SAND, T.VOLC, T.STONE, T.FLOOR]);
function paintTransitions(c, x, y, ox, oy) {
  const t = map[idx(x, y)];
  const nb = [[0, -1, 't'], [0, 1, 'b'], [-1, 0, 'l'], [1, 0, 'r']];
  const edgeRect = side =>
    side === 't' ? [ox, oy, TILE, 9] : side === 'b' ? [ox, oy + TILE - 9, TILE, 9] :
    side === 'l' ? [ox, oy, 9, TILE] : [ox + TILE - 9, oy, 9, TILE];
  if (t === T.WATER) {
    for (const [dx, dy, side] of nb) {
      const n = tileAt(x + dx, y + dy);
      if (n === T.WATER || n === T.LAVA) continue;
      // sunlit shallows shelving off the shore, edged with foam
      const [rx, ry, rw, rh] = edgeRect(side);
      const g = side === 't' || side === 'b'
        ? c.createLinearGradient(0, side === 't' ? ry : ry + rh, 0, side === 't' ? ry + rh : ry)
        : c.createLinearGradient(side === 'l' ? rx : rx + rw, 0, side === 'l' ? rx + rw : rx, 0);
      g.addColorStop(0, 'rgba(96,160,170,0.5)'); g.addColorStop(1, 'rgba(96,160,170,0)');
      c.fillStyle = g; c.fillRect(rx, ry, rw, rh);
      c.strokeStyle = 'rgba(230,246,255,0.55)'; c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i <= 4; i++) {
        const f = i / 4, wob = (hash2(x * 7 + i, y * 9 + i) - 0.5) * 3;
        const px = side === 'l' ? ox + 1.5 + wob : side === 'r' ? ox + TILE - 1.5 + wob : ox + f * TILE;
        const py = side === 't' ? oy + 1.5 + wob : side === 'b' ? oy + TILE - 1.5 + wob : oy + f * TILE;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.stroke();
    }
  } else if (SOFT.has(t)) {
    for (const [dx, dy, side] of nb) {
      const n = tileAt(x + dx, y + dy);
      if (n === t || !SOFT.has(n)) continue;
      // feather the neighbouring biome a little way into this tile
      c.fillStyle = TILE_COLORS[n];
      c.globalAlpha = 0.22;
      for (let i = 0; i < 5; i++) {
        const f = (i + 0.5) / 5, r = 3 + hash2(x * 11 + i, y * 13 + side.charCodeAt(0)) * 4;
        const px = side === 'l' ? ox : side === 'r' ? ox + TILE : ox + f * TILE;
        const py = side === 't' ? oy : side === 'b' ? oy + TILE : oy + f * TILE;
        c.beginPath(); c.arc(px, py, r, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
    }
  }
  // contact shadow cast by walls and peaks onto the tile below them
  const up = tileAt(x, y - 1);
  if ((up === T.WALL || up === T.MTN) && t !== T.WALL && t !== T.MTN) {
    const g = c.createLinearGradient(0, oy, 0, oy + 10);
    g.addColorStop(0, 'rgba(0,0,0,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(ox, oy, TILE, 10);
  }
}

function buildTerrain() {
  terrainChunks = [];
  const nx = Math.ceil(W / CHUNK), ny = Math.ceil(H / CHUNK);
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
    const cv = document.createElement('canvas');
    cv.width = CHUNK_PX; cv.height = CHUNK_PX;
    const c = cv.getContext('2d');
    const xEnd = Math.min(W, (cx + 1) * CHUNK), yEnd = Math.min(H, (cy + 1) * CHUNK);
    for (let y = cy * CHUNK; y < yEnd; y++) for (let x = cx * CHUNK; x < xEnd; x++)
      paintTile(c, x, y, (x - cx * CHUNK) * TILE, (y - cy * CHUNK) * TILE);
    for (let y = cy * CHUNK; y < yEnd; y++) for (let x = cx * CHUNK; x < xEnd; x++)
      paintTransitions(c, x, y, (x - cx * CHUNK) * TILE, (y - cy * CHUNK) * TILE);
    terrainChunks.push({cv, px: cx * CHUNK_PX, py: cy * CHUNK_PX});
  }
}

function buildMinimap() {
  mmBase = document.createElement('canvas');
  mmBase.width = W; mmBase.height = H;
  const c = mmBase.getContext('2d');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    c.fillStyle = TILE_COLORS[map[idx(x, y)]];
    c.fillRect(x, y, 1, 1);
  }
  for (const k in nodes) {
    const n = nodes[k];
    if (['bank','anvil','range','roost','throne','shop','ferry'].includes(n.kind)) {
      c.fillStyle = '#f4e3a1'; c.fillRect(n.x - 1, n.y - 1, 3, 3);
    }
    if (n.kind === 'tower') { c.fillStyle = '#ff5e2a'; c.fillRect(n.x - 1, n.y - 1, 3, 3); }
  }
  for (const m of mobs) {
    const d = MOB_DEFS[m.type];
    if (d.boss) { c.fillStyle = d.glow; c.fillRect(m.homeX - 1, m.homeY - 1, 3, 3); }
  }
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (gameStarted) {
    // smooth entity render positions
    const lerp = Math.min(1, dt * 7);
    player.px += (player.x - player.px) * lerp;
    player.py += (player.y - player.py) * lerp;
    for (const m of mobs) { m.px += (m.x - m.px) * lerp; m.py += (m.y - m.py) * lerp; }
    for (const f of fakePlayers) { f.px += (f.x - f.px) * lerp; f.py += (f.y - f.py) * lerp; }
    // camera input: ←→ orbit the hero, ↑↓ zoom (wheel does too)
    if (keysHeld.ArrowLeft) camAngleT -= dt * 2.2;
    if (keysHeld.ArrowRight) camAngleT += dt * 2.2;
    if (keysHeld.ArrowUp) camZoomT = Math.min(ZOOM_MAX, camZoomT * (1 + dt * 1.5));
    if (keysHeld.ArrowDown) camZoomT = Math.max(ZOOM_MIN, camZoomT * (1 - dt * 1.5));
    const ceases = Math.min(1, dt * 10);
    camAngle += (camAngleT - camAngle) * ceases;
    camZoom += (camZoomT - camZoom) * ceases;
    draw(now / 1000, dt);
  }
  requestAnimationFrame(frame);
}

function draw(time, dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const cw = viewW, ch = viewH;
  const camX = player.px * TILE + TILE / 2 - cw / 2;
  const camY = player.py * TILE + TILE / 2 - ch / 2;
  ctx.fillStyle = '#0a1522';
  ctx.fillRect(0, 0, cw, ch);

  // orbit + zoom about the hero (screen centre), then draw in world space as before
  ctx.translate(cw / 2, ch / 2);
  ctx.scale(camZoom, camZoom);
  ctx.rotate(camAngle);
  ctx.translate(-cw / 2, -ch / 2);

  // visible bounds: a rotated view sees up to the half-diagonal in every direction
  const pad = Math.hypot(cw, ch) / 2 / camZoom;
  const pcx = player.px * TILE + TILE / 2, pcy = player.py * TILE + TILE / 2;
  const x0 = Math.max(0, Math.floor((pcx - pad) / TILE) - 1), x1 = Math.min(W - 1, Math.ceil((pcx + pad) / TILE) + 1);
  const y0 = Math.max(0, Math.floor((pcy - pad) / TILE) - 1), y1 = Math.min(H - 1, Math.ceil((pcy + pad) / TILE) + 1);

  // terrain: pre-rendered chunks, then animated water/lava on top
  if (terrainChunks) for (const chk of terrainChunks) {
    if (chk.px > pcx + pad || chk.px + CHUNK_PX < pcx - pad || chk.py > pcy + pad || chk.py + CHUNK_PX < pcy - pad) continue;
    ctx.drawImage(chk.cv, chk.px - camX, chk.py - camY);
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = map[idx(x, y)];
    if (t !== T.WATER && t !== T.LAVA) continue;
    const sx = x * TILE - camX, sy = y * TILE - camY;
    if (t === T.WATER) {
      const wv = Math.sin(time * 1.5 + x * 0.9 + y * 1.3) * 0.5 + 0.5;
      ctx.fillStyle = 'rgba(120,180,220,' + (0.05 + wv * 0.08) + ')';
      ctx.fillRect(sx, sy + (wv * 20) % TILE, TILE, 3);
      if (hash2(x * 3, y * 5) > 0.88) { // drifting sun-glints
        const sp = Math.sin(time * 2.5 + x * 7 + y * 3);
        if (sp > 0.72) {
          ctx.fillStyle = 'rgba(235,250,255,' + ((sp - 0.72) * 2.2).toFixed(3) + ')';
          ctx.fillRect(sx + hash2(x, y * 2) * 26 + 2, sy + hash2(x * 2, y) * 26 + 2, 2, 2);
        }
      }
    } else {
      const gl = Math.sin(time * 2 + x + y) * 0.5 + 0.5;
      ctx.fillStyle = 'rgba(255,200,80,' + (0.15 + gl * 0.25) + ')';
      ctx.fillRect(sx + 4, sy + 4, TILE - 8, TILE - 8);
    }
  }

  // nodes (objects)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const n = nodes[key(x, y)];
    if (n) drawNode(n, x * TILE - camX, y * TILE - camY, time);
  }

  // npcs
  for (const n of npcs) {
    if (n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue;
    drawHumanoid(n.x * TILE - camX, n.y * TILE - camY, n.color, '#3a3227');
    ctx.fillStyle = '#f4e3a1'; ctx.font = 'bold 11px Verdana'; ctx.textAlign = 'center';
    label(n.name, n.x * TILE - camX + TILE / 2, n.y * TILE - camY - 6);
  }

  // fake players
  for (const f of fakePlayers) {
    if (f.px < x0 - 1 || f.px > x1 + 1 || f.py < y0 - 1 || f.py > y1 + 1) continue;
    drawHumanoid(f.px * TILE - camX, f.py * TILE - camY, f.color, '#2a2a2a');
    ctx.fillStyle = '#8fd48f'; ctx.font = '10px Verdana'; ctx.textAlign = 'center';
    label(f.name, f.px * TILE - camX + TILE / 2, f.py * TILE - camY - 4);
  }

  // mobs
  for (const m of mobs) {
    if (m.dead) continue;
    if (m.px < x0 - 1 || m.px > x1 + 1 || m.py < y0 - 1 || m.py > y1 + 1) continue;
    drawMob(m, m.px * TILE - camX, m.py * TILE - camY, time);
  }

  // player (+dragon)
  drawPlayer(player.px * TILE - camX, player.py * TILE - camY, time);

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * TILE - camX, p.y * TILE - camY, p.size, p.size);
    ctx.globalAlpha = 1;
  }

  // floaters
  ctx.font = 'bold 13px Verdana'; ctx.textAlign = 'center';
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt; if (f.life <= 0) { floaters.splice(i, 1); continue; }
    f.y -= dt * 0.8;
    ctx.globalAlpha = Math.min(1, f.life);
    ctx.fillStyle = '#000';
    label(f.text, f.x * TILE - camX + TILE / 2 + 1, f.y * TILE - camY + 1);
    ctx.fillStyle = f.color;
    label(f.text, f.x * TILE - camX + TILE / 2, f.y * TILE - camY);
    ctx.globalAlpha = 1;
  }

  // post FX are screen-space: drop the camera transform first
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // warm light pooled around the hero, cool shadow at the edges of sight
  const lg = ctx.createRadialGradient(cw / 2, ch / 2, 40, cw / 2, ch / 2, Math.max(cw, ch) * 0.55);
  lg.addColorStop(0, 'rgba(255,214,140,0.09)');
  lg.addColorStop(0.55, 'rgba(255,190,110,0.025)');
  lg.addColorStop(1, 'rgba(255,180,100,0)');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, cw, ch);
  if (vignette) ctx.drawImage(vignette, 0, 0, cw, ch);

  drawMinimap(camX, camY, cw, ch);
}

function label(text, x, y) { // text at a world point, kept upright under camera rotation
  ctx.save(); ctx.translate(x, y); ctx.rotate(-camAngle); ctx.fillText(text, 0, 0); ctx.restore();
}

function drawNode(n, sx, sy, time) {
  const cx = sx + TILE / 2, cy = sy + TILE / 2;
  if (n.dead && ['pine','ironwood','weirwood','copper','iron','glassrock','valrock'].includes(n.kind)) {
    ctx.fillStyle = 'rgba(60,45,30,0.8)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 6, 8, 4, 0, 0, 7); ctx.fill();
    return;
  }
  switch (n.kind) {
    case 'pine': case 'ironwood': case 'weirwood': {
      const sway = Math.sin(time * 1.1 + n.x * 1.7) * 1.5;
      const trunk = n.kind === 'weirwood' ? '#e8e4dc' : '#5b4228';
      const leaf = n.kind === 'pine' ? '#2c5d2a' : n.kind === 'ironwood' ? '#37474a' : '#b0342c';
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(cx + 3, sy + TILE - 4, 12, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = trunk; ctx.fillRect(cx - 3, cy, 6, TILE / 2 - 4);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(cx + 1, cy, 2, TILE / 2 - 4); // bark shade
      // layered canopy — shadowed skirt, body, sunlit crown — swaying gently
      const layer = (ry, w2, hgt, col) => {
        ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(cx - w2, cy + ry);
        ctx.lineTo(cx + sway * (1 - ry / 8), cy + ry - hgt);
        ctx.lineTo(cx + w2, cy + ry);
        ctx.closePath(); ctx.fill();
      };
      layer(6, 13, 18, shade(leaf, -0.28));
      layer(0, 11, 17, leaf);
      layer(-6, 8, 14, shade(leaf, 0.2));
      if (n.kind === 'weirwood') { // the carved face weeps sap
        ctx.fillStyle = '#7a1f1a';
        ctx.fillRect(cx - 2.5, cy + 3, 1.5, 4); ctx.fillRect(cx + 1, cy + 3, 1.5, 4);
      }
      break;
    }
    case 'copper': case 'iron': case 'glassrock': case 'valrock': {
      const spek = {copper:'#c47f33', iron:'#cfcbc0', glassrock:'#141418', valrock:'#5adad4'}[n.kind];
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(cx, sy + TILE - 5, 11, 4, 0, 0, 7); ctx.fill();
      // faceted boulder: outline, sunlit west face, shaded east face
      ctx.fillStyle = '#6e6a5e';
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy + TILE - 6); ctx.lineTo(sx + 8, sy + 10); ctx.lineTo(cx, sy + 6);
      ctx.lineTo(sx + TILE - 7, sy + 12); ctx.lineTo(sx + TILE - 4, sy + TILE - 6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(20,18,14,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.moveTo(sx + 8, sy + 10); ctx.lineTo(cx, sy + 6); ctx.lineTo(cx - 1, sy + TILE - 7); ctx.lineTo(sx + 7, sy + TILE - 7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.moveTo(cx, sy + 6); ctx.lineTo(sx + TILE - 7, sy + 12); ctx.lineTo(sx + TILE - 5, sy + TILE - 7); ctx.lineTo(cx + 1, sy + TILE - 7);
      ctx.closePath(); ctx.fill();
      // ore veins, glinting as the light catches them
      ctx.fillStyle = spek;
      ctx.fillRect(cx - 6, cy - 2, 4, 4); ctx.fillRect(cx + 2, cy + 3, 4, 4); ctx.fillRect(cx - 1, cy - 7, 3, 3);
      if (Math.sin(time * 3 + n.x * 2) > 0.6) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(cx - 5, cy - 1, 1.5, 1.5);
      }
      break;
    }
    case 'fish_trout': case 'fish_salmon': case 'fish_black': {
      const r = 5 + Math.sin(time * 3 + n.x) * 3;
      ctx.strokeStyle = 'rgba(220,240,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, 7); ctx.stroke();
      break;
    }
    case 'bank': {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(sx + 5, sy + 10, TILE - 10, TILE - 16);
      ctx.fillStyle = '#c9a558'; ctx.fillRect(sx + 5, sy + 14, TILE - 10, 4);
      ctx.fillRect(cx - 3, sy + 16, 6, 7);
      break;
    }
    case 'anvil': {
      ctx.fillStyle = '#2a2a30';
      ctx.fillRect(sx + 7, sy + 12, TILE - 14, 7);
      ctx.fillRect(sx + 11, sy + 18, TILE - 22, 8);
      ctx.fillStyle = '#ff8c3c';
      const gl = Math.sin(time * 4) * 0.5 + 0.5;
      ctx.globalAlpha = 0.4 + gl * 0.4;
      ctx.fillRect(sx + 9, sy + 13, 5, 3);
      ctx.globalAlpha = 1;
      break;
    }
    case 'range': {
      ctx.fillStyle = '#4a4038'; ctx.fillRect(sx + 6, sy + 18, TILE - 12, 9);
      const fl = Math.sin(time * 6 + n.x) * 3;
      ctx.fillStyle = '#ff7b2a';
      ctx.beginPath();
      ctx.moveTo(cx - 7, sy + 19); ctx.quadraticCurveTo(cx, sy + 2 + fl, cx + 7, sy + 19);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd66b';
      ctx.beginPath();
      ctx.moveTo(cx - 3, sy + 19); ctx.quadraticCurveTo(cx, sy + 10 + fl, cx + 3, sy + 19);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'roost': {
      ctx.strokeStyle = '#7a5a34'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy + 3, 11, 0, 7); ctx.stroke();
      ctx.fillStyle = '#d8c8a8';
      ctx.beginPath(); ctx.ellipse(cx - 4, cy + 2, 4, 5, 0.3, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 4, cy + 3, 4, 5, -0.3, 0, 7); ctx.fill();
      break;
    }
    case 'throne': {
      ctx.fillStyle = '#8c1f1a';
      ctx.fillRect(sx + 8, sy + 4, TILE - 16, TILE - 10);
      ctx.fillStyle = '#c9a558';
      ctx.fillRect(sx + 8, sy + 4, TILE - 16, 4);
      ctx.beginPath();
      ctx.moveTo(sx + 8, sy + 4); ctx.lineTo(sx + 6, sy - 4); ctx.lineTo(sx + 12, sy + 4);
      ctx.moveTo(sx + TILE - 8, sy + 4); ctx.lineTo(sx + TILE - 6, sy - 4); ctx.lineTo(sx + TILE - 12, sy + 4);
      ctx.moveTo(cx - 3, sy + 4); ctx.lineTo(cx, sy - 7); ctx.lineTo(cx + 3, sy + 4);
      ctx.fill();
      break;
    }
    case 'shop': {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(sx + 4, sy + 14, TILE - 8, TILE - 18); // counter
      ctx.fillStyle = '#8c2f2a'; // awning
      ctx.beginPath();
      ctx.moveTo(sx + 2, sy + 12); ctx.lineTo(cx, sy + 2); ctx.lineTo(sx + TILE - 2, sy + 12);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8d8b0';
      for (let i = 0; i < 3; i++) ctx.fillRect(sx + 5 + i * 9, sy + 9, 4, 3);
      ctx.fillStyle = '#f4e3a1'; ctx.fillRect(cx - 2, sy + 17, 4, 4); // wares glint
      break;
    }
    case 'ferry': {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(sx + 2, cy - 2, TILE - 4, 6); // dock planks
      const bob = Math.sin(time * 2 + n.x) * 2;
      ctx.fillStyle = '#4a3620'; // the moored ferry, bobbing on the tide
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy + 8 + bob); ctx.quadraticCurveTo(cx, cy + 15 + bob, cx + 10, cy + 8 + bob);
      ctx.lineTo(cx + 7, cy + 5 + bob); ctx.lineTo(cx - 7, cy + 5 + bob);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#d8cba0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy + 5 + bob); ctx.lineTo(cx, cy - 9 + bob); ctx.stroke();
      break;
    }
    case 'tower': {
      if (n.dead) {
        ctx.fillStyle = '#3a3632';
        ctx.beginPath(); ctx.ellipse(cx, cy + 6, 12, 6, 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(120,120,120,0.5)';
        const sm = (time * 12 + n.x * 7) % 20;
        ctx.beginPath(); ctx.arc(cx + 2, cy - sm * 0.8, 3 + sm * 0.2, 0, 7); ctx.fill();
        break;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(cx, sy + TILE - 3, 13, 5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#75726c';
      ctx.fillRect(sx + 6, sy - 8, TILE - 12, TILE + 4);
      ctx.fillStyle = '#8d8a84';
      for (let i = 0; i < 4; i++) ctx.fillRect(sx + 6 + i * 6, sy - 12, 4, 5);
      ctx.fillStyle = '#2a2126';
      ctx.fillRect(cx - 3, cy + 2, 6, 10);
      if (n.hp < NODE_DEFS.tower.hp) {
        const fl = Math.sin(time * 7 + n.x) * 2;
        ctx.fillStyle = '#ff7b2a';
        ctx.beginPath();
        ctx.moveTo(cx - 6, sy - 6); ctx.quadraticCurveTo(cx, sy - 20 - fl, cx + 6, sy - 6);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8c1f1a'; ctx.fillRect(sx + 4, sy - 18, TILE - 8, 4);
        ctx.fillStyle = '#ff5e2a'; ctx.fillRect(sx + 4, sy - 18, (TILE - 8) * n.hp / NODE_DEFS.tower.hp, 4);
      }
      break;
    }
    case 'gate': {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(sx, sy, TILE * 2, 6);
      break;
    }
  }
}

function drawHumanoid(sx, sy, tunic, trim) {
  const cx = sx + TILE / 2, cy = sy + TILE / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(cx, sy + TILE - 4, 8, 3, 0, 0, 7); ctx.fill();
  // cloaked body, lit from the west, inked outline
  const g = ctx.createLinearGradient(cx - 7, cy - 5, cx + 7, cy + 13);
  g.addColorStop(0, shade(tunic, 0.22)); g.addColorStop(1, shade(tunic, -0.3));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy + 4, 7, 9, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(12,10,8,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
  // head, hair, outline
  ctx.fillStyle = '#d8b28f';
  ctx.beginPath(); ctx.arc(cx, cy - 7, 6, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(12,10,8,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#4a3524';
  ctx.beginPath(); ctx.arc(cx, cy - 8.5, 6, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  ctx.fillStyle = trim;
  ctx.fillRect(cx - 7, cy + 1, 14, 3);
}

function drawMob(m, sx, sy, time) {
  const d = MOB_DEFS[m.type];
  const cx = sx + TILE / 2, cy = sy + TILE / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(cx, sy + TILE - 4, 9, 3, 0, 0, 7); ctx.fill();
  if (d.boss) {
    // pulsing elemental aura
    const pulse = 12 + Math.sin(time * 3 + m.x) * 3;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = d.glow;
    ctx.beginPath(); ctx.arc(cx, cy, pulse + 6, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    if (m.type === 'chained_wraith') {
      // rune circle scribed into the stone beneath it
      ctx.strokeStyle = d.glow; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(cx, sy + TILE - 4, 14, 5, 0, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
      // lean jackal-masked figure
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, 8, 12, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy - 11, 6, 5, 0, 0, 7); ctx.fill();
      // tall jackal ears + muzzle
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy - 13); ctx.lineTo(cx - 7, cy - 23); ctx.lineTo(cx - 1, cy - 15);
      ctx.moveTo(cx + 5, cy - 13); ctx.lineTo(cx + 7, cy - 23); ctx.lineTo(cx + 1, cy - 15);
      ctx.fill();
      ctx.fillRect(cx + 4, cy - 12, 6, 3);
      ctx.fillStyle = d.glow; // burning eyes + rune-lit trim
      ctx.fillRect(cx - 4, cy - 13, 2, 2); ctx.fillRect(cx + 1, cy - 13, 2, 2);
      ctx.fillRect(cx - 7, cy + 1, 14, 2);
      // whirling chain-sickle
      const swing = time * 4 + m.x;
      const hx = cx + Math.cos(swing) * 16, hy = cy - 2 + Math.sin(swing) * 10;
      ctx.strokeStyle = '#9aa4a8'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.moveTo(cx + 4, cy); ctx.quadraticCurveTo((cx + hx) / 2, cy - 14, hx, hy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = d.glow;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 6, hy - 3); ctx.lineTo(hx + 1, hy + 4); ctx.closePath(); ctx.fill();
    } else {
      // oversized armored figure with spiked pauldrons
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, 10, 12, 0, 0, 7); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 4); ctx.lineTo(cx - 15, cy - 12); ctx.lineTo(cx - 6, cy - 8);
      ctx.moveTo(cx + 10, cy - 4); ctx.lineTo(cx + 15, cy - 12); ctx.lineTo(cx + 6, cy - 8);
      ctx.fill();
      ctx.fillStyle = '#1c1a20';
      ctx.beginPath(); ctx.arc(cx, cy - 11, 7, 0, 7); ctx.fill();
      ctx.fillStyle = d.glow; // burning eyes + trim
      ctx.fillRect(cx - 4, cy - 13, 3, 3); ctx.fillRect(cx + 2, cy - 13, 3, 3);
      ctx.fillRect(cx - 8, cy + 1, 16, 3);
      // each Guardian wields the max-tier arm of its class
      if (m.type === 'gilded_sentinel') {
        // the Sunforged Bow, arrow nocked and burning
        ctx.strokeStyle = d.glow; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx + 13, cy - 3, 10, -Math.PI / 2.6, Math.PI / 2.6); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx + 16, cy - 12); ctx.lineTo(cx + 16, cy + 6); ctx.stroke();
        ctx.strokeStyle = '#fff2a0'; ctx.lineWidth = 2;
        const dr = Math.sin(time * 3 + m.x) * 2;
        ctx.beginPath(); ctx.moveTo(cx + 6, cy - 3); ctx.lineTo(cx + 24 + dr, cy - 3); ctx.stroke();
      } else if (m.type === 'venom_sentinel') {
        // the Serpent Staff, crowned with a pulsing venom orb
        ctx.strokeStyle = '#2c3c22'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx + 12, cy + 12); ctx.lineTo(cx + 14, cy - 12); ctx.stroke();
        ctx.fillStyle = d.glow;
        ctx.globalAlpha = 0.6 + Math.sin(time * 5 + m.x) * 0.3;
        ctx.beginPath(); ctx.arc(cx + 14, cy - 15, 4, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = d.glow; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx + 14, cy - 15, 6, 0.6, 4.2); ctx.stroke();
      } else if (m.type === 'flame_sentinel') {
        // the Flamebrand Katana, sheathed in fire
        ctx.strokeStyle = d.glow; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx + 8, cy + 8); ctx.quadraticCurveTo(cx + 20, cy - 4, cx + 24, cy - 16); ctx.stroke();
        ctx.strokeStyle = '#ffd66b'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx + 9, cy + 6); ctx.quadraticCurveTo(cx + 19, cy - 5, cx + 22, cy - 14); ctx.stroke();
      } else if (m.type === 'frost_sentinel') {
        // twin Frostfang blades, one in each fist
        ctx.strokeStyle = d.glow; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy + 6); ctx.lineTo(cx - 19, cy - 12);
        ctx.moveTo(cx + 9, cy + 6); ctx.lineTo(cx + 19, cy - 12);
        ctx.stroke();
        ctx.strokeStyle = '#e8f8ff'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy + 6); ctx.lineTo(cx - 18, cy - 10);
        ctx.moveTo(cx + 9, cy + 6); ctx.lineTo(cx + 18, cy - 10);
        ctx.stroke();
      }
    }
    ctx.font = 'bold 11px Verdana'; ctx.textAlign = 'center';
    ctx.fillStyle = d.glow;
    label('⭐ ' + d.name, cx, sy - 12);
  } else if (m.type === 'direwolf') {
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.ellipse(cx, cy + 3, 11, 6, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 9, cy - 1, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#3a3f45';
    ctx.beginPath(); ctx.moveTo(cx + 7, cy - 5); ctx.lineTo(cx + 9, cy - 10); ctx.lineTo(cx + 11, cy - 5); ctx.fill();
  } else if (m.type === 'drake') {
    const flap = Math.sin(time * 5 + m.x) * 5;
    ctx.fillStyle = '#7a221a';
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy); ctx.lineTo(cx - 16, cy - 6 - flap); ctx.lineTo(cx - 8, cy + 3); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 16, cy - 6 - flap); ctx.lineTo(cx + 8, cy + 3); ctx.fill();
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.ellipse(cx, cy + 2, 9, 6, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy - 6, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd66b'; ctx.fillRect(cx - 3, cy - 8, 2, 2); ctx.fillRect(cx + 1, cy - 8, 2, 2);
  } else {
    drawHumanoid(sx, sy, d.color, m.type === 'wight' ? '#5adaf0' : '#2a2a2a');
    if (m.type === 'wight') {
      ctx.fillStyle = '#5adaf0';
      ctx.fillRect(cx - 4, cy - 9, 2, 2); ctx.fillRect(cx + 2, cy - 9, 2, 2);
    }
  }
  // hp bar when hurt recently
  if (tickCount - m.hurtAt < 12) {
    ctx.fillStyle = '#8c1f1a'; ctx.fillRect(sx + 3, sy - 8, TILE - 6, 4);
    ctx.fillStyle = '#5ad45a'; ctx.fillRect(sx + 3, sy - 8, (TILE - 6) * m.hp / m.maxhp, 4);
  }
}

function drawPlayer(sx, sy, time) {
  const cx = sx + TILE / 2, cy = sy + TILE / 2;
  if (player.mounted) {
    const asp = ASPECTS[player.dragonAspect] || ASPECTS.ruby;
    const flap = Math.sin(time * 6) * 9;
    const hover = Math.sin(time * 2.2) * 3;
    const dy = -10 + hover;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(cx, sy + TILE + 2, 16, 5, 0, 0, 7); ctx.fill();
    // wings
    ctx.fillStyle = asp.wing;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy + dy); ctx.lineTo(cx - 26, cy + dy - 10 - flap);
    ctx.lineTo(cx - 20, cy + dy - 2 - flap * 0.5); ctx.lineTo(cx - 12, cy + dy + 4); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 5, cy + dy); ctx.lineTo(cx + 26, cy + dy - 10 - flap);
    ctx.lineTo(cx + 20, cy + dy - 2 - flap * 0.5); ctx.lineTo(cx + 12, cy + dy + 4); ctx.fill();
    if (asp.runes) { // wraith: crackling rune-veins across the wing membranes
      ctx.strokeStyle = asp.runes; ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6 + Math.sin(time * 8) * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy + dy + 1); ctx.lineTo(cx - 16, cy + dy - 5 - flap * 0.7); ctx.lineTo(cx - 22, cy + dy - 8 - flap);
      ctx.moveTo(cx + 8, cy + dy + 1); ctx.lineTo(cx + 16, cy + dy - 5 - flap * 0.7); ctx.lineTo(cx + 22, cy + dy - 8 - flap);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // body + tail + neck
    ctx.fillStyle = asp.body;
    ctx.beginPath(); ctx.ellipse(cx, cy + dy + 4, 13, 8, 0, 0, 7); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy + dy + 6); ctx.quadraticCurveTo(cx - 22, cy + dy + 14, cx - 26, cy + dy + 8);
    ctx.quadraticCurveTo(cx - 20, cy + dy + 12, cx - 11, cy + dy + 9); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 12, cy + dy - 3, 5, 7, 0.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 16, cy + dy - 9, 5, 0, 7); ctx.fill();
    if (asp.runes) { // wraith: glowing spine-spikes down the neck and back
      ctx.fillStyle = asp.runes;
      ctx.beginPath();
      ctx.moveTo(cx + 10, cy + dy - 8); ctx.lineTo(cx + 12, cy + dy - 14); ctx.lineTo(cx + 14, cy + dy - 7);
      ctx.moveTo(cx + 4, cy + dy - 3); ctx.lineTo(cx + 6, cy + dy - 9); ctx.lineTo(cx + 8, cy + dy - 2);
      ctx.moveTo(cx - 8, cy + dy + 1); ctx.lineTo(cx - 6, cy + dy - 4); ctx.lineTo(cx - 4, cy + dy + 2);
      ctx.fill();
    }
    if (asp.chains) { // wraith: the Drowned Bastion's chains still cling to it
      ctx.strokeStyle = asp.chains; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy + dy); ctx.quadraticCurveTo(cx, cy + dy + 10, cx + 12, cy + dy - 2);
      ctx.moveTo(cx - 9, cy + dy + 9); ctx.quadraticCurveTo(cx + 2, cy + dy + 13, cx + 13, cy + dy + 4);
      // a snapped length swinging free from the neck
      ctx.moveTo(cx + 14, cy + dy - 4); ctx.lineTo(cx + 16 + Math.sin(time * 3) * 3, cy + dy + 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // horns + eye
    ctx.fillStyle = '#e8d8b0';
    ctx.beginPath(); ctx.moveTo(cx + 13, cy + dy - 12); ctx.lineTo(cx + 11, cy + dy - 18); ctx.lineTo(cx + 15, cy + dy - 13); ctx.fill();
    ctx.fillStyle = asp.eye; ctx.fillRect(cx + 16, cy + dy - 11, 3, 2);
    // rider
    ctx.fillStyle = '#8c1f1a';
    ctx.beginPath(); ctx.ellipse(cx - 1, cy + dy - 6, 5, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#d8b28f';
    ctx.beginPath(); ctx.arc(cx - 1, cy + dy - 14, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#c9a558'; ctx.fillRect(cx - 5, cy + dy - 17, 8, 2);
  } else {
    const tier = player.equip.armor ? player.equip.armor.split('_')[0] : null;
    const tunic = {bronze:'#8a5a2a', iron:'#8a8a92', steel:'#a8b0bc', obsidian:'#3a3a44', valyrian:'#7a4a4a', frostscale:'#3a6ab0'}[tier] || '#4a5a3a';
    drawHumanoid(sx, sy, tunic, '#c9a558');
    if (player.equip.weapon) {
      ctx.strokeStyle = '#d8d8e0'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx + 7, cy + 5); ctx.lineTo(cx + 13, cy - 8); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Verdana'; ctx.textAlign = 'center';
    label('You', cx, sy - 8);
  }
}

function openWorldMap() {
  if (!mmBase || !gameStarted) return;
  const S = 3; // 144 tiles → 432 px
  openModal('🗺️ Kandarin — Realm of Kings', `
    <canvas id="worldMap" width="${W * S * 2}" height="${H * S * 2}"
      style="width:100%;max-width:${W * S}px;display:block;margin:0 auto;border:1px solid #4a3f2f;border-radius:4px;background:#000"></canvas>
    <p style="text-align:center;color:#9a8f78;font-size:11px;margin-top:8px">
      ⚪ you &nbsp;·&nbsp; 🟡 banks, shops &amp; ferries &nbsp;·&nbsp; 🔶 keep towers &nbsp;·&nbsp; colored stars: bosses</p>`);
  const c = document.getElementById('worldMap').getContext('2d');
  c.scale(2, 2); // backing store at 2× for hi-dpi crispness
  c.imageSmoothingEnabled = false;
  c.drawImage(mmBase, 0, 0, W, H, 0, 0, W * S, H * S);
  const dot = (x, y, r, color) => {
    c.fillStyle = color; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(x * S + S / 2, y * S + S / 2, r, 0, 7); c.fill(); c.stroke();
  };
  for (const k in nodes) {
    const n = nodes[k];
    if (['bank', 'anvil', 'range', 'roost', 'throne', 'shop', 'ferry'].includes(n.kind)) dot(n.x, n.y, 3, '#f4e34a');
    if (n.kind === 'tower') dot(n.x, n.y, 3, '#ff5e2a');
  }
  for (const m of mobs) {
    const d = MOB_DEFS[m.type];
    if (d.boss) dot(m.homeX, m.homeY, 4.5, d.glow);
  }
  dot(player.x, player.y, 4.5, '#ffffff');
  // the realm's regions, lettered like a proper chart
  const labels = [
    ['BEYOND THE FROSTWALL', 56, 11], ['THE NORTH', 84, 28], ['WOLF RIDGE', 40, 34],
    ['THE RIVERLANDS', 78, 64], ['THE CAPITOL', 57, 94], ['THE SOUTHERN REACH', 32, 112],
    ['DRAGONMONT', 120, 44], ['THE EMBER KEEP', 119, 72], ['THE DROWNED BASTION', 121, 111],
    ['THE NARROW SEA', 80, 127], ['DORNE', 28, 136], ['SUNSPEAR', 53, 140],
  ];
  c.font = '600 10px Georgia'; c.textAlign = 'center';
  for (const [name, lx, ly] of labels) {
    c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillText(name, lx * S + 1, ly * S + 1);
    c.fillStyle = '#f4e3a1'; c.fillText(name, lx * S, ly * S);
  }
}
mmCanvas.addEventListener('click', openWorldMap);

function drawMinimap(camX, camY, cw, ch) {
  if (!mmBase) return;
  mmCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  mmCtx.imageSmoothingEnabled = false;
  mmCtx.drawImage(mmBase, 0, 0, W, H, 0, 0, 150, 150);
  const s = 150 / W;
  // viewport rect (zoom-aware, centred on the hero; rotation not shown)
  mmCtx.strokeStyle = 'rgba(255,255,255,0.5)'; mmCtx.lineWidth = 1;
  const vw = cw / camZoom / TILE * s, vh = ch / camZoom / TILE * s;
  mmCtx.strokeRect((player.px + 0.5) * s - vw / 2, (player.py + 0.5) * s - vh / 2, vw, vh);
  // player
  mmCtx.fillStyle = '#fff';
  mmCtx.fillRect(player.px * s - 2, player.py * s - 2, 4, 4);
  // npcs
  mmCtx.fillStyle = '#f4e34a';
  for (const n of npcs) mmCtx.fillRect(n.x * s - 1, n.y * s - 1, 3, 3);
}

/* ---------------- Input ---------------- */
const hoverTip = document.getElementById('hoverTip');
canvas.addEventListener('click', e => {
  const r = canvas.getBoundingClientRect();
  const [tx, ty] = screenToTile(e.clientX - r.left, e.clientY - r.top);
  if (inB(tx, ty)) clickWorld(tx, ty);
});
canvas.addEventListener('wheel', e => {
  if (!gameStarted) return;
  e.preventDefault();
  camZoomT = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camZoomT * Math.exp(-e.deltaY * 0.0012)));
}, {passive: false});
canvas.addEventListener('mousemove', e => {
  if (!gameStarted) return;
  const r = canvas.getBoundingClientRect();
  const [tx, ty] = screenToTile(e.clientX - r.left, e.clientY - r.top);
  let tip = '';
  const mob = mobs.find(m => !m.dead && m.x === tx && m.y === ty);
  const npc = npcs.find(n => n.x === tx && n.y === ty);
  const node = nodes[key(tx, ty)];
  if (mob) {
    const d = MOB_DEFS[mob.type];
    tip = (player.mounted ? '🔥 Dragonfire: ' : '⚔️ Attack: ') + d.name + ' (level ' + d.lvl + ')';
  } else if (npc) tip = '💬 Talk to ' + npc.name;
  else if (node && node.kind !== 'gate') {
    const nd = NODE_DEFS[node.kind];
    if (node.kind === 'shop') tip = '🪙 Trade at ' + SHOPS[node.shop].name;
    else if (node.kind === 'ferry') tip = '⛵ Board the ferry (' + FERRY_FARE + ' gold)';
    else tip = node.dead ? nd.name + ' (depleted)' : nd.verb + ' ' + nd.name + (nd.lvl ? ' (lvl ' + nd.lvl + ' ' + nd.skill + ')' : '');
  }
  hoverTip.style.display = tip ? 'block' : 'none';
  hoverTip.textContent = tip;
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (!gameStarted) return;
  if (e.key === 'm' || e.key === 'M') toggleMount();
  if (e.key.startsWith('Arrow')) { keysHeld[e.key] = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => { delete keysHeld[e.key]; });
window.addEventListener('blur', () => { for (const k in keysHeld) delete keysHeld[k]; });
document.getElementById('mountBtn').onclick = toggleMount;
document.getElementById('helpBtn').onclick = openHelp;
window.addEventListener('beforeunload', saveGame);

/* ---------------- Boot ---------------- */
function newGame() {
  initSkills();
  player.inv = []; player.bank = [];
  player.equip = {weapon:null, armor:null};
  player.quests = {q1:0, q2:0, q3:0, q4:0, q5:0, q3burned:0, throne:false, slain:{}};
  player.dragonTamed = false; player.mounted = false; player.dragonAspect = 'ruby';
  player.x = 40; player.y = 43; player.px = 40; player.py = 43;
  addItem('coins', 25, true);
  addItem('trout', 3, true);
  addItem('bronze_sword', 1, true);
  tickCount = 0;
  startGame(true);
}
function startGame(fresh) {
  document.getElementById('title').style.display = 'none';
  gameStarted = true;
  player.hp = Math.min(player.hp, maxHp());
  renderTab(); renderHud(); updateMountBtn(); updateCoinHud();
  if (fresh) {
    log('<span class="lvl">⚔ Welcome to KANDARIN. You wake outside the gates of Wolf Ridge with a rusty sword and three fish.</span>');
    log('<span class="sys">Click to move. Lady Maera awaits inside the town — she has work for you. Press ❓ Help any time.</span>');
  } else {
    log('<span class="lvl">⚔ Welcome back to KANDARIN. The realm remembers you.</span>');
  }
  log('<span class="chat"><b>Snowbastard92:</b> welcome to world 3 :)</span>');
}

genWorld();
initSkills();
buildTerrain();
buildMinimap();
resize();

const hasSave = !!(localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_SAVE_KEY));
if (hasSave) document.getElementById('btnContinue').style.display = '';
document.getElementById('btnContinue').onclick = () => { if (loadGame()) startGame(false); else newGame(); };
document.getElementById('btnNew').onclick = () => {
  if (hasSave && !confirm('Start a fresh saga? Your saved progress will be overwritten.')) return;
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(LEGACY_SAVE_KEY);
  newGame();
};

setInterval(tick, TICK_MS);
requestAnimationFrame(frame);
