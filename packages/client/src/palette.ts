// Placeholder colours until there is real art.
import { BuildingType, Res } from '@sett/sim';

export const RES_COLOR: Record<number, number> = {
  [Res.Lumber]: 0x8b5a2b,
  [Res.Plank]: 0xe3c07a,
  [Res.Stone]: 0x9aa0a6,
  [Res.Fish]: 0x5fb3d9,
  [Res.Wheat]: 0xe6c84f,
  [Res.Flour]: 0xf4efe4,
  [Res.Water]: 0x3d7fe0,
  [Res.Bread]: 0xc77d3a,
  [Res.Coal]: 0x2b2b2e,
  [Res.IronOre]: 0xa8582a,
  [Res.GoldOre]: 0xd9a21b,
  [Res.Iron]: 0xb9c2cc,
  [Res.Gold]: 0xffd23f,
  [Res.Axe]: 0x7a8fa3,
  [Res.Pick]: 0x8d9aa8,
  [Res.Shovel]: 0x6f8590,
  [Res.Rod]: 0x9db0bf,
  [Res.Scythe]: 0x84939f,
  [Res.Saw]: 0xa9b6c2,
  [Res.Hammer]: 0x6a7a89,
};

/** The flecks that show ore under a mountain, by kind (index OreKind). */
export const ORE_COLOR: number[] = [0x000000, 0xb7bcc4, 0x2b2b2e, 0xc2602b, 0xf2c744];

export const BUILDING_COLOR: Record<number, number> = {
  [BuildingType.Lumberjack]: 0x3f9142,
  [BuildingType.Sawmill]: 0xd9822b,
  [BuildingType.Storage]: 0x3b6fd4,
  [BuildingType.Stonecutter]: 0x7d8590,
  [BuildingType.Castle]: 0xb23a48,
  [BuildingType.Forester]: 0x2e7d5b,
  [BuildingType.Fisher]: 0x3aa0b8,
  [BuildingType.Farm]: 0xc9b037,
  [BuildingType.Well]: 0x5b7fd1,
  [BuildingType.Mill]: 0xd8d2c4,
  [BuildingType.Baker]: 0xc77d3a,
  [BuildingType.StoneMine]: 0x6b5f57,
  [BuildingType.CoalMine]: 0x3a3a3e,
  [BuildingType.IronMine]: 0x8a4a28,
  [BuildingType.GoldMine]: 0xb88a1a,
  [BuildingType.IronSmelter]: 0x7a8794,
  [BuildingType.GoldSmelter]: 0xd4a62a,
  [BuildingType.Toolmaker]: 0x5f7a96,
};

export const BUILDING_LABEL: Record<number, string> = {
  [BuildingType.Lumberjack]: 'J',
  [BuildingType.Sawmill]: 'W',
  [BuildingType.Storage]: 'S',
  [BuildingType.Stonecutter]: 'C',
  [BuildingType.Castle]: 'K',
  [BuildingType.Forester]: 'F',
  [BuildingType.Fisher]: 'Fi',
  [BuildingType.Farm]: 'Fa',
  [BuildingType.Well]: 'Wl',
  [BuildingType.Mill]: 'M',
  [BuildingType.Baker]: 'B',
  [BuildingType.StoneMine]: 'Mn',
  [BuildingType.CoalMine]: 'Co',
  [BuildingType.IronMine]: 'Fe',
  [BuildingType.GoldMine]: 'Au',
  [BuildingType.IronSmelter]: 'Is',
  [BuildingType.GoldSmelter]: 'Gs',
  [BuildingType.Toolmaker]: 'Tm',
};

/** The letter over a new worker's head as he walks to his building. */
export const WORKER_LETTER: Record<number, string> = {
  [BuildingType.Lumberjack]: 'L',
  [BuildingType.Sawmill]: 'W',
  [BuildingType.Stonecutter]: 'S',
  [BuildingType.Forester]: 'F',
  [BuildingType.Fisher]: 'Fi',
  [BuildingType.Farm]: 'Fa',
  [BuildingType.Well]: 'Wl',
  [BuildingType.Mill]: 'M',
  [BuildingType.Baker]: 'B',
  [BuildingType.StoneMine]: 'Mn',
  [BuildingType.CoalMine]: 'Co',
  [BuildingType.IronMine]: 'Fe',
  [BuildingType.GoldMine]: 'Au',
  [BuildingType.IronSmelter]: 'Is',
  [BuildingType.GoldSmelter]: 'Gs',
  [BuildingType.Toolmaker]: 'Tm',
};

export const BUILDING_NAME: Record<number, string> = {
  [BuildingType.Lumberjack]: 'Lumberjack',
  [BuildingType.Sawmill]: 'Sawmill',
  [BuildingType.Storage]: 'Storage',
  [BuildingType.Stonecutter]: 'Stonecutter',
  [BuildingType.Castle]: 'Castle',
  [BuildingType.Forester]: 'Forester',
  [BuildingType.Fisher]: 'Fisher',
  [BuildingType.Farm]: 'Farm',
  [BuildingType.Well]: 'Well',
  [BuildingType.Mill]: 'Mill',
  [BuildingType.Baker]: 'Baker',
  [BuildingType.StoneMine]: 'Stone mine',
  [BuildingType.CoalMine]: 'Coal mine',
  [BuildingType.IronMine]: 'Iron mine',
  [BuildingType.GoldMine]: 'Gold mine',
  [BuildingType.IronSmelter]: 'Iron smelter',
  [BuildingType.GoldSmelter]: 'Gold smelter',
  [BuildingType.Toolmaker]: 'Toolmaker',
};

/** Terrain colours; grass and mountain blend with height. */
export const TERRAIN = {
  water: 0x2c68b0,
  sand: 0xd8c488,
  grassLow: 0x5a9a3c,
  grassHigh: 0x8aa84c,
  rock: 0x8a7a66,
  snow: 0xeceff4,
} as const;

export const OBJECT_COLORS = {
  trunk: 0x6b4a2b,
  leafDark: 0x2f6b2f,
  leafLight: 0x4f9a43,
  rock: 0x8b8f96,
  worker: 0xffb347,
} as const;

export const COLORS = {
  background: 0x16324f,
  road: 0xb89b6a,
  roadEdge: 0x6e5a3a,
  flag: 0xf2f2f2,
  carrier: 0xffd23f,
  carrierArriving: 0x7bdff2,
  builder: 0xff6b6b,
  hover: 0xffffff,
  selected: 0xffe14d,
  ghostOk: 0x7cff8a,
  ghostBad: 0xff6b6b,
} as const;
