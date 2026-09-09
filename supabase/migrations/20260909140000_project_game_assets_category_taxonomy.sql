-- Align project_game_assets categories with the Assets library taxonomy:
-- Characters, Icons, UI, Maps, Props, VFX, SpriteSheets, Media.
alter table public.project_game_assets
  drop constraint if exists project_game_assets_category_check;

update public.project_game_assets
set category = case category
  when 'animation' then 'spritesheet'
  when 'effect' then 'vfx'
  when 'other' then 'media'
  else category
end
where category in ('animation', 'effect', 'other');

alter table public.project_game_assets
  alter column category set default 'media';

alter table public.project_game_assets
  add constraint project_game_assets_category_check
  check (category in ('character','icon','ui','map','prop','vfx','spritesheet','media'));
