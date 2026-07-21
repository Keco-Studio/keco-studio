'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Skill, Element, BattleLogEntry } from '@keco/battle-engine';
import {
  MapBattleController,
  createKecoArenaSession,
  getPocBattleUiOutcome,
  type BattleSession,
} from '@keco/battle-core';
import {
  BattleResultOverlay,
  type BattleResultOutcome,
} from './BattleResultOverlay';
import { MapFxOverlay } from '../poc-map-ui/MapFxOverlay';
import { processArenaBattleEvents } from '../poc-map-ui/processArenaBattleEvents';
import { useMapRenderMetrics } from '../poc-map-ui/useMapRenderMetrics';
import { useArenaCombatFx, spriteMotionStyle } from '../poc-map-ui/useArenaCombatFx';
import { useMapTransientFx } from '../poc-map-ui/useMapTransientFx';
import {
  DEFAULT_DIRECTION,
  POC_ARENA_MAP_BG,
  resolveDirectionByDelta,
  toEnemyIdlePngPath,
  toEnemyWalkFramePath,
  toPlayerIdlePngPath,
  toPlayerWalkFramePath,
  type RotationKey,
} from '../poc-map-ui/gameMapSprites';
import styles from './BattleArena.module.css';

export type ProgressionRewardFxHandler = (
  rewards: Array<{ text: string; variant: 'heal' | 'exp' | 'damage' | 'proficiency' }>,
) => void;

export type BattleArenaConfig = {
  mapWidth: number;
  mapHeight: number;
  /** battle-poc arena background; defaults to POC_ARENA_MAP_BG */
  mapBackgroundUrl?: string;
  playerName: string;
  playerStats: { maxHp: number; atk: number; def: number; spd: number };
  playerHp: number;
  playerMp: number;
  playerMaxMp: number;
  playerSkillIds: string[];
  enemyName: string;
  enemyStats: { maxHp: number; atk: number; def: number; spd: number };
  enemyHp: number;
  enemyMp: number;
  enemyMaxMp: number;
  enemySkillIds: string[];
  skills: Skill[];
  monsterInitialElement?: Element | null;
};

type Props = {
  config: BattleArenaConfig;
  onFinished?: (session: BattleSession) => void | string[];
  onStop?: () => void;
  /** Result overlay CONTINUE — falls back to onStop when omitted. */
  onContinue?: () => void;
  hideInternalLog?: boolean;
  onLogLinesChange?: (lines: string[]) => void;
  /** Hides debug toolbar and floating actor HP bars for the design battle screen. */
  presentation?: 'debug' | 'design';
  onBattleStateChange?: (state: BattleArenaUiState) => void;
  /** Fired whenever the battle session updates (for progression runtime). */
  onSessionChange?: (session: BattleSession) => void;
  /** Fired when a new battle session starts (reset progression runtime). */
  onBattleReset?: () => void;
  /** Reward summary lines shown on the result overlay (from progression rules). */
  rewardSummaryLines?: string[];
  /** Called when user clicks "Import battle contributions" on the result overlay. */
  onImportProgression?: (session: BattleSession) => void;
  /** Ref populated by BattleArena to show progression reward float text on the map. */
  progressionRewardFxRef?: React.MutableRefObject<ProgressionRewardFxHandler | null>;
  /** Register a function to append lines to the battle log (for progression / external events). */
  onRegisterLogAppender?: (append: (line: string) => void) => void;
};

export type BattleArenaUiState = {
  tick: number;
  phase: string;
  playerHp: number;
  playerMaxHp: number;
  playerMp: number;
  playerMaxMp: number;
  enemyHp: number;
  enemyMaxHp: number;
  enemyMp: number;
  enemyMaxMp: number;
};

function extractUiState(session: BattleSession): BattleArenaUiState {
  return {
    tick: session.tick,
    phase: session.phase,
    playerHp: session.left.resources.hp,
    playerMaxHp: session.left.resources.maxHp,
    playerMp: session.left.resources.mp,
    playerMaxMp: session.left.resources.maxMp,
    enemyHp: session.right.resources.hp,
    enemyMaxHp: session.right.resources.maxHp,
    enemyMp: session.right.resources.mp,
    enemyMaxMp: session.right.resources.maxMp,
  };
}

const TICK_MS = 200;
const SPEED_OPTIONS = [1, 2, 4] as const;

function eventToLogLine(ev: { type: string; payload: Record<string, unknown> }): string | null {
  if (ev.type === 'action_executed') {
    const skill = ev.payload.skillName ?? ev.payload.skillId ?? ev.payload.action;
    return `[T${ev.payload.tick ?? '?'}] ${ev.payload.actorId} → ${skill}`;
  }
  if (ev.type === 'damage_applied') {
    return `  dmg ${ev.payload.damage}${ev.payload.resolver === 'keco_element' ? ' (keco)' : ''}`;
  }
  if (ev.type === 'command_rejected') {
    return `  reject: ${ev.payload.reason}`;
  }
  if (ev.type === 'battle_ended') {
    return `Ended: ${ev.payload.result}`;
  }
  return null;
}

function paintBattleCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mapWidth: number,
  mapHeight: number,
  renderOffsetX: number,
  renderOffsetY: number,
  renderWidth: number,
  renderHeight: number,
  mapBgImage: HTMLImageElement | null,
  letterboxFill = '#0b1220',
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = letterboxFill;
  ctx.fillRect(0, 0, width, height);

  if (mapBgImage) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mapBgImage, renderOffsetX, renderOffsetY, renderWidth, renderHeight);
    return;
  }

  const cellW = renderWidth / mapWidth;
  const cellH = renderHeight / mapHeight;
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const dx = renderOffsetX + x * cellW;
      const dy = renderOffsetY + y * cellH;
      const tileId = (x + y) % 3;
      if (tileId >= 2) ctx.fillStyle = 'rgba(71, 85, 105, 0.85)';
      else if (tileId >= 1) ctx.fillStyle = 'rgba(6, 95, 70, 0.85)';
      else ctx.fillStyle = 'rgba(20, 83, 45, 0.85)';
      ctx.fillRect(dx, dy, cellW, cellH);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dx, dy, cellW, cellH);
    }
  }
}

function defaultSpawn(mapW: number, mapH: number) {
  const midY = Math.floor(mapH / 2);
  return {
    player: { x: Math.max(2, Math.floor(mapW * 0.3)), y: midY },
    enemy: { x: Math.min(mapW - 3, Math.floor(mapW * 0.65)), y: midY },
  };
}

export function BattleArena({
  config,
  onFinished,
  onStop,
  onContinue,
  hideInternalLog = false,
  onLogLinesChange,
  presentation = 'debug',
  onBattleStateChange,
  onSessionChange,
  onBattleReset,
  rewardSummaryLines,
  onImportProgression,
  progressionRewardFxRef,
  onRegisterLogAppender,
}: Props) {
  const isDesignPresentation = presentation === 'design';
  const onLogLinesChangeRef = useRef(onLogLinesChange);
  const onBattleStateChangeRef = useRef(onBattleStateChange);
  const onSessionChangeRef = useRef(onSessionChange);
  onLogLinesChangeRef.current = onLogLinesChange;
  onBattleStateChangeRef.current = onBattleStateChange;
  onSessionChangeRef.current = onSessionChange;

  const mapBgUrl = config.mapBackgroundUrl ?? POC_ARENA_MAP_BG;
  const controllerRef = useRef<MapBattleController | null>(null);
  const arenaRootRef = useRef<HTMLDivElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastEventCount = useRef(0);
  const lastKecoLogCount = useRef(0);
  const prevPlayerPos = useRef<{ x: number; y: number } | null>(null);
  const prevEnemyPos = useRef<{ x: number; y: number } | null>(null);
  const commandMetaStore = useRef<Record<string, { actorId: string; targetId: string; action: string; skillId: string }>>({});
  const projectileTargetStore = useRef<Record<string, { target: 'player' | 'enemy' }>>({});

  const {
    floatTexts,
    moveFx,
    projectileFx,
    impactFx,
    clearTransientFx,
    pushFloatText,
    pushMoveFx,
    pushProjectileFx,
    pushImpactFx,
  } = useMapTransientFx();
  const { playerCombatFx, enemyCombatFx, resetCombatFx, triggerCombatFx } = useArenaCombatFx();

  useEffect(() => {
    const ref = progressionRewardFxRef;
    if (!ref) return;
    ref.current = (rewards) => {
      rewards.forEach((reward, i) => {
        pushFloatText({
          target: 'player',
          text: reward.text,
          variant: reward.variant,
          offsetX: (Math.random() - 0.5) * 20 + i * 16,
        });
      });
    };
    return () => {
      ref.current = null;
    };
  }, [progressionRewardFxRef, pushFloatText]);

  useEffect(() => {
    if (!onRegisterLogAppender) return;
    onRegisterLogAppender((line) => {
      setLogLines((prev) => [...prev.slice(-100), line]);
    });
  }, [onRegisterLogAppender]);

  const [combatFxTick, setCombatFxTick] = useState(0);

  const [session, setSession] = useState<BattleSession | null>(null);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 520 });
  const [mounted, setMounted] = useState(false);
  const [mapBgImage, setMapBgImage] = useState<HTMLImageElement | null>(null);
  const [walkAnimTick, setWalkAnimTick] = useState(0);
  const [playerFacing, setPlayerFacing] = useState<RotationKey>(DEFAULT_DIRECTION);
  const [enemyFacing, setEnemyFacing] = useState<RotationKey>(DEFAULT_DIRECTION);
  const [playerWalking, setPlayerWalking] = useState(false);
  const [enemyWalking, setEnemyWalking] = useState(false);
  const [resultOverlay, setResultOverlay] = useState<{
    outcome: BattleResultOutcome;
    rewardLines?: string[];
  } | null>(null);
  const [finishedSession, setFinishedSession] = useState<BattleSession | null>(null);

  const { renderWidth, renderHeight, renderOffsetX, renderOffsetY, actorPx, gridToScreen } =
    useMapRenderMetrics({
      viewportSize,
      mapWidth: config.mapWidth,
      mapHeight: config.mapHeight,
      // Design battle fills the stage; debug keeps letterboxing for full map visibility.
      fit: presentation === 'design' ? 'cover' : 'contain',
    });

  const appendStepLogs = useCallback(
    (s: BattleSession) => {
      const evStart = lastEventCount.current;
      const newLines: string[] = [];
      for (let i = evStart; i < s.events.length; i++) {
        const line = eventToLogLine(s.events[i] as { type: string; payload: Record<string, unknown> });
        if (line) newLines.push(line);
      }
      lastEventCount.current = s.events.length;

      processArenaBattleEvents(s, evStart, commandMetaStore, projectileTargetStore, {
        triggerCombatFx,
        pushProjectileFx,
        pushFloatText,
        pushImpactFx,
      });

      const kecoLogLen = s.keco?.logs?.length ?? 0;
      if (kecoLogLen > lastKecoLogCount.current) {
        for (let i = lastKecoLogCount.current; i < kecoLogLen; i++) {
          const entry = s.keco!.logs[i] as BattleLogEntry;
          if (entry.statusText) newLines.push(`  [keco] ${entry.statusText}`);
          if (entry.type === 'heal' && entry.healAmount && entry.healAmount > 0) {
            const healTarget =
              entry.actor === s.left.name
                ? 'player'
                : entry.actor === s.right.name
                  ? 'enemy'
                  : 'player';
            pushFloatText({
              target: healTarget,
              text: `+${entry.healAmount}`,
              variant: 'heal',
              offsetX: (Math.random() - 0.5) * 20,
            });
          }
        }
        lastKecoLogCount.current = kecoLogLen;
      }
      if (newLines.length) {
        setLogLines((prev) => [...prev.slice(-100), ...newLines]);
      }
    },
    [pushFloatText, pushImpactFx, pushProjectileFx, triggerCombatFx],
  );

  const syncActorMotion = useCallback(
    (s: BattleSession) => {
      const pp = s.left.position;
      const ep = s.right.position;

      if (prevPlayerPos.current) {
        const dx = pp.x - prevPlayerPos.current.x;
        const dy = pp.y - prevPlayerPos.current.y;
        if (Math.hypot(dx, dy) > 0.02) {
          setPlayerFacing(resolveDirectionByDelta(dx, dy));
          setPlayerWalking(true);
          pushMoveFx({ target: 'player', x: pp.x, y: pp.y });
        } else {
          setPlayerWalking(false);
        }
      }
      if (prevEnemyPos.current) {
        const dx = ep.x - prevEnemyPos.current.x;
        const dy = ep.y - prevEnemyPos.current.y;
        if (Math.hypot(dx, dy) > 0.02) {
          setEnemyFacing(resolveDirectionByDelta(dx, dy));
          setEnemyWalking(true);
          pushMoveFx({ target: 'enemy', x: ep.x, y: ep.y });
        } else {
          setEnemyWalking(false);
        }
      }
      prevPlayerPos.current = { ...pp };
      prevEnemyPos.current = { ...ep };
    },
    [pushMoveFx],
  );

  const finalizeBattle = useCallback(
    (s: BattleSession) => {
      const ui = getPocBattleUiOutcome(s);
      if (ui === 'ongoing') return;
      setRunning(false);
      const outcome: BattleResultOutcome = ui === 'fled' ? 'fled' : ui;
      setFinishedSession(s);
      const fromFinished = onFinished?.(s);
      const rewardLines = Array.isArray(fromFinished)
        ? fromFinished
        : rewardSummaryLines;
      setResultOverlay({ outcome, rewardLines });
    },
    [onFinished, rewardSummaryLines],
  );

  const runOneTick = useCallback(() => {
    const ctrl = controllerRef.current;
    if (!ctrl || ctrl.session.result !== 'ongoing') return null;
    const step = ctrl.step({
      executeAtTick: ctrl.session.tick + 1,
      nextAttackSkillId: null,
      pendingFlee: false,
    });
    ctrl.session = step.session;
    appendStepLogs(step.session);
    syncActorMotion(step.session);
    const next = { ...step.session };
    setSession(next);
    if (next.result !== 'ongoing') {
      finalizeBattle(next);
    }
    return next;
  }, [appendStepLogs, finalizeBattle, syncActorMotion]);

  const initSession = useCallback(() => {
    const spawn = defaultSpawn(config.mapWidth, config.mapHeight);
    const s = createKecoArenaSession({
      mapWidth: config.mapWidth,
      mapHeight: config.mapHeight,
      playerName: config.playerName,
      playerGrid: spawn.player,
      playerStats: { ...config.playerStats, maxHp: config.playerStats.maxHp },
      playerHp: config.playerHp,
      playerMp: config.playerMp,
      playerMaxMp: config.playerMaxMp,
      playerSkillIds: config.playerSkillIds,
      enemyName: config.enemyName,
      enemyGrid: spawn.enemy,
      enemyStats: { ...config.enemyStats, maxHp: config.enemyStats.maxHp },
      enemyHp: config.enemyHp,
      enemyMp: config.enemyMp,
      enemyMaxMp: config.enemyMaxMp,
      enemySkillIds: config.enemySkillIds,
      skills: config.skills,
      monsterInitialElement: config.monsterInitialElement ?? undefined,
      preparationTicks: 3,
    });

    const ctrl = new MapBattleController({
      mapWidth: config.mapWidth,
      mapHeight: config.mapHeight,
      playerName: config.playerName,
      playerGrid: spawn.player,
      playerStats: { ...config.playerStats, maxHp: config.playerStats.maxHp },
      playerHp: config.playerHp,
      playerMp: config.playerMp,
      playerMaxMp: config.playerMaxMp,
      playerSkillIds: config.playerSkillIds,
      enemyName: config.enemyName,
      enemyId: 'poc-enemy',
      enemyGrid: spawn.enemy,
      enemyStats: { ...config.enemyStats, maxHp: config.enemyStats.maxHp },
      enemySkillIds: config.enemySkillIds,
      battleDecisionMode: 'manual',
      initialSession: s,
    });

    controllerRef.current = ctrl;
    prevPlayerPos.current = { ...s.left.position };
    prevEnemyPos.current = { ...s.right.position };
    setPlayerFacing(s.left.position.x < s.right.position.x ? 'east' : 'west');
    setEnemyFacing(s.left.position.x < s.right.position.x ? 'west' : 'east');
    setSession(s);
    setRunning(true);
    lastEventCount.current = 0;
    lastKecoLogCount.current = 0;
    commandMetaStore.current = {};
    projectileTargetStore.current = {};
    clearTransientFx();
    resetCombatFx();
    setResultOverlay(null);
    setLogLines(['BT auto · keco element damage']);
    onBattleReset?.();
    onSessionChangeRef.current?.(s);
  }, [clearTransientFx, config, onBattleReset, resetCombatFx]);

  const handleBattleAgain = useCallback(() => {
    setResultOverlay(null);
    setFinishedSession(null);
    initSession();
  }, [initSession]);

  const handleResultContinue = useCallback(() => {
    setResultOverlay(null);
    setFinishedSession(null);
    (onContinue ?? onStop)?.();
  }, [onContinue, onStop]);

  const handleImportProgression = useCallback(() => {
    if (!finishedSession || !onImportProgression) return;
    onImportProgression(finishedSession);
  }, [finishedSession, onImportProgression]);

  useEffect(() => {
    initSession();
    setMounted(true);
    return () => {
      controllerRef.current = null;
    };
  }, [initSession]);

  useEffect(() => {
    onLogLinesChangeRef.current?.(logLines);
  }, [logLines]);

  useEffect(() => {
    if (!session) return;
    onBattleStateChangeRef.current?.(extractUiState(session));
    onSessionChangeRef.current?.(session);
  }, [session]);

  useEffect(() => {
    if (!mapBgUrl) {
      setMapBgImage(null);
      return;
    }
    const img = new window.Image();
    img.src = mapBgUrl;
    img.onload = () => setMapBgImage(img);
    img.onerror = () => setMapBgImage(null);
  }, [mapBgUrl]);

  /** Same width as battleStage / Ready box; height matches left config column via flex. */
  const measureViewport = useCallback(() => {
    const el = mapViewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const width = Math.max(1, Math.floor(r.width));
    const height = Math.max(1, Math.floor(r.height));
    setViewportSize((prev) => {
      if (Math.abs(prev.width - width) <= 1 && Math.abs(prev.height - height) <= 1) {
        return prev;
      }
      return { width, height };
    });
  }, []);

  useEffect(() => {
    const el = mapViewportRef.current;
    if (!el) return;
    measureViewport();
    const observer = new ResizeObserver(() => measureViewport());
    observer.observe(el);
    window.addEventListener('resize', measureViewport);
    const raf = requestAnimationFrame(() => requestAnimationFrame(measureViewport));
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', measureViewport);
    };
  }, [measureViewport]);

  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = viewportSize.width;
    const h = viewportSize.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    paintBattleCanvas(
      ctx,
      w,
      h,
      config.mapWidth,
      config.mapHeight,
      renderOffsetX,
      renderOffsetY,
      renderWidth,
      renderHeight,
      mapBgImage,
      isDesignPresentation ? '#ffffff' : '#0b1220',
    );
  }, [
    config.mapHeight,
    config.mapWidth,
    isDesignPresentation,
    mapBgImage,
    renderHeight,
    renderOffsetX,
    renderOffsetY,
    renderWidth,
    viewportSize.height,
    viewportSize.width,
  ]);

  useEffect(() => {
    if (!playerWalking && !enemyWalking) return;
    const id = window.setInterval(() => setWalkAnimTick((t) => t + 1), 120);
    return () => window.clearInterval(id);
  }, [playerWalking, enemyWalking]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      if (playerCombatFx.untilMs > now || enemyCombatFx.untilMs > now) {
        setCombatFxTick((t) => t + 1);
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [playerCombatFx.untilMs, enemyCombatFx.untilMs]);

  useEffect(() => {
    if (!running || !session || !controllerRef.current) return;
    if (session.result !== 'ongoing') return;

    const timer = window.setTimeout(() => {
      runOneTick();
    }, Math.round(TICK_MS / speed));

    return () => window.clearTimeout(timer);
  }, [running, session, speed, runOneTick]);

  const handleSkip = () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    while (ctrl.session.result === 'ongoing' && ctrl.session.tick < 500) {
      runOneTick();
    }
    if (ctrl.session.result !== 'ongoing') {
      setSession({ ...ctrl.session });
      finalizeBattle(ctrl.session);
    }
  };

  if (!session) {
    return (
      <div className={styles.arenaRoot}>
        <div className={styles.loading}>Loading arena…</div>
      </div>
    );
  }

  const { left, right } = session;
  const playerScreen = mounted
    ? gridToScreen(left.position.x, left.position.y)
    : { x: viewportSize.width * 0.25, y: viewportSize.height * 0.5 };
  const enemyScreen = mounted
    ? gridToScreen(right.position.x, right.position.y)
    : { x: viewportSize.width * 0.75, y: viewportSize.height * 0.5 };
  const playerHpPct = left.resources.maxHp > 0 ? (left.resources.hp / left.resources.maxHp) * 100 : 0;
  const enemyHpPct = right.resources.maxHp > 0 ? (right.resources.hp / right.resources.maxHp) * 100 : 0;

  const playerSprite = playerWalking
    ? toPlayerWalkFramePath(playerFacing, walkAnimTick)
    : toPlayerIdlePngPath(playerFacing);
  const enemySprite = enemyWalking
    ? toEnemyWalkFramePath(enemyFacing, walkAnimTick)
    : toEnemyIdlePngPath(enemyFacing);

  void combatFxTick;
  const playerSpriteFx = spriteMotionStyle(playerCombatFx, actorPx);
  const enemySpriteFx = spriteMotionStyle(enemyCombatFx, actorPx);

  return (
    <div ref={arenaRootRef} className={styles.arenaRoot}>
      <div
        ref={mapViewportRef}
        className={`${styles.viewport} ${isDesignPresentation ? styles.viewportDesign : ''}`}
      >
        <canvas ref={mapCanvasRef} className={styles.canvas} />
        <div className={styles.overlay}>
          <div
            className={styles.actor}
            style={{ left: playerScreen.x, top: playerScreen.y }}
          >
            {!isDesignPresentation ? (
              <div className={styles.hpBlock}>
                <div className={styles.hpLabelPlayer}>HP</div>
                <div className={`${styles.hpTrack} ${styles.hpTrackPlayer}`}>
                  <div className={styles.hpFillPlayer} style={{ width: `${playerHpPct}%` }} />
                </div>
              </div>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={playerSprite}
              alt={left.name}
              className={styles.spriteImg}
              style={{
                width: actorPx,
                height: actorPx,
                transform: playerSpriteFx.transform,
                filter: playerSpriteFx.filter,
                transition: playerSpriteFx.transition,
              }}
              draggable={false}
            />
            <div
              className={`${styles.actorName} ${isDesignPresentation ? styles.actorNameDesign : ''}`}
            >
              {left.name}
            </div>
          </div>

          <div
            className={styles.actor}
            style={{ left: enemyScreen.x, top: enemyScreen.y }}
          >
            {!isDesignPresentation ? (
              <div className={styles.hpBlock}>
                <div className={styles.hpLabelEnemy}>HP</div>
                <div className={`${styles.hpTrack} ${styles.hpTrackEnemy}`}>
                  <div className={styles.hpFillEnemy} style={{ width: `${enemyHpPct}%` }} />
                </div>
              </div>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enemySprite}
              alt={right.name}
              className={styles.spriteImgEnemy}
              style={{
                width: actorPx,
                height: actorPx,
                transform: enemySpriteFx.transform,
                filter: enemySpriteFx.filter,
                transition: enemySpriteFx.transition,
              }}
              draggable={false}
            />
            <div
              className={`${styles.actorName} ${isDesignPresentation ? styles.actorNameDesign : ''}`}
            >
              {right.name}
            </div>
          </div>
        </div>

        <MapFxOverlay
          gridToScreen={gridToScreen}
          playerGrid={left.position}
          enemyGrid={right.position}
          projectileFx={projectileFx}
          impactFx={impactFx}
          moveFx={moveFx}
          floatTexts={floatTexts}
        />

        {!hideInternalLog && !isDesignPresentation ? (
          <div className={`${styles.logHud} logHud`}>
            <div className={styles.logHudTitle}>Battle Log</div>
            <div className={styles.logHudBody}>
              {logLines.length === 0 ? (
                <div className={styles.logLine}>Waiting for events…</div>
              ) : (
                logLines.map((line, i) => (
                  <div key={i} className={styles.logLine}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {!isDesignPresentation ? (
          <div className={styles.toolbarDock}>
            <span className={styles.statusChip}>
              T{session.tick} · {session.phase}
            </span>
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.toolbarBtn} ${speed === s ? styles.speedActive : ''}`}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </button>
            ))}
            <button type="button" className={styles.toolbarBtn} onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              className={styles.toolbarBtn}
              disabled={session.result !== 'ongoing'}
              onClick={() => runOneTick()}
            >
              Step
            </button>
            <button type="button" className={styles.toolbarBtn} onClick={handleSkip}>
              Skip
            </button>
            {onStop ? (
              <button type="button" className={styles.toolbarBtn} onClick={onStop}>
                Stop
              </button>
            ) : null}
          </div>
        ) : null}
        {resultOverlay ? (
          <BattleResultOverlay
            open
            outcome={resultOverlay.outcome}
            enemyName={config.enemyName}
            rewardSummaryLines={resultOverlay.rewardLines ?? rewardSummaryLines}
            onContinue={handleResultContinue}
            onBattleAgain={handleBattleAgain}
            onImportProgression={
              onImportProgression && finishedSession ? handleImportProgression : undefined
            }
          />
        ) : null}

      </div>
    </div>
  );
}
