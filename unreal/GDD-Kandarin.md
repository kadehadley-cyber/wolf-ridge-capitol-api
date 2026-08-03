# Kandarin: Realm of Kings — Game Design Document (for the Unreal rebuild)

This is the complete rule set of the shipped browser game, formula by formula,
so the Unreal version plays identically. All tables referenced live in
`DataTables/`. Randomness: `R(a,b)` = uniform integer in [a,b].

## 1. Time

Everything advances on a **600 ms game tick**. Movement, combat swings,
gathering attempts, favor drain, respawns and regen all happen on tick
boundaries; rendering interpolates between them.

## 2. Skills & XP (16 skills — `DT_Skills`, `DT_XPTable`)

- Levels 1–99 on the classic RuneScape curve (`DT_XPTable` is authoritative):
  `points += floor(L + 300 · 2^(L/7))` per level, `XP(L) = floor(points/4)`.
- XP cap 200,000,000. Hitpoints starts at level 10; everything else at 1.
- **Combat level** = `floor(0.25·(Defence + Hitpoints + floor((Faith + GodsHand)/2)) + 0.325·max(Attack+Strength, 1.5·Archery, 1.5·Sorcery))`, min 3.

## 3. Combat

- Styles: melee (reach 1 tile), archery (reach 6, consumes 1 arrow/swing),
  sorcery (reach 7, no ammo). Player attack cooldown: 3 ticks (2 mounted).
- **Class power**: equipped weapon's Power if its CombatClass matches the
  style, else 1 (melee) / 2 (ranged, sorcery — improvised).
- **Max hit** (before boosts):
  - melee: `max(1, floor(1 + Strength·0.12 + power·0.6))`
  - archery: `max(1, floor(1 + Archery·0.12 + power·0.6))`
  - sorcery: `max(1, floor(1 + Sorcery·0.11 + power·0.6))`
  - Gods' Hand multipliers apply to the base then floor (see §6).
- **Player hit chance** vs mob: `clamp(acc/(acc+mobDef), 0.15, 0.95)` where
  `acc = styleLevel + classPower`. Damage on hit: `1 + R(0, maxHit-1)`,
  clamped to remaining HP.
- **Mob hit chance**: `clamp(mobAtk/(mobAtk + Defence + armorValue), 0.10, 0.90)`,
  damage `1 + R(0, mobMaxHit-1)`. Stone Skin reduces incoming damage 20% (§6).
- **Combat XP per damage dealt**: melee → Attack 2×dmg + Strength 2×dmg;
  archery → Archery 4×dmg; sorcery → Sorcery 4×dmg. Always: Defence 1×dmg,
  Hitpoints 1.33×dmg.
- **Death**: at 0 HP, respawn at the Capitol (marker `npc_pyros` area,
  tile 57,90) with full HP. No item loss (gentle death).
- Mob respawn: 25 ticks (bosses 300). Aggro mobs attack on sight (wights,
  drakes, bosses); others retaliate.
- Natural regen: 1 HP per ~17 ticks, faster with Faith
  (`period = 20 - floor(Faith/10)`, min 8).

## 4. Gathering & artisan (`DT_ResourceNodes`, `DT_Items`)

- Click a node → walk adjacent → attempt per 4 ticks: success chance
  `clamp(0.35 + (skillLevel - ReqLevel)·0.02, 0.35, 0.9)` → LootItemID + XP;
  node depletes, respawns after RespawnTicks.
- Cooking at fires/ranges: burn chance `clamp(0.45 - (Cooking - ReqLevel)·0.025, 0.05, 0.6)`.
- Smithing at anvils: smelt bars from ores, forge melee weapons/armor/arrows
  (15 arrows per bronze bar). Tier gates per `DT_Items.ReqLevel`.
- Bones: bury for Faith XP (`FaithXP` column) **and +4 Gods' Hand favor**.

## 5. Slayer 💀 (`DT_SlayerTasks`, NPC: Slayer Master Kessa, Capitol, tile 61,96)

- Kessa assigns a contract when the player has none: filter `DT_SlayerTasks`
  by `combatLevel ≥ MinCombatLevel`, pick a random eligible row, roll count
  `R(MinCount, MaxCount)`.
- Each on-task kill: **Slayer XP = round(mob HP × 0.8)** (the `SlayerXP`
  column) and decrements the contract.
- On completion: bonus Slayer XP `= count × mobLevel`, gold
  `= count × mobLevel × 2`, and the completion tally increments. New contract
  requires returning to Kessa.
- Contract state (mob, remaining, total, tasks done) persists in the save.

## 6. Gods' Hand ⚡ (`DT_GodsHandBoosts`)

Prayer-style toggles. UI: a dedicated panel (hotkey **B**).

- **Favor pool** = `20 + GodsHandLevel`. Active boosts drain
  `FavorDrainPerTick` each (sums across active boosts).
- **XP**: 3 × favor drained (continuous, floored into whole XP as it accrues).
- At 0 favor all boosts switch off ("the gods fall silent").
- **Recharge**: +0.1/tick while no boost is active; +4 per bones buried;
  full restore from Grand Maester Pyros (who also heals).
- Effects (multiplicative where stacked):
  | Boost | Lvl | Effect |
  |---|---|---|
  | Warrior's Fury | 1 | +15% melee max hit |
  | Hawk's Eye | 10 | +15% archery max hit |
  | Mage's Wrath | 20 | +15% sorcery max hit |
  | Stone Skin | 30 | incoming damage ×0.8 (floor) |
  | Blood Pact | 45 | heal `max(1, ceil(dmg/4))` per damaging hit |
  | Wrath of the Seven | 60 | ALL damage ×1.25 — includes dragonfire |

## 7. Dragonriding 🐉

- Unlocked by quest **Blood of the Dragon** (5 smoked salmon to Rhaella).
- Mount/dismount anywhere (M); flight ignores terrain; dismount needs
  walkable ground. Speed: `3 + min(3, floor(level/20))` tiles/tick (walking 2).
- Flight XP: 0.4/tile. **Dragonfire** (cooldown 2 ticks, range 5):
  damage `2 + R(0, 2 + floor(level·0.3))`, ×2 vs wights, ×1.25 with Wrath of
  the Seven; splash 50% to adjacent mobs; triple XP on dragonfire kills
  (as Dragonriding XP = 3 × mob HP).
- **Ember Keep raid**: five towers (HP 40) shoot ballista bolts at fliers
  (~4 dmg, dodge chance scales with level). Tower kill: 150 XP; all five →
  quest **Fire and Blood**. Towers respawn (600 ticks) — repeatable.

## 8. Quests (`DT_Quests`)

1. **Winter Is Coming** — 10 pine logs + 5 cooked trout → Lady Maera.
   400 gold, 500 Woodcutting XP, 500 Cooking XP.
2. **Blood of the Dragon** — 5 smoked salmon → Rhaella. Dragon bond, 500 Dragonriding XP.
3. **Fire and Blood** — raze the 5 Ember Keep towers. Valyrian Steel Sword, 2000 Dragonriding XP.
4. **Thrones of the Elements** — fell all four Throne Guardians. 2500 gold, 1500 Dragonriding XP.
5. **The Chained Wraith** — slay the wraith on the Drowned Bastion.
6. Epilogue: sit the **Ember Throne** (requires quest 3) → Monarch of the Realm.

## 9. Economy (`DT_Shops`, `DT_Items`)

- Three shops (stock in `DT_Shops`); buy at Price, sell anything with Value
  at **40%** anywhere a shop is open. Banks store unlimited stacks.
- Ferry between the Capitol docks and Dorne: **25 gold** per crossing.

## 10. Bosses (`DT_Mobs` bBoss, positions in `DT_WorldMarkers`)

Four elemental **Throne Guardians** (Gilded 60 / Venom 65 / Flame 70 /
Frost 75) each visibly wield their class's max-tier weapon and drop it (30%)
plus a **Dragon Aspect** mount reskin (100% first kill). **The Chained Wraith**
(90) on the fly-only Drowned Bastion drops the Wraith aspect and the Runed
Chain-Glaive. Boss respawn: 300 ticks.

## 11. Construction 🏠 (`DT_Construction`, estate markers in `DT_WorldMarkers`)

A deeded estate plot in the Riverlands (tiles 47-57 × 46-54, cleared at world
gen; deed-post/house at 52,50). Interacting opens the build menu, which lists
**exactly which materials each project needs** (have/need per item).

- Building: requires Construction level, the prerequisite project, and all
  materials in inventory; consumes them, grants the project's XP.
- **House tiers**: Wooden Cabin (1) → Timber Hall (15) → Stone Manor (35) →
  Great Keep (60). The house mesh grows/upgrades per tier; tiers gate amenities.
- **Fishing pools**: Fishing Pool (Construction 10) — a personal fishing node
  at 49,52 (trout-tier, 40 Fishing XP/catch); Stocked Pool (40) upgrades it
  (salmon-tier, needs Fishing 30, 85 XP/catch).
- **Unique trees**, plantable only here: Goldleaf (Construction 20; chop WC 30,
  90 XP, Goldleaf Logs), Silverbark (45; WC 50, 150 XP), Heartwood (70; WC 65,
  210 XP). They respawn like wild trees; their logs are premium trade goods.
- Estate state (house tier, pool tier, planted trees) persists in the save and
  is re-synced into world nodes on load.

## 12. Persistence

Save on every meaningful action + on quit: skills, HP, inventory, bank,
equipment, style, position, dragon state + aspect, quest flags, slayer
contract, favor, active boosts, tick count.
