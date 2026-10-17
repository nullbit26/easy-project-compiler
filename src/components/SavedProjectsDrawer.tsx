import React, { useEffect, useState } from 'react';
import { ProjectState } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { FolderGit2, Trash2, Sparkles, FolderOpen, X, ArrowRight, Check, Cpu, Layers } from 'lucide-react';

interface SavedProjectsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  allProjects: ProjectState[];
  currentProject: ProjectState | null;
  onSelectProject: (proj: ProjectState) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenNewProjectModal: () => void;
}

export const SavedProjectsDrawer: React.FC<SavedProjectsDrawerProps> = ({
  isOpen,
  onClose,
  allProjects,
  currentProject,
  onSelectProject,
  onDeleteProject,
  onOpenNewProjectModal
}) => {
  const { t, language } = useLanguage();
  /** The card that asked to be deleted; the project itself is untouched until this is confirmed. */
  const [pendingId, setPendingId] = useState<string | null>(null);

  /*
   * Escape closes the drawer.
   *
   * The drawer is opened from the top bar and closed by its backdrop or its ✕; without this the key
   * did nothing, which is the one way out people try first.
   */
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="saved-projects-title"
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-slate-900 border-l border-slate-800 text-slate-100 shadow-2xl flex flex-col justify-between">
          {/* Header */}
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-500/15 text-indigo-400 rounded-lg">
                <FolderGit2 className="w-5 h-5" />
              </div>
              <div>
                <h2 id="saved-projects-title" className="text-base font-bold text-white">{t.drawer.title}</h2>
                <p className="text-xs text-slate-400">{t.drawer.subtitle} ({allProjects.length})</p>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label={t.common.close}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Project List Content */}
          <div className="p-5 flex-1 overflow-y-auto space-y-3">
            {allProjects.length === 0 ? (
              <div className="text-center py-12 space-y-3 bg-slate-950/50 border border-slate-800/80 rounded-2xl p-6 my-4">
                <FolderOpen className="w-10 h-10 text-slate-400 mx-auto" />
                <h3 className="text-sm font-bold text-slate-300">{t.drawer.emptyTitle}</h3>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  {t.drawer.emptyNotice}
                </p>
                <button
                  onClick={() => {
                    onClose();
                    onOpenNewProjectModal();
                  }}
                  className="mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{t.common.newProject}</span>
                </button>
              </div>
            ) : (
              allProjects.map((proj) => {
                const isActive = currentProject?.id === proj.id;
                const totalTasks = proj.phases.flatMap((p) => p.tasks).length;
                const completedTasks = proj.phases.flatMap((p) => p.tasks).filter((t) => t.status === 'completed').length;
                const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

                return (
                  <div
                    key={proj.id}
                    className={`border rounded-xl p-4 transition-all space-y-3 ${
                      isActive
                        ? 'bg-indigo-950/40 border-indigo-500/80 shadow-md ring-1 ring-indigo-500/30'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-white">{proj.name}</h3>
                          {isActive && (
                            <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.2 rounded font-bold uppercase tracking-wider">
                              {t.drawer.currentBadge}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded font-semibold">
                            {proj.projectType} • {proj.engineOrFramework}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => setPendingId(pendingId === proj.id ? null : proj.id)}
                        className="text-slate-400 hover:text-rose-400 p-1.5 hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
                        title={t.drawer.deleteHint}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="text-xs text-slate-400 space-y-1 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <Cpu className="w-3 h-3 text-indigo-400" />
                          <span>{t.common.targetAgent}:</span>
                        </span>
                        <strong className="text-indigo-300 font-semibold">{proj.selectedAgent}</strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3 text-emerald-400" />
                          <span>{language === 'ru' ? 'Прогресс задач:' : 'Tasks Progress:'}</span>
                        </span>
                        <span className="text-slate-200 font-medium">{completedTasks}/{totalTasks} ({progressPct}%)</span>
                      </div>
                    </div>

                    {/* Two steps on purpose: a saved project is not something to lose on a misclick. */}
                    {pendingId === proj.id && (
                      <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-2.5 space-y-2">
                        <p className="text-[11px] font-bold text-rose-200">{t.drawer.deleteConfirmTitle}</p>
                        <p className="text-[10px] text-slate-400">{t.drawer.deleteConfirmNotice}</p>
                        <div className="flex justify-end gap-2">
                          <button
                            data-drawer-delete-cancel
                            onClick={() => setPendingId(null)}
                            className="text-[10px] font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            {t.common.cancel}
                          </button>
                          <button
                            data-drawer-delete-confirm
                            onClick={() => {
                              onDeleteProject(proj.id);
                              setPendingId(null);
                            }}
                            className="text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-500 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            {t.common.delete}
                          </button>
                        </div>
                      </div>
                    )}

                    {!isActive && (
                      <button
                        onClick={() => {
                          onSelectProject(proj);
                          onClose();
                        }}
                        className="w-full bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-200 font-semibold text-xs py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span>{t.drawer.openProject}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Action */}
          <div className="p-4 border-t border-slate-800 bg-slate-900">
            <button
              onClick={() => {
                onClose();
                onOpenNewProjectModal();
              }}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>{t.common.newProject}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
