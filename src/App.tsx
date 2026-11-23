import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CloudSun,
  Flame,
  Footprints,
  Globe,
  MapPin,
  MessageSquare,
  Orbit,
  Play,
  Radio,
  RotateCcw,
  Rocket,
  Settings,
  SlidersHorizontal,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { FlatEarthScene } from './scene/FlatEarthScene';
import { WORLD_PLACES, type WorldPlace } from './scene/worldPlaces';
import { SettingsModal } from './components/SettingsModal';
import { downloadGitHubZip, downloadIPhoneHtml } from './utils/exporters';
import {
  DEFAULT_SIM_PARAMS,
  type ActiveLaunchVariant,
  type BroadcastDialogue,
  type CameraFocusMode,
  type FlightPhase,
  type LaunchMode,
  type SimulationParams,
  type TelemetryState,
} from './types/simulation';

const INITIAL_TELEMETRY: TelemetryState = {
  altitudeKm: 0,
  downrangeKm: 0,
  velocityKmS: 0,
  pitchDeg: 0,
  angularRateDegS: 0,
  phase: 'idle',
  activeVariant: 'zero_g',
  antarcticOutcome: 'ufo_intercept',
  ambientPressurePct: 100,
  nozzleSpreadDeg: 12,
  missionTimeSec: 0,
  isLaunching: false,
  hasFailed: false,
  splashedCount: 0,
  issAltitudeKm: 400,
  focusMode: 'rocket',
  pedestrianPlaceName: 'Москва',
  pedestrianRegion: 'Евразия · Россия · Столица',
  pedestrianCoords: '55.8° с.ш., 37.6° в.д.',
  dropPinMode: false,
  weatherMode: 'auto',
  activeWeatherLabel: 'Ясно',
  mapSelection: null,
};

const QUICK_PLACE_IDS = [
  'reptiloid_city',
  'stupino',
  'moscow',
  'khatun_village',
  'washington',
  'sydney',
  'alice_springs',
  'cairo',
  'africa_village',
  'tokyo',
  'rio',
  'outer_outpost',
];

function formatMissionTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `T+${mm}:${ss}`;
}

function getPhaseLabel(phase: FlightPhase): { text: string; toneClass: string } {
  switch (phase) {
    case 'ascent':
      return { text: 'Атмосферный подъём', toneClass: 'text-amber-300' };
    case 'transition':
      return { text: 'Вход в 38–40 км', toneClass: 'text-sky-300' };
    case 'zero_g_loss':
      return { text: 'Невесомость · Сопло 360°', toneClass: 'text-indigo-300' };
    case 'antarctic_cruise':
      return { text: 'Курс на Антарктиду (<40 км)', toneClass: 'text-emerald-300' };
    case 'ufo_intercept':
      return { text: 'НЛО сбивают лазерами у барьера!', toneClass: 'text-lime-300' };
    case 'antarctic_splash':
      return { text: 'Сбита НЛО · Затонула у барьера', toneClass: 'text-cyan-300' };
    case 'outer_breakout':
      return { text: 'Прорыв за ледяной барьер!', toneClass: 'text-emerald-300' };
    case 'parachute_descent':
      return { text: 'Парашют · Спуск на внешние земли', toneClass: 'text-amber-300' };
    case 'outer_landing':
      return { text: 'За барьером · «Ура! Ура!»', toneClass: 'text-yellow-300' };
    case 'ufo_incinerated':
      return { text: 'НЛО испепелили экипаж лазерами', toneClass: 'text-rose-400' };
    case 'failure_falling':
      return { text: 'Отказ · Разделение на части', toneClass: 'text-rose-400' };
    case 'ocean_splash':
      return { text: 'Обломки упали в океан', toneClass: 'text-cyan-300' };
    default:
      return { text: 'Готова к пуску (115 м)', toneClass: 'text-slate-300' };
  }
}

function getVariantBadge(variant: ActiveLaunchVariant): string {
  if (variant === 'antarctica') return 'Вар. 2: Антарктида';
  if (variant === 'failure') return 'Авария';
  return 'Вар. 1: >40 км';
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<FlatEarthScene | null>(null);

  const [params, setParams] = useState<SimulationParams>(DEFAULT_SIM_PARAMS);
  const [telemetry, setTelemetry] = useState<TelemetryState>(INITIAL_TELEMETRY);
  const [dialogue, setDialogue] = useState<BroadcastDialogue | null>(null);
  const [dialogueCollapsed, setDialogueCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState<CameraFocusMode>('rocket');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [sprintActive, setSprintActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const simScene = new FlatEarthScene(
      container,
      DEFAULT_SIM_PARAMS,
      (nextTelem) => {
        setTelemetry(nextTelem);
        setFocusMode(nextTelem.focusMode);
      },
      (nextDialogue) => {
        setDialogue(nextDialogue);
      },
    );
    sceneRef.current = simScene;

    return () => {
      simScene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.updateParams(params);
  }, [params]);

  const placesByContinent = useMemo(() => {
    const groups = new Map<string, WorldPlace[]>();
    for (const p of WORLD_PLACES) {
      const list = groups.get(p.continentLabel) ?? [];
      list.push(p);
      groups.set(p.continentLabel, list);
    }
    return Array.from(groups.entries());
  }, []);

  const quickPlaces = useMemo(
    () =>
      QUICK_PLACE_IDS.map((id) => WORLD_PLACES.find((p) => p.id === id)).filter(
        (p): p is WorldPlace => Boolean(p),
      ),
    [],
  );

  const handleFocusChange = (mode: CameraFocusMode) => {
    setFocusMode(mode);
    sceneRef.current?.setFocusMode(mode);
  };

  const handleTeleportPlace = (placeId: string) => {
    setPlacesOpen(false);
    sceneRef.current?.teleportPedestrianToPlace(placeId, true);
  };

  const handleToggleDropPin = () => {
    const next = !telemetry.dropPinMode;
    sceneRef.current?.setDropPinMode(next);
    if (next) setPlacesOpen(false);
  };

  const handleLaunch = () => {
    sceneRef.current?.launch();
    if (
      focusMode === 'map' ||
      focusMode === 'free' ||
      focusMode === 'iss' ||
      focusMode === 'pedestrian'
    ) {
      setFocusMode('rocket');
    }
  };

  const handleReset = () => {
    sceneRef.current?.resetSimulation();
  };

  const handleFailure = () => {
    sceneRef.current?.triggerFailure();
  };

  const setWalkDir = (x: number, y: number) => {
    sceneRef.current?.setPedestrianInput(x, y, sprintActive);
  };

  const phaseInfo = getPhaseLabel(telemetry.phase);
  const isBroadcast = focusMode === 'broadcast_rocket' || focusMode === 'broadcast_iss';
  const isPedestrian = focusMode === 'pedestrian';

  return (
    <div
      className="relative w-full h-[100dvh] overflow-hidden bg-[#050811] text-slate-100"
      style={{ '--extra-safe-top': `${params.extraTopSafeAreaPx}px` } as React.CSSProperties}
    >
      {/* Dedicated WebGL Canvas Container */}
      <div
        ref={canvasMountRef}
        className={`fixed inset-0 w-full h-full ${
          telemetry.dropPinMode
            ? 'cursor-crosshair'
            : 'cursor-grab active:cursor-grabbing'
        }`}
        aria-label="3D азимутальная карта плоской Земли в масштабе 1:1 км, МКС и прогулка пешехода"
      />

      {/* Safe-Area Top Bar (iOS Dynamic Island / Android 16-17 edge-to-edge protected) */}
      <header className="fixed top-0 left-0 right-0 z-20 pointer-events-none safe-area-top bg-gradient-to-b from-[#050811]/92 via-[#050811]/50 to-transparent pb-2">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2.5">
          {/* Brand wordmark */}
          <div className="pointer-events-auto flex items-center min-h-[44px] shrink-0">
            <span className="text-base sm:text-lg font-semibold tracking-tight text-white whitespace-nowrap">
              Азимут-40
            </span>
          </div>

          {/* Compact tabular telemetry */}
          <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 text-xs sm:text-sm min-w-0 truncate">
            {isPedestrian ? (
              <>
                <span className="font-semibold text-amber-300 whitespace-nowrap truncate">
                  {telemetry.pedestrianPlaceName}
                </span>
                <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-300 truncate hidden sm:inline">
                  {telemetry.pedestrianRegion}
                </span>
              </>
            ) : (
              <>
                <span className="font-mono-tabular text-slate-300 whitespace-nowrap hidden sm:inline">
                  {formatMissionTime(telemetry.missionTimeSec)}
                </span>
                <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono-tabular font-semibold text-white whitespace-nowrap">
                  {focusMode === 'iss' || focusMode === 'broadcast_iss'
                    ? `${telemetry.issAltitudeKm} км`
                    : `${telemetry.altitudeKm.toFixed(2)} км`}
                </span>
                <span className="text-slate-600" aria-hidden="true">
                  /
                </span>
                <span className={`font-medium truncate ${phaseInfo.toneClass}`}>
                  {focusMode === 'broadcast_iss'
                    ? 'Эфир МКС · 400 км'
                    : focusMode === 'iss'
                      ? 'МКС · 400 км'
                      : phaseInfo.text}
                </span>
              </>
            )}
          </div>

          {/* Settings & Export */}
          <div className="pointer-events-auto shrink-0">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Настройки и экспорт"
              className="min-h-[44px] min-w-[44px] px-3 flex items-center justify-center gap-2 rounded-xl bg-[#0d1424]/90 hover:bg-slate-800 border border-slate-700/70 text-slate-200 transition-colors"
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline text-xs font-medium whitespace-nowrap">
                Настройки
              </span>
            </button>
          </div>
        </div>

        {/* Interactive Global Map -> Pedestrian Drop Card / Prompt */}
        {(telemetry.dropPinMode || (focusMode === 'map' && !isBroadcast)) && (
          <div className="max-w-md mx-auto mt-1.5 px-2 pointer-events-auto">
            {telemetry.mapSelection && !telemetry.dropPinMode ? (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0b111e]/94 border border-emerald-400/55 px-3 py-2 text-xs shadow-xl">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                    <span className="font-semibold text-white truncate">
                      {telemetry.mapSelection.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200 shrink-0">
                      {telemetry.mapSelection.surfaceLabel}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    {telemetry.mapSelection.region} · {telemetry.mapSelection.coords}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => sceneRef.current?.confirmMapDropToPedestrian()}
                    className="min-h-[34px] px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1"
                  >
                    <Footprints className="w-3.5 h-3.5" />
                    <span>Идти пешком</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => sceneRef.current?.clearMapSelection()}
                    aria-label="Сбросить точку"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0b111e]/92 border border-amber-400/45 px-3 py-1.5 text-xs shadow-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-amber-300 shrink-0" />
                  <span className="text-amber-100 truncate">
                    {telemetry.dropPinMode
                      ? 'Тапните по карте — пешеход сразу высадится в этой точке'
                      : 'Тапните по любой точке или метке на карте, чтобы выбрать место прогулки'}
                  </span>
                </div>
                {telemetry.dropPinMode && (
                  <button
                    type="button"
                    onClick={handleToggleDropPin}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium shrink-0"
                  >
                    Отмена
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Compact & Fully Collapsible Broadcast Dialogue Overlay */}
        {(dialogue || isBroadcast) && (
          <div className="max-w-md mx-auto mt-1 px-1 pointer-events-auto">
            {dialogueCollapsed ? (
              <div className="flex items-center justify-between gap-1.5">
                <button
                  type="button"
                  onClick={() => setDialogueCollapsed(false)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0b111e]/88 hover:bg-slate-800 border border-slate-700/80 text-[11px] font-medium text-sky-300 shadow"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-rose-400" />
                  <span>{isBroadcast ? 'LIVE · Развернуть чат' : 'Эфир'}</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {isBroadcast && (
                  <button
                    type="button"
                    onClick={() =>
                      handleFocusChange(focusMode === 'broadcast_iss' ? 'iss' : 'rocket')
                    }
                    className="px-2.5 py-1 rounded-lg bg-[#0b111e]/88 hover:bg-slate-800 border border-slate-700 text-[11px] font-medium text-slate-200"
                  >
                    3D вид
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-xl bg-[#0b111e]/90 border border-slate-700/80 px-2.5 py-1.5 shadow-lg space-y-1">
                {/* Single compact header bar */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 text-[10px]">
                    <Radio className="w-3 h-3 text-rose-400 shrink-0" />
                    <span className="font-semibold text-rose-300 uppercase">
                      {isBroadcast ? 'LIVE' : 'Связь'}
                    </span>
                    <span className="text-slate-400 truncate">
                      {focusMode === 'broadcast_iss'
                        ? 'Купол МКС (вращайте экран)'
                        : focusMode === 'broadcast_rocket'
                          ? 'Кабина (вращайте экран)'
                          : 'Бортовой канал'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isBroadcast && (
                      <button
                        type="button"
                        onClick={() =>
                          handleFocusChange(focusMode === 'broadcast_iss' ? 'iss' : 'rocket')
                        }
                        className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-[10px] font-medium text-sky-300"
                      >
                        3D вид
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDialogueCollapsed(true)}
                      aria-label="Свернуть текст трансляции"
                      className="px-1.5 py-0.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-[10px] text-slate-300 flex items-center gap-0.5"
                    >
                      <ChevronUp className="w-3 h-3" />
                      <span>Свернуть</span>
                    </button>
                    {!isBroadcast && (
                      <button
                        type="button"
                        onClick={() => setDialogue(null)}
                        aria-label="Закрыть сообщение"
                        className="p-0.5 text-slate-400 hover:text-slate-200"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {dialogue && (
                  <p className="text-[11px] leading-snug text-slate-100 line-clamp-3">
                    <span
                      className={`font-semibold mr-1 ${
                        dialogue.channel === 'ufo'
                          ? 'text-lime-300'
                          : dialogue.channel === 'iss'
                            ? 'text-sky-300'
                            : 'text-amber-300'
                      }`}
                    >
                      {dialogue.speaker}:
                    </span>
                    «{dialogue.text}»
                  </p>
                )}

                {focusMode === 'broadcast_iss' && (
                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                    {(
                      [
                        ['stars', 'Звёзды?'],
                        ['shape', 'Шар?'],
                        ['space', 'Космос?'],
                        ['report', 'ЦУП'],
                      ] as const
                    ).map(([topic, label]) => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => sceneRef.current?.triggerInteractivePrompt('iss', topic)}
                        className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-medium text-sky-200 whitespace-nowrap shrink-0"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {focusMode === 'broadcast_rocket' && (
                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                    {(
                      [
                        ['barrier', 'К барьеру?'],
                        ['beyond', 'За стеной?'],
                        ['status', 'Доклад'],
                      ] as const
                    ).map(([topic, label]) => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => sceneRef.current?.triggerInteractivePrompt('rocket', topic)}
                        className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-medium text-amber-200 whitespace-nowrap shrink-0"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Right-Edge Zoom Rail */}
      <div
        className="fixed z-20 right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2"
        style={{ right: 'max(12px, env(safe-area-inset-right, 0px))' }}
      >
        <button
          type="button"
          onClick={() => sceneRef.current?.zoomStep(0.68)}
          aria-label="Приблизить камеру"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#0b111e]/90 hover:bg-slate-800 border border-slate-700/70 text-slate-200 transition-colors"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => sceneRef.current?.zoomStep(1.48)}
          aria-label="Отдалить камеру"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#0b111e]/90 hover:bg-slate-800 border border-slate-700/70 text-slate-200 transition-colors"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile Touch Walking Pad & Location Badge in Pedestrian Mode */}
      {isPedestrian && (
        <div
          className={`fixed left-3 z-20 pointer-events-auto flex flex-col items-start gap-2 transition-all ${
            dockCollapsed ? 'bottom-14' : 'bottom-[218px] sm:bottom-[208px]'
          }`}
          style={{ left: 'max(12px, env(safe-area-inset-left, 0px))' }}
        >
          <div className="rounded-xl bg-[#0b111e]/88 border border-slate-700/80 px-2.5 py-1.5 text-[11px] max-w-[225px] space-y-1">
            <div className="font-semibold text-amber-300 truncate">
              {telemetry.pedestrianPlaceName}
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {telemetry.pedestrianCoords}
            </div>
            <button
              type="button"
              onClick={() => sceneRef.current?.cycleWeatherMode()}
              className="w-full px-2 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-[10px] font-medium text-sky-200 flex items-center justify-between gap-1.5"
            >
              <span className="flex items-center gap-1 truncate">
                <CloudSun className="w-3 h-3 text-sky-300 shrink-0" />
                <span>Погода: {telemetry.activeWeatherLabel}</span>
              </span>
              <span className="text-[9px] text-slate-400 shrink-0">Сменить</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1.5 rounded-2xl bg-[#0b111e]/88 border border-slate-700/80 shadow-xl select-none">
            <div />
            <button
              type="button"
              aria-label="Идти вперёд"
              onPointerDown={() => setWalkDir(0, 1)}
              onPointerUp={() => setWalkDir(0, 0)}
              onPointerCancel={() => setWalkDir(0, 0)}
              onPointerLeave={() => setWalkDir(0, 0)}
              className="w-11 h-11 rounded-xl bg-slate-800/95 active:bg-sky-500/40 border border-slate-600/70 flex items-center justify-center text-slate-100"
            >
              <ChevronUp className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setSprintActive((s) => !s)}
              className={`w-11 h-11 rounded-xl border text-[10px] font-semibold flex items-center justify-center ${
                sprintActive
                  ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                  : 'bg-slate-900/90 border-slate-700 text-slate-400'
              }`}
            >
              Бег
            </button>

            <button
              type="button"
              aria-label="Идти влево"
              onPointerDown={() => setWalkDir(-1, 0)}
              onPointerUp={() => setWalkDir(0, 0)}
              onPointerCancel={() => setWalkDir(0, 0)}
              onPointerLeave={() => setWalkDir(0, 0)}
              className="w-11 h-11 rounded-xl bg-slate-800/95 active:bg-sky-500/40 border border-slate-600/70 flex items-center justify-center text-slate-100"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              aria-label="Идти назад"
              onPointerDown={() => setWalkDir(0, -1)}
              onPointerUp={() => setWalkDir(0, 0)}
              onPointerCancel={() => setWalkDir(0, 0)}
              onPointerLeave={() => setWalkDir(0, 0)}
              className="w-11 h-11 rounded-xl bg-slate-800/95 active:bg-sky-500/40 border border-slate-600/70 flex items-center justify-center text-slate-100"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
            <button
              type="button"
              aria-label="Идти вправо"
              onPointerDown={() => setWalkDir(1, 0)}
              onPointerUp={() => setWalkDir(0, 0)}
              onPointerCancel={() => setWalkDir(0, 0)}
              onPointerLeave={() => setWalkDir(0, 0)}
              className="w-11 h-11 rounded-xl bg-slate-800/95 active:bg-sky-500/40 border border-slate-600/70 flex items-center justify-center text-slate-100"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Continent-Grouped All Places Selector Sheet */}
      {placesOpen && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/65 p-3">
          <div className="w-full max-w-xl max-h-[78dvh] flex flex-col rounded-2xl bg-[#0d1424] border border-slate-700/80 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Города и деревни на всех континентах
                </h2>
                <p className="text-[11px] text-slate-400">
                  Выберите точку для пешей прогулки или опустите пешехода с карты
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlacesOpen(false)}
                aria-label="Закрыть выбор мест"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 overflow-y-auto space-y-3">
              <button
                type="button"
                onClick={handleToggleDropPin}
                className="w-full min-h-[42px] px-3 rounded-xl bg-amber-500/18 hover:bg-amber-500/28 border border-amber-400/45 text-amber-200 text-xs font-semibold flex items-center justify-center gap-2"
              >
                <MapPin className="w-4 h-4" />
                <span>Выбрать произвольное место прямо на 3D-карте Земли</span>
              </button>

              {placesByContinent.map(([continent, list]) => (
                <div key={continent} className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1">
                    {continent}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {list.map((place) => {
                      const active =
                        isPedestrian && telemetry.pedestrianPlaceName === place.name;
                      return (
                        <button
                          key={place.id}
                          type="button"
                          onClick={() => handleTeleportPlace(place.id)}
                          className={`min-h-[42px] px-3 py-1.5 rounded-xl border text-left transition-colors flex items-center justify-between gap-2 ${
                            active
                              ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                              : 'bg-slate-900/90 hover:bg-slate-800 border-slate-800 text-slate-200'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{place.name}</div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {place.region}
                            </div>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                            {place.landmark === 'reptiloid'
                              ? 'Рептилоиды'
                              : place.type === 'village'
                                ? 'Деревня'
                                : place.type === 'outer'
                                  ? 'За стеной'
                                  : place.type === 'town'
                                    ? 'Город'
                                    : 'Мегаполис'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Ergonomic Bottom Control Dock */}
      <div className="fixed bottom-0 left-0 right-0 z-20 pointer-events-none safe-area-bottom">
        <div className="max-w-3xl mx-auto px-3 flex flex-col items-center">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="pointer-events-auto mb-1.5 px-3.5 py-1.5 rounded-t-xl bg-[#0b111e]/92 border border-b-0 border-slate-800 text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Пуск, трансляции и пешеход</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Свернуть панель</span>
              </>
            )}
          </button>

          {!dockCollapsed && (
            <div className="pointer-events-auto w-full rounded-2xl bg-[#0b111e]/94 border border-slate-800 shadow-2xl p-2.5 sm:p-3 space-y-2">
              {/* Expandable Physical Visual Editor */}
              {editorOpen && (
                <div className="pb-2 border-b border-slate-800/90 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">Темп (40 км ≈ 60с):</span>
                    <div className="flex items-center gap-1.5">
                      {[0.5, 1, 2, 4].map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => setParams((p) => ({ ...p, timeScale: spd }))}
                          className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-mono-tabular font-medium transition-colors whitespace-nowrap ${
                            params.timeScale === spd
                              ? 'bg-sky-500/25 text-sky-300 border border-sky-400/40'
                              : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {spd}×
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
                    <label className="block space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-300">
                        <span>Граница невесомости</span>
                        <span className="font-mono-tabular text-sky-300">
                          {params.zeroGStartKm}–{params.zeroGFullKm} км
                        </span>
                      </div>
                      <input
                        type="range"
                        min={32}
                        max={42}
                        step={1}
                        value={params.zeroGStartKm}
                        onChange={(e) => {
                          const start = Number(e.target.value);
                          setParams((prev) => ({
                            ...prev,
                            zeroGStartKm: start,
                            zeroGFullKm: Math.max(start + 2, 40),
                          }));
                        }}
                        className="sim-slider"
                      />
                    </label>

                    <label className="block space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-300">
                        <span>Распыление света/газов из сопла</span>
                        <span className="font-mono-tabular text-sky-300">
                          {Math.round(params.plumeDispersion * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={2.0}
                        step={0.05}
                        value={params.plumeDispersion}
                        onChange={(e) =>
                          setParams((prev) => ({
                            ...prev,
                            plumeDispersion: Number(e.target.value),
                          }))
                        }
                        className="sim-slider"
                      />
                    </label>

                    <label className="block space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-300">
                        <span>Потеря стабилизации (&gt;40 км)</span>
                        <span className="font-mono-tabular text-sky-300">
                          {Math.round(params.tumbleIntensity * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.2}
                        max={2.0}
                        step={0.05}
                        value={params.tumbleIntensity}
                        onChange={(e) =>
                          setParams((prev) => ({
                            ...prev,
                            tumbleIntensity: Number(e.target.value),
                          }))
                        }
                        className="sim-slider"
                      />
                    </label>

                    <label className="block space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-300">
                        <span>Яркость облака в тёмном небе</span>
                        <span className="font-mono-tabular text-sky-300">
                          {Math.round(params.plumeGlow * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.4}
                        max={2.0}
                        step={0.05}
                        value={params.plumeGlow}
                        onChange={(e) =>
                          setParams((prev) => ({
                            ...prev,
                            plumeGlow: Number(e.target.value),
                          }))
                        }
                        className="sim-slider"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Quick Pedestrian Cities & Map-Drop Bar (visible in Pedestrian or Map focus) */}
              {(isPedestrian || focusMode === 'map') && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  <button
                    type="button"
                    onClick={handleToggleDropPin}
                    className={`min-h-[34px] px-2.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                      telemetry.dropPinMode
                        ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                        : 'bg-amber-500/12 hover:bg-amber-500/20 border-amber-400/40 text-amber-200'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{telemetry.dropPinMode ? 'Клик по карте...' : 'С карты'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlacesOpen(true)}
                    className="min-h-[34px] px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium text-sky-200 whitespace-nowrap shrink-0"
                  >
                    Все города ({WORLD_PLACES.length})
                  </button>
                  {quickPlaces.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleTeleportPlace(p.id)}
                      className={`min-h-[34px] px-2.5 rounded-lg border text-[11px] font-medium whitespace-nowrap shrink-0 ${
                        isPedestrian && telemetry.pedestrianPlaceName === p.name
                          ? 'bg-sky-500/22 border-sky-400/50 text-sky-200'
                          : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Compact Telemetry Strip (when in Rocket/ISS modes) */}
              {!isPedestrian && focusMode !== 'map' && (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-400 px-0.5">
                  <div className="flex items-center gap-1.5 font-mono-tabular">
                    <span>Режим:</span>
                    <span className="text-sky-300 font-medium">
                      {getVariantBadge(telemetry.activeVariant)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono-tabular">
                    <span>Время:</span>
                    <span className="text-slate-200 font-medium">
                      {formatMissionTime(telemetry.missionTimeSec)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono-tabular">
                    <span>Дальность:</span>
                    <span className="text-slate-200 font-medium">
                      {telemetry.downrangeKm.toFixed(1)} км
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono-tabular">
                    <span>Распыление:</span>
                    <span className="text-slate-200 font-medium">
                      {telemetry.hasFailed
                        ? 'Отказ'
                        : telemetry.phase === 'ufo_intercept' ||
                            telemetry.phase === 'ufo_incinerated'
                          ? 'Лазеры НЛО'
                          : telemetry.phase === 'antarctic_splash'
                            ? 'Затонула'
                            : telemetry.phase === 'outer_landing'
                              ? 'За стеной!'
                              : `${telemetry.nozzleSpreadDeg}°`}
                    </span>
                  </div>
                </div>
              )}

              {/* Row 1: Launch Scenario Selector */}
              {!isPedestrian && (
                <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-900/95 border border-slate-800">
                  {(
                    [
                      ['combined', 'Комби (1+2)'],
                      ['variant_zero_g', '1: >40 км'],
                      ['variant_antarctica', '2: Антарктида'],
                      ['forced_failure', 'Авария'],
                    ] as [LaunchMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setParams((p) => ({ ...p, launchMode: mode }))}
                      className={`min-h-[32px] px-1.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap truncate ${
                        params.launchMode === mode
                          ? 'bg-sky-500/22 text-sky-200 border border-sky-400/45'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Row 2: Online Broadcast Switcher & Launch Actions */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleLaunch}
                  className="min-h-[42px] px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 flex-1 sm:flex-none"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{telemetry.isLaunching ? 'Новый пуск' : 'Пуск'}</span>
                </button>

                {telemetry.isLaunching &&
                  !telemetry.hasFailed &&
                  telemetry.phase !== 'antarctic_splash' &&
                  telemetry.phase !== 'ufo_incinerated' && (
                    <button
                      type="button"
                      onClick={handleFailure}
                      aria-label="Аварийное разделение ракеты"
                      className="min-h-[42px] px-2.5 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-200 text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      <span className="hidden sm:inline">Отказ</span>
                    </button>
                  )}

                <button
                  type="button"
                  onClick={handleReset}
                  aria-label="Сбросить ракету на старт"
                  className="min-h-[42px] min-w-[42px] px-2.5 py-1.5 rounded-xl bg-slate-800/85 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-medium flex items-center justify-center transition-colors shrink-0"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                  <button
                    type="button"
                    onClick={() => handleFocusChange('broadcast_rocket')}
                    className={`min-h-[42px] flex-1 px-2 py-1.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
                      focusMode === 'broadcast_rocket'
                        ? 'bg-rose-500/25 border-rose-400/60 text-rose-200'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 text-slate-200'
                    }`}
                  >
                    <Video className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                    <span>Эфир: Ракета</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFocusChange('broadcast_iss')}
                    className={`min-h-[42px] flex-1 px-2 py-1.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
                      focusMode === 'broadcast_iss'
                        ? 'bg-rose-500/25 border-rose-400/60 text-rose-200'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 text-slate-200'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                    <span>Эфир: МКС</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setEditorOpen((v) => !v)}
                  aria-expanded={editorOpen}
                  aria-label="Параметры физической модели"
                  className={`min-h-[42px] px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    editorOpen
                      ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200'
                      : 'bg-slate-800/85 hover:bg-slate-800 border-slate-700/80 text-slate-300'
                  }`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  <span className="hidden sm:inline">Физика</span>
                </button>
              </div>

              {/* Row 3: 3D Camera Focus Bar */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-slate-800 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => handleFocusChange('rocket')}
                  className={`min-h-[36px] flex-1 px-2 py-1 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    focusMode === 'rocket'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-400/35'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Rocket className="w-3.5 h-3.5" />
                  <span>Ракета</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFocusChange('engine')}
                  className={`min-h-[36px] flex-1 px-2 py-1 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    focusMode === 'engine'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-400/35'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>Сопло</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFocusChange('plume')}
                  className={`min-h-[36px] flex-1 px-2 py-1 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    focusMode === 'plume'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-400/35'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <CloudSun className="w-3.5 h-3.5" />
                  <span>Шлейф</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFocusChange('iss')}
                  className={`min-h-[36px] flex-1 px-2 py-1 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    focusMode === 'iss'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-400/35'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Orbit className="w-3.5 h-3.5" />
                  <span>МКС</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFocusChange('pedestrian')}
                  className={`min-h-[36px] flex-1 px-2 py-1 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    focusMode === 'pedestrian'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Footprints className="w-3.5 h-3.5" />
                  <span>Пешеход</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFocusChange('map')}
                  className={`min-h-[36px] flex-1 px-2 py-1 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                    focusMode === 'map'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-400/35'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Карта</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings & Export Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        params={params}
        onChangeParams={setParams}
        onExportIPhoneHtml={() => downloadIPhoneHtml(params)}
        onExportGitHubZip={() => downloadGitHubZip(params)}
      />
    </div>
  );
}
