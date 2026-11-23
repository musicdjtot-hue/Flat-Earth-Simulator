import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CloudSun,
  Flame,
  Globe,
  Play,
  RotateCcw,
  Rocket,
  Settings,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { FlatEarthScene } from './scene/FlatEarthScene';
import { SettingsModal } from './components/SettingsModal';
import { downloadGitHubZip, downloadIPhoneHtml } from './utils/exporters';
import {
  DEFAULT_SIM_PARAMS,
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
  ambientPressurePct: 100,
  nozzleSpreadDeg: 12,
  missionTimeSec: 0,
  isLaunching: false,
  hasFailed: false,
  splashedCount: 0,
};

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
      return { text: 'Невесомость · Свет из сопла 360°', toneClass: 'text-indigo-300' };
    case 'failure_falling':
      return { text: 'Отказ · Разделение на части', toneClass: 'text-rose-400' };
    case 'ocean_splash':
      return { text: 'Обломки упали в океан', toneClass: 'text-cyan-300' };
    default:
      return { text: 'Готова к пуску (115 м)', toneClass: 'text-slate-300' };
  }
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<FlatEarthScene | null>(null);

  const [params, setParams] = useState<SimulationParams>(DEFAULT_SIM_PARAMS);
  const [telemetry, setTelemetry] = useState<TelemetryState>(INITIAL_TELEMETRY);
  const [focusMode, setFocusMode] = useState<CameraFocusMode>('rocket');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const simScene = new FlatEarthScene(container, DEFAULT_SIM_PARAMS, (nextTelem) => {
      setTelemetry(nextTelem);
    });
    sceneRef.current = simScene;

    return () => {
      simScene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.updateParams(params);
  }, [params]);

  const handleFocusChange = (mode: CameraFocusMode) => {
    setFocusMode(mode);
    sceneRef.current?.setFocusMode(mode);
  };

  const handleLaunch = () => {
    sceneRef.current?.launch();
    if (focusMode === 'map' || focusMode === 'free') {
      setFocusMode('rocket');
    }
  };

  const handleReset = () => {
    sceneRef.current?.resetSimulation();
  };

  const handleFailure = () => {
    sceneRef.current?.triggerFailure();
  };

  const phaseInfo = getPhaseLabel(telemetry.phase);

  return (
    <div
      className="relative w-full h-[100dvh] overflow-hidden bg-[#050811] text-slate-100"
      style={{ '--extra-safe-top': `${params.extraTopSafeAreaPx}px` } as React.CSSProperties}
    >
      {/* Dedicated WebGL Canvas Container */}
      <div
        ref={canvasMountRef}
        className="fixed inset-0 w-full h-full cursor-grab active:cursor-grabbing"
        aria-label="3D азимутальная карта плоской Земли в масштабе 1:1 км и симуляция пуска ракеты"
      />

      {/* Safe-Area Top Bar (iOS Dynamic Island / Android 16-17 edge-to-edge protected) */}
      <header className="fixed top-0 left-0 right-0 z-20 pointer-events-none safe-area-top bg-gradient-to-b from-[#050811]/90 via-[#050811]/45 to-transparent pb-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          {/* Zone 1: Brand wordmark */}
          <div className="pointer-events-auto flex items-center min-h-[44px] shrink-0">
            <span className="text-base sm:text-lg font-semibold tracking-tight text-white whitespace-nowrap">
              Азимут-40
            </span>
          </div>

          {/* Zone 2: Unboxed tabular telemetry */}
          <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 text-xs sm:text-sm min-w-0 truncate">
            <span className="font-mono-tabular text-slate-300 whitespace-nowrap hidden xs:inline sm:inline">
              {formatMissionTime(telemetry.missionTimeSec)}
            </span>
            <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="font-mono-tabular font-semibold text-white whitespace-nowrap">
              {telemetry.altitudeKm.toFixed(2)} км
            </span>
            <span className="text-slate-600" aria-hidden="true">
              /
            </span>
            <span className={`font-medium truncate ${phaseInfo.toneClass}`}>
              {phaseInfo.text}
            </span>
          </div>

          {/* Zone 3: Settings & Export */}
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
      </header>

      {/* Right-Edge Zoom Rail */}
      <div
        className="fixed z-20 right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2"
        style={{ right: 'max(12px, env(safe-area-inset-right, 0px))' }}
      >
        <button
          type="button"
          onClick={() => sceneRef.current?.zoomStep(0.68)}
          aria-label="Приблизить модель"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#0b111e]/90 hover:bg-slate-800 border border-slate-700/70 text-slate-200 transition-colors"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => sceneRef.current?.zoomStep(1.48)}
          aria-label="Отдалить модель"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#0b111e]/90 hover:bg-slate-800 border border-slate-700/70 text-slate-200 transition-colors"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
      </div>

      {/* Collapsible Bottom Control Dock */}
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
                <span>Открыть управление</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Свернуть панель</span>
              </>
            )}
          </button>

          {!dockCollapsed && (
            <div className="pointer-events-auto w-full rounded-2xl bg-[#0b111e]/92 border border-slate-800 shadow-2xl p-3 space-y-3">
              {/* Expandable Physical Visual Editor */}
              {editorOpen && (
                <div className="pb-3 border-b border-slate-800/90 space-y-3">
                  {/* Time scale & Launch Reliability */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 mr-1">Темп (40 км ≈ 60с):</span>
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

                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 mr-1">Старт:</span>
                      {(
                        [
                          ['occasional_failure', 'Иногда отказ'],
                          ['nominal', 'Штатный'],
                          ['forced_failure', 'Авария'],
                        ] as [LaunchMode, string][]
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setParams((p) => ({ ...p, launchMode: mode }))}
                          className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                            params.launchMode === mode
                              ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-400/40'
                              : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
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

              {/* Unboxed Precision Telemetry Strip */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-slate-400 px-0.5">
                <div className="flex items-center gap-1.5 font-mono-tabular">
                  <span>Время:</span>
                  <span className="text-slate-200 font-medium">
                    {formatMissionTime(telemetry.missionTimeSec)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 font-mono-tabular">
                  <span>Снос:</span>
                  <span className="text-slate-200 font-medium">
                    {telemetry.downrangeKm.toFixed(1)} км
                  </span>
                </div>
                <div className="flex items-center gap-1.5 font-mono-tabular">
                  <span>Скорость:</span>
                  <span className="text-slate-200 font-medium">
                    {telemetry.velocityKmS.toFixed(2)} км/с
                  </span>
                </div>
                <div className="flex items-center gap-1.5 font-mono-tabular">
                  <span>Распыление:</span>
                  <span className="text-slate-200 font-medium">
                    {telemetry.hasFailed ? 'Отказ' : `${telemetry.nozzleSpreadDeg}°`}
                  </span>
                </div>
              </div>

              {/* Primary Control Bar */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleLaunch}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 flex-1 sm:flex-none"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{telemetry.isLaunching ? 'Новый пуск' : 'Пуск'}</span>
                </button>

                {telemetry.isLaunching && !telemetry.hasFailed && (
                  <button
                    type="button"
                    onClick={handleFailure}
                    aria-label="Аварийное разделение ракеты"
                    className="min-h-[44px] px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    <span className="hidden sm:inline">Отказ</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleReset}
                  aria-label="Сбросить ракету на старт"
                  className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-slate-800/85 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                {/* Camera Focus Selector */}
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-slate-800 flex-1 sm:flex-initial justify-between overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => handleFocusChange('rocket')}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                      focusMode === 'rocket'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    <span>Ракета</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFocusChange('engine')}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                      focusMode === 'engine'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>Сопло</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFocusChange('plume')}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                      focusMode === 'plume'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CloudSun className="w-3.5 h-3.5" />
                    <span>Шлейф</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFocusChange('map')}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                      focusMode === 'map'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Карта</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setEditorOpen((v) => !v)}
                  aria-expanded={editorOpen}
                  aria-label="Параметры физической модели"
                  className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                    editorOpen
                      ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200'
                      : 'bg-slate-800/85 hover:bg-slate-800 border-slate-700/80 text-slate-300'
                  }`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  <span className="hidden sm:inline">Физика</span>
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
