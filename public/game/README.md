# KANDARIN: Realm of Kings 👑

A browser RPG that plays like classic RuneScape — point-and-click, 600 ms game
ticks, 15 skills with the real exponential 1–99 XP curve — set in a Game of
Thrones-inspired realm, with **Dragonriding** as a first-class skill.

**Rendered in real 3D.** A hand-written WebGL2 engine draws a sun-lit landscape
with true elevation (rolling hills, raised walls, mountains, sunken water),
per-pixel lighting with ambient occlusion, an animated water surface, sky and
atmospheric fog, and a cinematic vignette. The detailed hand-drawn characters
are composited as lit, shadow-cast billboards standing in the 3D world (a
"2.5D" pipeline). A close third-person **chase camera** follows you Dark
Souls-style; press **V** for a top-down view. If a browser can't do WebGL2 the
game automatically falls back to the 2D renderer.

**No build, no server, no dependencies.** Open `index.html` in any browser and
play. Progress autosaves to `localStorage`. On the deployed Worker it's served
as static assets at **`/game/`**.

```bash
# from the repo root — any static server works, or just double-click index.html
cd public/game && python3 -m http.server 8080
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
| **The Narrow Sea** | The Sunspit Strait severs the south — no bridge crosses it. Take the ferry (25 gold) south of the Capitol, or fly |
| **Dorne** | The desert across the strait: **Sunspear** (bank, fire, the Sunspear Bazaar), buried dragonglass and Valyrian veins, Dornish sellswords |
| **The Drowned Bastion** | An islet in the southern sea no bridge reaches — only a dragon's wings. Home of the level 90 **Chained Wraith** |

## Skills (levels 1–99, RuneScape XP table)

Combat: **Attack · Strength · Defence · Hitpoints · Archery · Sorcery · Faith**
Gathering: **Woodcutting · Mining · Fishing**
Artisan: **Smithing · Cooking**
Support: **Slayer** 💀 (contracts from Slayer Master Kessa — kill N of a monster
for XP and bounties) · **Gods' Hand** ⚡ (prayer-style toggleable boosts — extra
damage, stone skin, life-steal — that drain favor while active; press B)
And the crown of them all: **Dragonriding**

Every combat class has its own RuneScape-style gear ladder, and a weapon only
lends power to its own class:

| Class | 1 | 10–20 | 30–40 | 50 | 60 (boss drop) |
|---|---|---|---|---|---|
| **Melee** (Attack) | bronze | iron · steel | obsidian | Valyrian steel | **Flamebrand Katana** (Flame Sentinel) / **Runed Chain-Glaive** (Chained Wraith) |
| **Archery** | shortbow | ironwood bow | weirwood bow | — | **Sunforged Bow** (Gilded Sentinel) |
| **Sorcery** | apprentice staff | acolyte staff | pyromancer staff | — | **Serpent Staff** (Venom Sentinel) |
| **Armor** (Defence) | bronze | iron · steel | obsidian | Valyrian plate | **Frostscale Armor** (Frost Sentinel) |

Melee gear and arrows are smithable at any anvil; bows and staves come from
the **stores** — the Wolf Ridge General Store (starter), the Capitol's Crown
Armory (mid tiers) and the Sunspear Bazaar in Dorne (lvl 30–40 wares). Shops
buy your goods at 40% value. Bury bones for Faith (faster natural healing).
Eat cooked fish to heal.

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
Keep) and **Frost** (lvl 75, beyond the Frostwall). Each wields the max-tier
gear of its combat class — you can see the bow, staff, katana and twin blades
on the bosses themselves — and drops both that gear and a **Dragon Aspect**
that recolors your drake in its element.

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
