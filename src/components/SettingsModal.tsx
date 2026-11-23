import React, { useState } from 'react';
import { Download, FileCode2, FolderGit2, Smartphone, X, Check } from 'lucide-react';
import type { SimulationParams } from '../types/simulation';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  params: SimulationParams;
  onChangeParams: (next: SimulationParams) => void;
  onExportIPhoneHtml: () => void;
  onExportGitHubZip: () => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  params,
  onChangeParams,
  onExportIPhoneHtml,
  onExportGitHubZip,
}) => {
  const [exportStatus, setExportStatus] = useState<'idle' | 'iphone_done' | 'github_busy' | 'github_done'>('idle');

  if (!isOpen) return null;

  const handleIPhoneDownload = () => {
    onExportIPhoneHtml();
    setExportStatus('iphone_done');
    window.setTimeout(() => setExportStatus('idle'), 2600);
  };

  const handleGitHubDownload = async () => {
    setExportStatus('github_busy');
    try {
      await onExportGitHubZip();
      setExportStatus('github_done');
      window.setTimeout(() => setExportStatus('idle'), 2600);
    } catch {
      setExportStatus('idle');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-lg max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-[#0c1220] border border-slate-800 text-slate-100 shadow-2xl safe-area-bottom">
        {/* Mobile sheet drag indicator */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80">
          <div>
            <h2 id="settings-title" className="text-base font-semibold tracking-tight text-white">
              Настройки и экспорт
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Автономная сборка, GitHub-репозиторий и калибровка экрана
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Export section */}
          <section className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Скачать проект
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleIPhoneDownload}
                className="min-h-[52px] flex items-center gap-3 px-4 py-3 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-left transition-colors active:scale-[0.99]"
              >
                <div className="w-9 h-9 rounded-lg bg-sky-500/20 flex items-center justify-center shrink-0 text-sky-300">
                  {exportStatus === 'iphone_done' ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <FileCode2 className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    HTML для iPhone
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {exportStatus === 'iphone_done'
                      ? 'Файл скачан'
                      : 'Один автономный .html'}
                  </div>
                </div>
                <Download className="w-4 h-4 text-sky-300 ml-auto shrink-0" />
              </button>

              <button
                type="button"
                onClick={handleGitHubDownload}
                disabled={exportStatus === 'github_busy'}
                className="min-h-[52px] flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-left transition-colors active:scale-[0.99] disabled:opacity-60"
              >
                <div className="w-9 h-9 rounded-lg bg-slate-700/70 flex items-center justify-center shrink-0 text-slate-200">
                  {exportStatus === 'github_done' ? (
                    <Check className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <FolderGit2 className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    GitHub → APK
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {exportStatus === 'github_busy'
                      ? 'Сборка архива...'
                      : exportStatus === 'github_done'
                        ? 'ZIP готов'
                        : 'Android 16–17 (.zip)'}
                  </div>
                </div>
                <Download className="w-4 h-4 text-slate-300 ml-auto shrink-0" />
              </button>
            </div>

            <p className="text-[12px] leading-relaxed text-slate-400">
              <strong className="text-slate-300 font-medium">iPhone:</strong> откройте HTML в Safari и добавьте на экран «Домой».{' '}
              <strong className="text-slate-300 font-medium">Android 16–17 APK:</strong> загрузите содержимое ZIP (включая <code className="text-slate-300">.github/workflows</code>, <code className="text-slate-300">android/</code> и <code className="text-slate-300">scripts/</code>) на GitHub — вкладка <em>Actions</em> соберёт <code className="text-slate-300">.apk</code> автоматически, либо запустите <code className="text-slate-300">build-apk.bat</code> / <code className="text-slate-300">build-apk.sh</code> локально.
            </p>
          </section>

          <div className="h-px bg-slate-800/90" />

          {/* Mobile Safe Area Calibration */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-slate-400" />
                <h3 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Адаптация под шторку (iOS / Android 16–17)
                </h3>
              </div>
              <span className="font-mono-tabular text-xs text-sky-300">
                +{params.extraTopSafeAreaPx} px
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={36}
              step={2}
              value={params.extraTopSafeAreaPx}
              onChange={(e) =>
                onChangeParams({
                  ...params,
                  extraTopSafeAreaPx: Number(e.target.value),
                })
              }
              aria-label="Дополнительный отступ от верхней шторки"
              className="sim-slider"
            />
            <p className="text-[12px] text-slate-400">
              Системный отступ <code className="text-slate-300">env(safe-area-inset-top)</code> включён
              автоматически. Увеличьте ползунок при запуске внутри нестандартной оболочки Android 16–17.
            </p>
          </section>

          <div className="h-px bg-slate-800/90" />

          {/* Map & Reference visual check */}
          <section className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Слои карты и эталон эффекта
            </h3>

            <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
              <span className="text-sm text-slate-200">
                Показывать плоскость границы 38–40 км
              </span>
              <input
                type="checkbox"
                checked={params.showBoundaryPlane}
                onChange={(e) =>
                  onChangeParams({ ...params, showBoundaryPlane: e.target.checked })
                }
                className="w-5 h-5 accent-sky-400 rounded cursor-pointer"
              />
            </label>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-200">Земли за Антарктидой (видимость)</span>
                <span className="font-mono-tabular text-xs text-slate-300">
                  {Math.round(params.outerLandsVisibility * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.15}
                max={1}
                step={0.05}
                value={params.outerLandsVisibility}
                onChange={(e) =>
                  onChangeParams({
                    ...params,
                    outerLandsVisibility: Number(e.target.value),
                  })
                }
                aria-label="Видимость земель за Антарктидой"
                className="sim-slider"
              />
            </div>

            {/* Visual reference image thumbnail */}
            <div className="pt-2">
              <div className="text-xs text-slate-400 mb-2">
                Эталон свечения соплового шлейфа в поле невесомости:
              </div>
              <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-video">
                <img
                  src="/assets/aistudio/i_e74ad2f4.jpeg"
                  alt="Эталон свечения газового шлейфа на высоте выше 40 км"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent text-[11px] text-slate-200">
                  Равномерное расширение газов из сопла + извилистый след ниже 40 км
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
