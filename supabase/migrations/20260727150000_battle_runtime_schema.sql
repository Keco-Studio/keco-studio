begin;

-- Battle runtime static catalogs. Keco Studio owns this migration because the
-- battle application and Studio share the same hosted Supabase project.
create table if not exists public.skills (
  id text primary key,
  name text not null,
  description text,
  category text check (category in ('burst', 'control', 'sustain', 'mobility', 'utility', 'execute')),
  ratio numeric not null default 1,
  mp_cost int not null default 0,
  range numeric not null default 1,
  cooldown_ticks int not null default 0,
  apply_freeze_ticks int,
  shatter_bonus_ratio numeric,
  consume_freeze_on_hit boolean,
  params jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skills_name_not_empty check (length(trim(name)) > 0)
);

create index if not exists idx_skills_category on public.skills (category);

create table if not exists public.job_classes (
  id text primary key,
  name text not null,
  description text,
  preferred_range text not null check (preferred_range in ('melee', 'mid', 'ranged')),
  strategy_hint text,
  base_hp int not null default 100,
  base_atk int not null default 5,
  base_def int not null default 3,
  base_spd int not null default 3,
  growth_hp int not null default 30,
  growth_atk int not null default 5,
  growth_def int not null default 3,
  growth_spd int not null default 3,
  hp_multiplier numeric not null default 5,
  base_stamina int not null default 80,
  base_max_shield int not null default 40,
  base_mp_ratio numeric not null default 0.5,
  created_at timestamptz not null default now(),
  constraint job_classes_name_not_empty check (length(trim(name)) > 0)
);

create table if not exists public.job_class_skills (
  job_class_id text not null references public.job_classes (id) on delete cascade,
  skill_id text not null references public.skills (id) on delete cascade,
  is_signature boolean not null default false,
  is_default boolean not null default false,
  primary key (job_class_id, skill_id)
);

create index if not exists idx_job_class_skills_skill
  on public.job_class_skills (skill_id);

create table if not exists public.player_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  character_name text not null default 'Adventurer',
  job_class_id text references public.job_classes (id) on delete set null,
  level int not null default 1,
  exp int not null default 0,
  gold int not null default 0,
  current_hp int,
  pos_x numeric not null default 8,
  pos_y numeric not null default 8,
  equipped_weapon jsonb,
  equipped_ring jsonb,
  equipped_armor jsonb,
  equipped_shoes jsonb,
  inventory jsonb not null default '[]'::jsonb,
  carried_skill_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_saves_user_unique unique (user_id),
  constraint player_saves_level_positive check (level >= 1),
  constraint player_saves_exp_non_negative check (exp >= 0),
  constraint player_saves_gold_non_negative check (gold >= 0),
  constraint player_saves_character_name_not_empty check (length(trim(character_name)) > 0)
);

create index if not exists idx_player_saves_user_id
  on public.player_saves (user_id);
create index if not exists idx_player_saves_job_class
  on public.player_saves (job_class_id);
create unique index if not exists uq_player_saves_character_name_ci
  on public.player_saves ((lower(btrim(character_name))));

create table if not exists public.battle_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  result text not null check (result in ('win', 'lose')),
  battle_type text not null check (battle_type in ('pve', 'pvp')),
  opponent_name text,
  enemy_level int,
  rounds int,
  exp_gained int not null default 0,
  gold_gained int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_battle_history_user_id
  on public.battle_history (user_id);
create index if not exists idx_battle_history_created
  on public.battle_history (user_id, created_at desc);

create table if not exists public.enemy_templates (
  id text primary key,
  name text not null,
  type text not null default 'monster' check (type in ('monster', 'boss', 'npc')),
  visual_id text,
  sprite_tile_index int,
  level int not null default 1,
  stat_profile jsonb,
  skill_ids text[] not null default '{}'::text[],
  drop_exp int not null default 0,
  drop_gold_min int not null default 0,
  drop_gold_max int not null default 0,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enemy_templates_name_not_empty check (length(trim(name)) > 0)
);

create table if not exists public.map_enemies (
  id uuid primary key default gen_random_uuid(),
  map_id text not null,
  instance_id text not null,
  template_id text references public.enemy_templates (id) on delete set null,
  spawn_x numeric not null,
  spawn_y numeric not null,
  overrides jsonb,
  created_at timestamptz not null default now(),
  constraint map_enemies_instance_unique unique (map_id, instance_id)
);

create index if not exists idx_map_enemies_map_id on public.map_enemies (map_id);

-- Retry-safe timestamp and user provisioning triggers.
drop trigger if exists trg_skills_updated_at on public.skills;
create trigger trg_skills_updated_at
  before update on public.skills
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_player_saves_updated_at on public.player_saves;
create trigger trg_player_saves_updated_at
  before update on public.player_saves
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_enemy_templates_updated_at on public.enemy_templates;
create trigger trg_enemy_templates_updated_at
  before update on public.enemy_templates
  for each row execute function public.update_updated_at_column();

create or replace function public.handle_new_user_save()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.player_saves (user_id, character_name)
  values (new.id, 'Adventurer-' || new.id::text)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user_save() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_save on auth.users;
create trigger on_auth_user_created_save
  after insert on auth.users
  for each row execute function public.handle_new_user_save();

insert into public.player_saves (user_id, character_name)
select
  users.id,
  'Adventurer-' || users.id::text
from auth.users as users
on conflict (user_id) do nothing;

-- RLS and explicit privileges. Static catalogs are public read-only data.
alter table public.skills enable row level security;
alter table public.job_classes enable row level security;
alter table public.job_class_skills enable row level security;
alter table public.player_saves enable row level security;
alter table public.battle_history enable row level security;
alter table public.enemy_templates enable row level security;
alter table public.map_enemies enable row level security;

drop policy if exists skills_select_public on public.skills;
create policy skills_select_public on public.skills for select using (true);
drop policy if exists job_classes_select_public on public.job_classes;
create policy job_classes_select_public on public.job_classes for select using (true);
drop policy if exists job_class_skills_select_public on public.job_class_skills;
create policy job_class_skills_select_public on public.job_class_skills for select using (true);
drop policy if exists enemy_templates_select_public on public.enemy_templates;
create policy enemy_templates_select_public on public.enemy_templates for select using (true);
drop policy if exists map_enemies_select_public on public.map_enemies;
create policy map_enemies_select_public on public.map_enemies for select using (true);

drop policy if exists player_saves_select_own on public.player_saves;
drop policy if exists player_saves_select_authenticated_pvp on public.player_saves;
create policy player_saves_select_authenticated_pvp on public.player_saves
  for select to authenticated using (true);
drop policy if exists player_saves_insert_own on public.player_saves;
create policy player_saves_insert_own on public.player_saves
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists player_saves_update_own on public.player_saves;
create policy player_saves_update_own on public.player_saves
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists player_saves_delete_own on public.player_saves;
create policy player_saves_delete_own on public.player_saves
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists battle_history_select_own on public.battle_history;
create policy battle_history_select_own on public.battle_history
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists battle_history_insert_own on public.battle_history;
create policy battle_history_insert_own on public.battle_history
  for insert to authenticated with check (auth.uid() = user_id);

revoke insert, update, delete on public.skills from anon, authenticated;
revoke insert, update, delete on public.job_classes from anon, authenticated;
revoke insert, update, delete on public.job_class_skills from anon, authenticated;
revoke insert, update, delete on public.enemy_templates from anon, authenticated;
revoke insert, update, delete on public.map_enemies from anon, authenticated;
grant select on public.skills to anon, authenticated;
grant select on public.job_classes to anon, authenticated;
grant select on public.job_class_skills to anon, authenticated;
grant select on public.enemy_templates to anon, authenticated;
grant select on public.map_enemies to anon, authenticated;

revoke all on public.player_saves from anon, authenticated;
grant select, insert, update, delete on public.player_saves to authenticated;
grant all on public.player_saves to service_role;

revoke all on public.battle_history from anon, authenticated;
revoke update, delete on public.battle_history from anon, authenticated;
grant select, insert on public.battle_history to authenticated;
grant all on public.battle_history to service_role;

grant all on public.skills to service_role;
grant all on public.job_classes to service_role;
grant all on public.job_class_skills to service_role;
grant all on public.enemy_templates to service_role;
grant all on public.map_enemies to service_role;

-- Skills are keyed by stable application IDs. cooldown_ticks remains in Studio
-- turn units; battle-poc applies its runtime multiplier exactly once.
insert into public.skills
  (id, name, description, category, ratio, mp_cost, range, cooldown_ticks,
   apply_freeze_ticks, shatter_bonus_ratio, consume_freeze_on_hit, params)
values
  ('arcane_bolt', 'Arcane Bolt', 'Single target arcane burst, strong after control.', 'burst', 1.35, 4, 6.5, 2, null, 0.45, true, null),
  ('frost_lock', 'Frost Lock', 'Applies freeze and opens combo windows.', 'control', 1.1, 6, 7.2, 3, 2, null, null, null),
  ('fireball', 'Fireball', 'Reliable mid-range burst projectile.', 'burst', 1.5, 6, 6.2, 3, null, null, null, null),
  ('ice_nova', 'Ice Nova', 'Short freeze setup spell for control mages.', 'control', 1.0, 5, 6.8, 4, 1, null, null, null),
  ('frost_lock_wave', 'Frost Lock Wave', 'Imported frost control wave; freeze-oriented setup.', 'control', 1.92, 14, 8, 2, 2, null, null, null),
  ('ice_shard_beam', 'Ice Shard Beam', 'Imported shard beam; sustained frost pressure.', 'burst', 1.48, 9, 7, 1, null, 0.25, null, null),
  ('arcane_prison_wave', 'Arcane Prison Wave', 'Imported arcane control spell; prison-like lock.', 'control', 1.84, 13, 9, 2, 1, null, null, null),
  ('mana_pulse_beam', 'Mana Pulse Beam', 'Imported arcane pulse beam; medium burst.', 'burst', 1.52, 10, 8, 1, null, null, null, null),
  ('command_aura', 'Command Aura', 'Hero pressure pulse that keeps tempo.', 'utility', 1.18, 3, 4.8, 2, null, null, null, null),
  ('rally_call', 'Rally Call', 'Hero burst call to quickly re-engage.', 'burst', 1.4, 5, 4.6, 4, null, null, null, null),
  ('shield_wall', 'Shield Wall', 'Tank shove with stable frontline damage.', 'utility', 1.05, 3, 2.4, 2, null, null, null, null),
  ('taunt', 'Taunt', 'Tank control poke that briefly hinders target.', 'control', 0.95, 4, 2.6, 3, null, null, null, null),
  ('focus_shot', 'Focus Shot', 'High precision archer poke.', 'burst', 1.3, 4, 7, 2, null, null, null, null),
  ('volley', 'Volley', 'Archer sustained ranged pressure.', 'sustain', 1.12, 4, 6.6, 3, null, null, null, null),
  ('shadow_step', 'Shadow Step', 'Assassin gap-close burst.', 'mobility', 1.55, 5, 3.1, 3, null, null, null, null),
  ('backstab', 'Backstab', 'Assassin close-range spike damage.', 'execute', 1.78, 6, 2.3, 4, null, null, null, null),
  ('heal_wave', 'Heal Wave', 'Support pulse; modeled as low damage utility for now.', 'sustain', 0.9, 4, 5.2, 2, null, null, null, null),
  ('barrier', 'Barrier', 'Support control layer that can freeze shortly.', 'utility', 0.95, 5, 5.6, 3, null, null, null, null),
  ('chilling_touch', 'Chilling Touch', 'DOT freeze skill; extends control window on frozen targets.', 'control', 1.1, 6, 7.5, 3, null, null, null, '{"dotDamage":0.25,"dotTicks":3,"freezeExtension":2}'),
  ('arctic_storm', 'Arctic Storm', 'Large AOE freeze; strong team fight control.', 'control', 1.6, 10, 7, 3, 2, null, null, null),
  ('frostslow_field', 'Frostslow Field', 'Massive slow zone; no freeze but heavy kite utility.', 'control', 0.85, 7, 6, 2, null, null, null, '{"slowAmount":0.7}'),
  ('void_chain', 'Void Chain', 'Silences target; pairs with freeze for double lock.', 'control', 1.05, 8, 7.5, 3, null, null, null, '{"silenceTicks":2}'),
  ('glacial_pierce', 'Glacial Pierce', 'Piercing shard; hits multiple enemies in a line.', 'burst', 1.3, 7, 8.5, 2, null, 0.3, null, null),
  ('burning_ground', 'Burning Ground', 'Undispellable burn DOT; anti-heal pressure.', 'sustain', 1.15, 6, 6.5, 3, null, null, null, '{"dotDamage":0.35,"dotTicks":4}'),
  ('infernal_orb', 'Infernal Orb', 'High damage AOE fireball; team fight core burst.', 'burst', 1.7, 10, 7, 3, null, null, null, null),
  ('scorching_aura', 'Scorching Aura', 'Reduces enemy healing; anti-sustain pressure.', 'control', 0.9, 5, 5, 2, null, null, null, '{"healReductionRatio":0.45}'),
  ('icefire_collision', 'Icefire Collision', 'Shatters frozen enemies; massive bonus vs frozen.', 'execute', 1.55, 8, 7, 2, null, 0.6, null, null),
  ('iron_bastion', 'Iron Bastion', 'Shield absorbs burst; tanks frontline.', 'utility', 0.9, 6, 4, 3, null, null, null, '{"shieldRatio":0.25}'),
  ('shield_retaliation', 'Shield Retaliation', 'Reflects blocked magic damage back to attacker.', 'control', 1.05, 7, 3.5, 3, null, null, null, '{"reflectRatio":0.4}'),
  ('warpull', 'Warpull', 'Pulls enemy to self; disruption + combo setup.', 'control', 0.95, 8, 5, 3, null, null, null, '{"pullDistance":3.5}'),
  ('aegis_blessing', 'Aegis Blessing', 'Team-wide damage reduction aura; team survival core.', 'utility', 0.8, 7, 4.5, 4, null, null, null, '{"teamDamageReduction":0.2}'),
  ('unstoppable_charge', 'Unstoppable Charge', 'Immunity dash; team fight initiation breakthrough skill.', 'mobility', 1.25, 8, 2.5, 3, null, null, null, '{"immunityTicks":2}'),
  ('piercing_arrow', 'Piercing Arrow', 'Pierces multiple enemies in a straight line.', 'burst', 1.35, 5, 7.5, 2, null, null, null, '{"pierceCount":3}'),
  ('aimed_snipe', 'Aimed Snipe', 'Charged long-range execute; high risk reward.', 'execute', 1.95, 9, 8.5, 4, null, null, null, '{"slowAmount":0.4}'),
  ('frost_trap', 'Frost Trap', 'Slow zone; remote kite and chase tool.', 'control', 1.05, 4, 6, 2, null, null, null, '{"slowAmount":0.55}'),
  ('rain_of_arrows', 'Rain of Arrows', 'AOE sustained pressure; group poke.', 'sustain', 1.2, 7, 7, 3, null, null, null, null),
  ('keen_eye', 'Keen Eye', 'Mark target; team crit buff + damage amp.', 'utility', 0.9, 4, 6, 3, null, null, null, '{"critBonus":0.3,"damageAmp":0.2}'),
  ('shadow_cloak', 'Shadow Cloak', 'Invisibility on use; ambush / reposition tool.', 'mobility', 0.85, 5, 4, 3, null, null, null, '{"invisibilityTicks":3}'),
  ('afterimage', 'Afterimage', 'Second dash; deals damage while leaving decoy.', 'mobility', 1.75, 6, 4, 2, null, null, null, '{"dashDistance":4}'),
  ('lacerate', 'Lacerate', 'Bleed DOT; execute bonus at low HP.', 'execute', 1.3, 5, 3, 3, null, null, null, '{"dotDamage":0.3,"dotTicks":4,"executeBonus":0.45}'),
  ('phantom_edge', 'Phantom Edge', 'Gap-close dash; second instance for flexible engage.', 'mobility', 1.5, 6, 4.5, 2, null, null, null, '{"dashDistance":5}'),
  ('nox_strike', 'Nox Strike', 'Instant no-animation strike; no warning for target.', 'burst', 1.7, 6, 3, 3, null, null, null, null),
  ('radiance', 'Radiance', 'Team HOT plus shield; sustainable sustain.', 'sustain', 1.35, 8, 5.5, 3, null, null, null, '{"hotTickHeal":0.2,"hotTicks":3,"shieldRatio":0.1}'),
  ('blessing_might', 'Blessing of Might', 'Ally ATK buff; damage amp for allies.', 'utility', 0.9, 5, 4.5, 3, null, null, null, '{"atkBonus":0.35,"buffTicks":4}'),
  ('weakening_hex', 'Weakening Hex', 'Enemy ATK/DEF debuff; weakens overall enemy capability.', 'control', 0.95, 6, 4, 3, null, null, null, '{"atkDebuff":0.3,"defDebuff":0.25,"debuffTicks":3}'),
  ('purification', 'Purification', 'Cleanses 2 debuffs from ally plus shield absorb.', 'utility', 0.8, 7, 5, 4, null, null, null, '{"cleanseCount":2,"shieldRatio":0.15}'),
  ('guardian_angel', 'Guardian Angel', 'Short invulnerability plus full debuff cleanse.', 'utility', 0.85, 10, 5.5, 5, null, null, null, '{"invulTicks":2}')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  ratio = excluded.ratio,
  mp_cost = excluded.mp_cost,
  range = excluded.range,
  cooldown_ticks = excluded.cooldown_ticks,
  apply_freeze_ticks = excluded.apply_freeze_ticks,
  shatter_bonus_ratio = excluded.shatter_bonus_ratio,
  consume_freeze_on_hit = excluded.consume_freeze_on_hit,
  params = excluded.params,
  updated_at = now();

insert into public.job_classes
  (id, name, description, preferred_range, strategy_hint, base_hp, base_atk,
   base_def, base_spd, growth_hp, growth_atk, growth_def, growth_spd,
   hp_multiplier, base_stamina, base_max_shield, base_mp_ratio)
values
  ('hero', 'Hero', 'Balanced frontline. Balances damage and control, maintains pressure rhythm.', 'melee', 'Balanced frontline, balances damage and control, maintains pressure rhythm', 120, 6, 4, 4, 35, 5, 3, 3, 5, 80, 40, 0.5),
  ('tank', 'Tank', 'Heavy armor frontline. Absorbs damage to protect allies, uses taunt and control to disrupt enemy rhythm.', 'melee', 'Heavy armor frontline, absorbs damage to protect allies, uses taunt and control to disrupt enemy rhythm', 150, 4, 7, 2, 45, 3, 5, 1, 5, 100, 60, 0.4),
  ('archer', 'Archer', 'Ranged physical DPS. Maintains safe distance for sustained pressure, uses kiting and slows.', 'ranged', 'Ranged physical DPS, maintains safe distance for sustained pressure, uses kiting and slows to keep distance', 90, 7, 2, 6, 25, 6, 2, 4, 5, 80, 30, 0.5),
  ('mage', 'Mage', 'Ranged magic DPS. Uses control skills to open combo windows for burst, follows up freeze with shatter damage.', 'ranged', 'Ranged magic DPS, uses control skills to open combo windows for burst, follows up freeze with shatter damage', 80, 9, 1, 4, 20, 7, 1, 3, 5, 60, 20, 0.6),
  ('healer', 'Healer', 'Team support. Prioritizes keeping allies alive, uses debuffs and cleanse to disrupt enemies.', 'mid', 'Team support, prioritizes keeping allies alive, uses debuffs and cleanse to disrupt enemies', 100, 4, 4, 5, 28, 3, 3, 3, 5, 70, 30, 0.55),
  ('assassin', 'Assassin', 'Melee assassin. Uses displacement skills to flank and dive, executes low-HP targets.', 'melee', 'Melee assassin, uses displacement skills to flank and dive, executes low-HP targets', 85, 10, 2, 8, 22, 8, 2, 5, 5, 100, 25, 0.45)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  preferred_range = excluded.preferred_range,
  strategy_hint = excluded.strategy_hint,
  base_hp = excluded.base_hp,
  base_atk = excluded.base_atk,
  base_def = excluded.base_def,
  base_spd = excluded.base_spd,
  growth_hp = excluded.growth_hp,
  growth_atk = excluded.growth_atk,
  growth_def = excluded.growth_def,
  growth_spd = excluded.growth_spd,
  hp_multiplier = excluded.hp_multiplier,
  base_stamina = excluded.base_stamina,
  base_max_shield = excluded.base_max_shield,
  base_mp_ratio = excluded.base_mp_ratio;

insert into public.job_class_skills (job_class_id, skill_id, is_signature, is_default) values
  ('hero', 'rally_call', true, true),
  ('hero', 'command_aura', true, true),
  ('hero', 'shield_wall', true, true)
on conflict do nothing;

insert into public.job_class_skills (job_class_id, skill_id, is_signature, is_default) values
  ('tank', 'shield_wall', true, true),
  ('tank', 'taunt', true, true),
  ('tank', 'barrier', false, true),
  ('tank', 'iron_bastion', true, false),
  ('tank', 'shield_retaliation', true, false),
  ('tank', 'warpull', true, false),
  ('tank', 'aegis_blessing', true, false),
  ('tank', 'unstoppable_charge', true, false)
on conflict do nothing;

insert into public.job_class_skills (job_class_id, skill_id, is_signature, is_default) values
  ('archer', 'focus_shot', true, true),
  ('archer', 'volley', true, true),
  ('archer', 'arcane_bolt', false, true),
  ('archer', 'piercing_arrow', true, false),
  ('archer', 'aimed_snipe', true, false),
  ('archer', 'frost_trap', true, false),
  ('archer', 'rain_of_arrows', true, false),
  ('archer', 'keen_eye', true, false)
on conflict do nothing;

insert into public.job_class_skills (job_class_id, skill_id, is_signature, is_default) values
  ('mage', 'fireball', true, true),
  ('mage', 'arcane_bolt', true, true),
  ('mage', 'frost_lock', true, true),
  ('mage', 'ice_nova', false, false),
  ('mage', 'chilling_touch', false, false),
  ('mage', 'arctic_storm', true, false),
  ('mage', 'frostslow_field', false, false),
  ('mage', 'void_chain', false, false),
  ('mage', 'glacial_pierce', true, false),
  ('mage', 'burning_ground', false, false),
  ('mage', 'infernal_orb', true, false),
  ('mage', 'scorching_aura', false, false),
  ('mage', 'icefire_collision', false, false),
  ('mage', 'frost_lock_wave', false, false),
  ('mage', 'ice_shard_beam', false, false),
  ('mage', 'arcane_prison_wave', false, false),
  ('mage', 'mana_pulse_beam', false, false)
on conflict do nothing;

insert into public.job_class_skills (job_class_id, skill_id, is_signature, is_default) values
  ('healer', 'heal_wave', true, true),
  ('healer', 'barrier', false, true),
  ('healer', 'command_aura', false, true),
  ('healer', 'radiance', true, false),
  ('healer', 'blessing_might', true, false),
  ('healer', 'weakening_hex', true, false),
  ('healer', 'purification', true, false),
  ('healer', 'guardian_angel', true, false)
on conflict do nothing;

insert into public.job_class_skills (job_class_id, skill_id, is_signature, is_default) values
  ('assassin', 'shadow_step', true, true),
  ('assassin', 'backstab', true, true),
  ('assassin', 'arcane_bolt', false, true),
  ('assassin', 'shadow_cloak', true, false),
  ('assassin', 'afterimage', true, false),
  ('assassin', 'lacerate', true, false),
  ('assassin', 'phantom_edge', true, false),
  ('assassin', 'nox_strike', true, false)
on conflict do nothing;

insert into public.enemy_templates
  (id, name, type, visual_id, level, stat_profile, skill_ids, drop_exp,
   drop_gold_min, drop_gold_max)
values
  ('guard-entity', 'Guard', 'npc', 'archerGreen', 1, '{"maxHp":68,"atk":7,"def":2,"spd":3}'::jsonb, '{arcane_bolt,fireball}', 1, 1, 2),
  ('guard-warrior', 'Guard', 'npc', 'warriorBlue', 1, '{"maxHp":72,"atk":8,"def":3,"spd":3}'::jsonb, '{arcane_bolt,fireball}', 1, 1, 2),
  ('archer-entity', 'Archer', 'npc', 'archerGreen', 1, '{"maxHp":68,"atk":7,"def":2,"spd":3}'::jsonb, '{arcane_bolt,focus_shot,volley}', 1, 1, 2),
  ('demon-guard', 'Demon Guard', 'monster', 'warriorBlue', 3, null, '{arcane_bolt,fireball}', 3, 4, 8),
  ('shadow-assassin', 'Shadow Assassin', 'monster', 'warriorBlue', 5, null, '{arcane_bolt,shadow_step,backstab}', 5, 8, 14)
on conflict (id) do update set
  name = excluded.name,
  type = excluded.type,
  visual_id = excluded.visual_id,
  level = excluded.level,
  stat_profile = excluded.stat_profile,
  skill_ids = excluded.skill_ids,
  drop_exp = excluded.drop_exp,
  drop_gold_min = excluded.drop_gold_min,
  drop_gold_max = excluded.drop_gold_max,
  updated_at = now();

insert into public.map_enemies
  (map_id, instance_id, template_id, spawn_x, spawn_y, overrides)
values
  ('demo-project', 'guard-1', 'guard-warrior', 5, 5, null),
  ('demo-project', 'guard-2', 'guard-warrior', 4, 8, null)
on conflict (map_id, instance_id) do update set
  template_id = excluded.template_id,
  spawn_x = excluded.spawn_x,
  spawn_y = excluded.spawn_y,
  overrides = excluded.overrides;

insert into public.map_enemies
  (map_id, instance_id, template_id, spawn_x, spawn_y, overrides)
values
  ('pixel-npc', 'guard-1', 'guard-entity', 5, 5, null),
  ('pixel-npc', 'instance-1773799228297-vlv3u8', 'guard-entity', 4, 8, null),
  ('pixel-npc', 'instance-1773799230512-o0a5rz', 'guard-entity', 7, 7, null),
  ('pixel-npc', 'instance-1773827908047-jl5i01', 'guard-entity', 9, 8, '{"visualId":"archerGreen","battleProfile":{"maxHp":68,"atk":7,"def":2}}'::jsonb),
  ('pixel-npc', 'instance-1773827953992-rk3al4', 'guard-entity', 11, 7, '{"visualId":"archerGreen","battleProfile":{"maxHp":68,"atk":7,"def":2}}'::jsonb),
  ('pixel-npc', 'instance-1776676380837-07bs7q', 'guard-entity', 5, 2, '{"visualId":"pixellab:brave-knight-top-down-pixel-art-1776674813964","battleProfile":{"maxHp":72,"atk":8,"def":3}}'::jsonb),
  ('pixel-npc', 'instance-1776676382234-xutd0r', 'guard-entity', 4, 13, '{"visualId":"pixellab:brave-knight-top-down-pixel-art-1776674813964","battleProfile":{"maxHp":72,"atk":8,"def":3}}'::jsonb),
  ('pixel-npc', 'instance-1776676383690-ckg3fc', 'guard-entity', 11, 10, '{"visualId":"pixellab:brave-knight-top-down-pixel-art-1776674813964","battleProfile":{"maxHp":72,"atk":8,"def":3}}'::jsonb),
  ('pixel-npc', 'instance-1776676384778-v05hce', 'guard-entity', 11, 4, '{"visualId":"pixellab:brave-knight-top-down-pixel-art-1776674813964","battleProfile":{"maxHp":72,"atk":8,"def":3}}'::jsonb)
on conflict (map_id, instance_id) do update set
  template_id = excluded.template_id,
  spawn_x = excluded.spawn_x,
  spawn_y = excluded.spawn_y,
  overrides = excluded.overrides;

insert into public.map_enemies
  (map_id, instance_id, template_id, spawn_x, spawn_y, overrides)
values
  ('default', 'enemy-1', 'demon-guard', 5, 5, null),
  ('default', 'enemy-2', 'shadow-assassin', 10, 6, null)
on conflict (map_id, instance_id) do update set
  template_id = excluded.template_id,
  spawn_x = excluded.spawn_x,
  spawn_y = excluded.spawn_y,
  overrides = excluded.overrides;

notify pgrst, 'reload schema';
commit;
