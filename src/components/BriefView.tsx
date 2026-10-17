import React from 'react';
import { ProjectState } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { BookOpen, CheckCircle2, XCircle, Shield, Cpu, Layers, Sparkles, Folder } from 'lucide-react';

interface BriefViewProps {
  project: ProjectState | null;
  onOpenNewProjectModal?: () => void;
}

export const BriefView: React.FC<BriefViewProps> = ({ project, onOpenNewProjectModal }) => {
  const { t, language } = useLanguage();

  if (!project) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 short:p-5 text-center space-y-4 max-w-lg mx-auto my-12 short:my-2">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center mx-auto">
          <BookOpen className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-white">{t.common.noProjectSelected}</h3>
        <p className="text-xs text-slate-400">
          {t.common.noProjectSubtext}
        </p>
        {onOpenNewProjectModal && (
          <button
            onClick={onOpenNewProjectModal}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer inline-flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>{t.common.newProject}</span>
          </button>
        )}
      </div>
    );
  }
  const brief = project.brief;
  const arch = project.architecture;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Brief & Scope Control */}
        {/*
          Two panels: what the project is, how it is built.

          Each opened with an uppercase label above its heading ("ОБЗОР ПРОЕКТА" over the project
          name, "АРХИТЕКТУРНЫЙ ПЛАН" over "Архитектурные модули") and then repeated every answer in a
          bordered box. The label said what the heading said, and the boxes made a page of two panels
          look like a page of fourteen; both are gone, and the answers sit on the panel itself.
        */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
          <div className="border-b border-slate-800/70 pb-3">
            <h3 className="text-lg font-bold text-white">{brief?.projectName || project.name}</h3>
            {brief?.tagline && <p className="text-xs text-slate-300 italic mt-1">"{brief.tagline}"</p>}
          </div>

          {/* Problem & Value */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-950/60 p-3 rounded-lg space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{t.brief.coreProblem}</span>
              <p className="text-xs text-slate-200">{brief?.coreProblem || '—'}</p>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-lg space-y-1">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">{t.brief.coreValue}</span>
              <p className="text-xs text-slate-200">{brief?.coreValue || '—'}</p>
            </div>
          </div>

          {/* MVP Scope vs Non-Goals */}
          <div className="space-y-3">
            <div className="bg-emerald-500/5 rounded-xl p-3 space-y-2">
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{t.brief.mvpFeaturesTitle}</span>
              </span>
              <ul className="text-xs text-slate-200 space-y-1 list-disc list-inside">
                {brief?.mvpFeatures?.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>

            <div className="bg-rose-500/5 rounded-xl p-3 space-y-2">
              <span className="text-[11px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                <XCircle className="w-4 h-4 text-rose-400" />
                <span>{t.brief.nonGoalsTitle}</span>
              </span>
              <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                {brief?.nonGoals?.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Right Column: Proposed Technical Architecture */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
          <div className="border-b border-slate-800/70 pb-3">
            <h3 className="text-lg font-bold text-white">{t.brief.architectureTitle}</h3>
            <p className="text-xs text-slate-400 mt-1">
              {language === 'ru' ? 'Стек: ' : 'Stack: '}
              <strong className="text-indigo-300">{project.engineOrFramework}</strong> ({project.language})
            </p>
          </div>

          {/* Technology Stack */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-200 block">{t.brief.techStack}:</span>
            <div className="flex flex-wrap gap-1.5">
              {arch?.technologyStack?.map((tech, i) => (
                <span key={i} className="text-xs font-semibold bg-slate-800/50 text-indigo-300 px-2.5 py-1 rounded-lg">
                  {tech}
                </span>
              ))}
            </div>
          </div>

          {/* Core Folder Structure */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-200 block">{t.brief.folderStructure}:</span>
            <div className="bg-slate-950/60 rounded-lg p-3 font-mono text-xs text-slate-300 space-y-1">
              {arch?.folderStructure?.map((folder, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Folder className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{folder}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Data Flow Description */}
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-200 block">{t.brief.dataFlow}:</span>
            <p className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-lg leading-relaxed font-mono">
              {arch?.dataFlow}
            </p>
          </div>

          {/* Success Criteria */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-200 block">{t.brief.successCriteria}:</span>
            <ul className="text-xs text-slate-300 space-y-1 bg-slate-950/60 rounded-lg p-3">
              {brief?.successCriteria?.map((sc, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>{sc}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

