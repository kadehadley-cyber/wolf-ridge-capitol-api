# EMBERFALL — A Game of Wolves & Dragons 🐉

A browser RPG that plays like classic RuneScape — point-and-click, 600 ms game
ticks, 13 skills with the real exponential 1–99 XP curve — set in a Game of
Thrones-inspired realm, with **Dragonriding** as a first-class skill.

**No build, no server, no dependencies.** Open `index.html` in any browser and
play. Progress autosaves to `localStorage`.

```bash
# from the repo root — any static server works, or just double-click index.html
cd game && python3 -m http.server 8080
# → http://localhost:8080
```

## The realm

| Region | What's there |
|---|---|
| **Wolf Ridge** | Your snowy home town: bank, forge, cooking fire, Lady Maera's quest |
| **The Riverlands** | Pines, copper, river fishing, bandits on the kingsroad |
| **The Capitol** | The southern city — bank, forge, Grand Maester Pyros (free healing), and the **Ember Throne** |
| **The North & the Frostwall** | Ironwood trees, iron ore, direwolves; a great wall with one gate |
| **Beyond the Frostwall** | Weirwood trees, wights (weak to dragonfire), the **Frost Sentinel** |
| **Dragonmont** | Volcanic isle: dragonglass, Valyrian ore, wild drakes, the Dragon Roost, and the **Ember Keep** raid |
| **The Drowned Bastion** | An islet in the southern sea no bridge reaches — only a dragon's wings. Home of the level 90 **Chained Wraith** |

## Skills (levels 1–99, RuneScape XP table)

Combat: **Attack · Strength · Defence · Hitpoints · Archery · Sorcery · Faith**
Gathering: **Woodcutting · Mining · Fishing**
Artisan: **Smithing · Cooking**
And the thirteenth: **Dragonriding**

Gear tiers: bronze → iron → castle-forged steel → obsidian → Valyrian steel,
all smithable at any anvil. Arrows for Archery are smithed too. Bury bones for
Faith (faster natural healing). Eat cooked fish to heal.

## Dragonriding 🐉

1. Complete **Winter Is Coming** (Lady Maera, Wolf Ridge).
2. Bring Dragonkeeper Rhaella on Dragonmont 5 smoked salmon — **Blood of the
   Dragon** bonds you to a red drake.
3. Press **M** anywhere to mount. Flying is 1.5–3× walking speed, crosses
   water/mountains/walls, and earns Dragonriding XP per tile.
4. Click any monster from the air to breathe **dragonfire** (AOE splash, double
   damage to wights, triple XP).
5. **Fire and Blood**: raze the Ember Keep's five towers with dragonfire while
   its ballistae shoot back — the best Dragonriding XP in the game, repeatable.

Higher Dragonriding levels grant flight speed, hotter flame, and ballista
dodging.

## Endgame: Throne Guardians & Dragon Aspects

Four elemental bosses guard the corners of the realm — **Gilded** (lvl 60,
southwest barrows), **Venom** (lvl 65, deep south), **Flame** (lvl 70, Ember
Keep) and **Frost** (lvl 75, beyond the Frostwall). Each drops a **Dragon
Aspect** that recolors your drake in its element.

Slay all four for **Thrones of the Elements**, then fly to the Drowned Bastion
and break **The Chained Wraith** (lvl 90) for the black-and-viridian Wraith
aspect (rune-veined wings) and the Runed Chain-Glaive, the strongest weapon in
the game. Finally, sit the **Ember Throne** in the Capitol to claim the realm.

## Controls

- **Click** — walk / gather / fight / talk (hover for a tooltip)
- **M** — mount/dismount your drake
- **Esc** — close windows
- Sidebar tabs: 🎒 Pack · 📜 Skills (click one for its guide) · ⚔️ Equipment & combat style · ❗ Quests

## Notes on the "MMO" part

This is the single-player client. World state is deterministic from a fixed
seed, the tick loop is authoritative-server-shaped (600 ms ticks, all game
logic in `tick()`), and other "players" you see are simulated ambience. Real
multiplayer would slot in by moving `tick()` behind the repo's existing
Cloudflare Worker (Durable Object per region, WebSocket per client) — the
client already renders remote players' positions and chat.

Art direction (title screen, palettes, boss designs) follows the reference
images in `assets/`.
