/** Combat stat shapes for map battle session setup (decoupled from battle-poc app). */

export type CombatStats = {
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
};

export type EnemyCombatStats = CombatStats;

export type TotalStats = CombatStats;
