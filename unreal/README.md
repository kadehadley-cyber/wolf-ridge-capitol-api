# Kandarin → Unreal Engine import kit

Everything in this folder is generated from the live game's data, so it is the
single source of truth for rebuilding **Kandarin: Realm of Kings** in Unreal
Engine 5 at Dragon Age fidelity. You bring the engine and the art packs; this
kit brings the entire game design as data Unreal imports natively.

```
unreal/
├── DataTables/        12 CSVs — every design table (items, mobs, drops, shops,
│                      quests, skills, XP curve, slayer tasks, boosts, markers)
├── Source/
│   └── KandarinTypes.h   FTableRowBase structs matching every CSV, documented
├── GDD-Kandarin.md    The full game design doc: every formula and system rule
└── README.md          This file
```

## 1. Project setup (once)

1. Install **UE 5.4+** via the Epic Games Launcher.
2. New project → Games → **Third Person** template → C++ (or Blueprint and add
   a C++ class later — the header needs a C++ module; there's a pure-Blueprint
   path below).
3. Copy `Source/KandarinTypes.h` into `Source/<YourModule>/` and compile
   (Ctrl+Alt+F11 for Live Coding, or rebuild in your IDE).

## 2. Import the DataTables (5 minutes)

For each CSV in `DataTables/`, in the Content Browser: **Import** → pick the
CSV → *Import As: DataTable* → choose the matching row struct:

| CSV | Row struct |
|---|---|
| DT_XPTable.csv | `KandarinXPRow` |
| DT_Skills.csv | `KandarinSkillRow` |
| DT_Items.csv | `KandarinItemRow` |
| DT_Mobs.csv | `KandarinMobRow` |
| DT_MobDrops.csv | `KandarinDropRow` |
| DT_ResourceNodes.csv | `KandarinNodeRow` |
| DT_Shops.csv | `KandarinShopRow` |
| DT_Quests.csv | `KandarinQuestRow` |
| DT_SlayerTasks.csv | `KandarinSlayerTaskRow` |
| DT_GodsHandBoosts.csv | `KandarinBoostRow` |
| DT_WorldMarkers.csv | `KandarinMarkerRow` |
| DT_Regions.csv | `KandarinRegionRow` |

**Pure-Blueprint alternative**: create a Blueprint *Structure* asset per table
with member names identical to the CSV headers, then import against those.

## 3. Get the art (Fab — free packs first)

| Need | Fab pack (free unless noted) |
|---|---|
| Player knight + bosses | **Paragon** heroes: Greystone, Kwang (knights), Sevarog (Chained Wraith vibes), Countess |
| Animations | **Game Animation Sample Project** (~500 mocap anims), retarget with IK Retargeter |
| Wolf Ridge / Frostwall | **Infinity Blade: Ice Lands** |
| Riverlands / Capitol | **Infinity Blade: Grass Lands**, **Infinity Blade: Castle** |
| Dragonmont / Ember Keep | **Infinity Blade: Fire Lands** |
| Ground materials everywhere | **Quixel Megascans** (free to use within Unreal) |
| Water / Narrow Sea | Built-in **Water** plugin (enable it) |
| Dragon mount | Search Fab "dragon rideable" (paid, ~$20–60) or animate a static dragon first |
| Melee combat feel | Optional paid packs: search "melee combat system" (~$30–100) |

`DT_Regions.csv` maps each game region to a suggested pack.

## 4. Build the world

- The world is a **144×144 tile grid** (`DT_WorldMarkers.csv` uses these
  coordinates). Suggested scale: **1 tile = 400 unreal units** → the realm is
  576 m × 576 m, a comfortable open-world Landscape.
- Sculpt a Landscape per region (bounds in `DT_Regions.csv`), keep the
  layout: Wolf Ridge north-west, Capitol center-south, the strait cutting off
  Dorne (no land path — ferry or dragon only), Dragonmont east across water.
- Place a marker actor for every row of `DT_WorldMarkers.csv` (an editor
  utility Blueprint that spawns them from the table takes ~20 lines and saves
  hours): banks, anvils, cooking fires, the three shops, two ferry docks, the
  Dragon Roost, the Ember Throne, five Ember Keep towers, four NPCs
  (incl. Slayer Master Kessa) and five boss lairs.

## 5. Implement the systems

`GDD-Kandarin.md` has every formula (XP curve, hit chance, max hit, favor
drain, slayer bounties, ferry fare, shop sellback...) exactly as the live game
runs them — implement in Blueprints against the DataTables. Suggested order:

1. **Core loop**: 600 ms game tick (timer), click-to-move (NavMesh), skills +
   XP (`DT_XPTable` lookup), gathering on `DT_ResourceNodes`.
2. **Combat**: stats from `DT_Mobs`, hit/max-hit formulas from the GDD, drops
   from `DT_MobDrops`, gear gates from `DT_Items`.
3. **Economy**: banks, `DT_Shops` buy/sell (40% sellback).
4. **Slayer** 💀: Kessa dialogue → roll a `DT_SlayerTasks` row vs combat level
   → track kills → pay bounty.
5. **Gods' Hand** ⚡: favor pool `20 + level`, toggles from
   `DT_GodsHandBoosts`, drain per tick, effects in the damage pipeline.
6. **Dragonriding**: mount toggle, flight movement mode, dragonfire projectile,
   Ember Keep tower raid, boss aspects.

## 6. Licensing note

Fab packs marked **"UE-only"** (all Infinity Blade + Paragon content) may only
be used in Unreal Engine projects — fine for this build, but they can't be
exported to the browser game. Standard-license and CC0 assets can go both ways.
