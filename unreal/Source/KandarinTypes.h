// KandarinTypes.h — FTableRowBase structs matching the CSVs in ../DataTables/.
// Drop this into your project's Source/<Module>/ folder (a C++ project or a
// Blueprint project with a C++ module added). Each struct's UPROPERTY names
// match the CSV column headers exactly, so importing is: right-click the CSV
// in the Content Browser → Import as DataTable → pick the matching row struct.
//
// Pure Blueprint alternative: recreate each struct as a Blueprint Structure
// asset with identical member names, then import the same CSVs against it.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "KandarinTypes.generated.h"

/** Cumulative XP required for each level, 1-99 (classic RuneScape curve). */
USTRUCT(BlueprintType)
struct FKandarinXPRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Level = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int64 XP = 0;
};

/** One of the 15 skills. Category: Combat / Gathering / Artisan / Support / Signature. */
USTRUCT(BlueprintType)
struct FKandarinSkillRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Icon;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Category;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 StartLevel = 1;
};

/** Every item: gear, resources, food, quest drops. Slot empty = not equippable. */
USTRUCT(BlueprintType)
struct FKandarinItemRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Icon;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Slot;          // weapon / armor / ""
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString CombatClass;   // melee / archery / sorcery
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 ReqLevel = 0;    // in the class skill (weapons) or Defence (armor)
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Power = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Armor = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 HealAmount = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 FaithXP = 0;     // bones: Faith XP on burial (also +4 favor)
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Value = 0;       // shop price; sellback is 40%
	UPROPERTY(EditAnywhere, BlueprintReadOnly) bool bStackable = false;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString DragonAspect;  // mount reskin id, if a boss aspect drop
};

/** Monsters. SlayerXP = per-kill XP while on a Slayer contract for this mob. */
USTRUCT(BlueprintType)
struct FKandarinMobRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Level = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 HP = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Attack = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Defence = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 MaxHit = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) bool bBoss = false;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) bool bAggro = false;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Color;         // hex, art direction
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString GlowColor;     // hex, boss element glow
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 RespawnTicks = 25;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 SlayerXP = 0;
};

/** Loot lines, several per mob. Chance is 0-1. */
USTRUCT(BlueprintType)
struct FKandarinDropRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString MobID;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString ItemID;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 MinQty = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 MaxQty = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) float Chance = 1.f;
};

/** Gatherable / interactable world nodes (trees, rocks, fishing spots, stations). */
USTRUCT(BlueprintType)
struct FKandarinNodeRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Verb;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Skill;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 ReqLevel = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 XP = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString LootItemID;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 RespawnTicks = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 HP = 0;          // Ember Keep towers only
};

/** Shop stock lines. Price is the buy price; sellback anywhere is 40% of Value. */
USTRUCT(BlueprintType)
struct FKandarinShopRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString ShopID;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString ShopName;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString ItemID;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Stock = 10;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 Price = 0;
};

USTRUCT(BlueprintType)
struct FKandarinQuestRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Title;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Description;
};

/** Slayer contract templates. Count is rolled MinCount..MaxCount; completion pays
    BonusXPPerLevel * count * moblevel Slayer XP and GoldPerLevel * count * moblevel gold. */
USTRUCT(BlueprintType)
struct FKandarinSlayerTaskRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString MobID;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 MinCombatLevel = 3;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 MinCount = 8;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 MaxCount = 14;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 BonusXPPerLevel = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 GoldPerLevel = 2;
};

/** Gods' Hand toggleable boosts (prayer-style). Favor pool = 20 + skill level;
    drains FavorDrainPerTick per game tick while on; XP = 3 per favor drained. */
USTRUCT(BlueprintType)
struct FKandarinBoostRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Icon;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 ReqLevel = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) float FavorDrainPerTick = 0.3f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Effect;        // MeleeDamagePct etc.
	UPROPERTY(EditAnywhere, BlueprintReadOnly) float EffectValue = 0.f;
};

/** Construction (estate) build projects. Materials is "itemid:qty;itemid:qty".
    EffectKind House/Pond upgrades that amenity to EffectValue (a tier number);
    EffectKind Tree plants the named unique tree (EffectValue is its id). */
USTRUCT(BlueprintType)
struct FKandarinBuildRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Icon;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 ReqLevel = 1;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 XP = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Prerequisite;  // build row that must be done first
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Materials;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString EffectKind;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString EffectValue;
};

/** Placed things: NPCs, bosses, banks, anvils, shops, ferries, towers, throne.
    TileX/TileY are 144x144 world-grid coordinates; multiply by your tile size
    (suggested 400 uu) for world placement. */
USTRUCT(BlueprintType)
struct FKandarinMarkerRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Kind;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Label;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 TileX = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) int32 TileY = 0;
};

USTRUCT(BlueprintType)
struct FKandarinRegionRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString Bounds;
	UPROPERTY(EditAnywhere, BlueprintReadOnly) FString SuggestedFabPack;
};
