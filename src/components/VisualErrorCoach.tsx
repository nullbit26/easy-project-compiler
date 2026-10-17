import React, { useState } from 'react';
import { ProjectState, ErrorDiagnosis } from '../types';
import { diagnoseErrorApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { autonomyOf } from '../utils/workingMode';
import { Bug, Sparkles, Copy, Check, ArrowRight, ShieldAlert, Cpu, Code2, Loader2, Layers, HelpCircle } from 'lucide-react';

interface VisualErrorCoachProps {
  project: ProjectState | null;
  initialErrorInput?: string;
  onSendFixToCompiler?: (fixPrompt: string) => void;
  onApplyFixToCode?: (filePath: string, oldCode: string, newCode: string) => void;
  onOpenNewProjectModal?: () => void;
}

export const VisualErrorCoach: React.FC<VisualErrorCoachProps> = ({
  project,
  initialErrorInput = '',
  onSendFixToCompiler,
  onApplyFixToCode,
  onOpenNewProjectModal
}) => {
  const { t, language } = useLanguage();
  const [errorInput, setErrorInput] = useState(
    initialErrorInput ||
      `NullReferenceException: Object reference not set to an instance of an object
PlayerHealth.TakeDamage (System.Int32 damage) (at Assets/Features/Player/PlayerHealth.cs:42)
PlayerStats.DepleteHunger () (at Assets/Features/Player/PlayerStats.cs:88)`
  );

  // The first explanation follows the autonomy part of the mode — how much this person reads. All
  // three stay one click away, so nothing is lost either way, and the interface part is irrelevant.
  const autonomy = autonomyOf(project);
  const [explanationLevel, setExplanationLevel] = useState<'verySimple' | 'clear' | 'technical'>(
    autonomy === 'Advanced' ? 'technical' : autonomy === 'Intermediate' ? 'clear' : 'verySimple'
  );
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [diagnosis, setDiagnosis] = useState<ErrorDiagnosis | null>(
    project?.recentErrors?.[0] || null
  );
  const [copiedFix, setCopiedFix] = useState(false);

  if (!project) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 short:p-5 text-center space-y-4 max-w-lg mx-auto my-12 short:my-2">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center mx-auto">
          <Bug className="w-6 h-6 text-rose-400" />
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

  // Preset Sample Errors
  const errorPresets = language === 'ru'
    ? [
        {
          title: 'Unity: ошибка NullReference',
          text: `NullReferenceException: Object reference not set to an instance of an object\nPlayerHealth.TakeDamage (System.Int32 damage) (at Assets/Features/Player/PlayerHealth.cs:42)`
        },
        {
          title: 'React: бесконечный ре-рендер',
          text: `Uncaught Error: Too many re-renders. React limits the number of renders to prevent an infinite loop in App.tsx:28`
        },
        {
          title: 'TypeScript: модуль не найден',
          text: `TS2307: Cannot find module '@google/genai' or its corresponding type declarations in server.ts:4`
        }
      ]
    : [
        {
          title: 'Unity NullReferenceException',
          text: `NullReferenceException: Object reference not set to an instance of an object\nPlayerHealth.TakeDamage (System.Int32 damage) (at Assets/Features/Player/PlayerHealth.cs:42)`
        },
        {
          title: 'React Infinite Re-render Loop',
          text: `Uncaught Error: Too many re-renders. React limits the number of renders to prevent an infinite loop in App.tsx:28`
        },
        {
          title: 'TypeScript Cannot Find Module',
          text: `TS2307: Cannot find module '@google/genai' or its corresponding type declarations in server.ts:4`
        }
      ];

  const handleDiagnose = async () => {
    if (!errorInput.trim()) return;
    if (isDiagnosing) return;
    setIsDiagnosing(true);
    setErrorMsg('');

    try {
      const data = await diagnoseErrorApi({
        errorText: errorInput,
        projectType: project.projectType,
        framework: project.engineOrFramework,
        skillLevel: autonomyOf(project),
        language
      });

      setDiagnosis(data);
    } catch (err: any) {
      console.error('Failed to diagnose error:', err);
      setErrorMsg(err?.userMessage || err?.message || 'Failed to diagnose error.');
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleCopyFixPrompt = () => {
    if (!diagnosis) return;
    navigator.clipboard.writeText(diagnosis.repairPrompt);
    setCopiedFix(true);
    setTimeout(() => setCopiedFix(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Input Error Text & Sample Presets (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <label className="text-xs font-bold text-slate-200">{t.coach.errorInputLabel}</label>

            {/* Presets */}
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-slate-400">{t.coach.presetsLabel}</span>
              <div className="flex flex-wrap gap-1.5">
                {errorPresets.map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setErrorInput(preset.text);
                    }}
                    className="text-[10px] bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 px-2 py-1 rounded transition-colors cursor-pointer"
                  >
                    {preset.title}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={errorInput}
              onChange={(e) => setErrorInput(e.target.value)}
              placeholder={t.coach.errorInputPlaceholder}
              rows={6}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:border-rose-500 font-mono"
            />

            {errorMsg && <p className="text-xs text-rose-400 font-medium">{errorMsg}</p>}

            <button
              onClick={handleDiagnose}
              disabled={isDiagnosing}
              className="w-full bg-rose-600 enabled:hover:bg-rose-500 text-white font-bold text-xs py-3 rounded-lg transition-all shadow-md flex items-center justify-center gap-2 enabled:cursor-pointer disabled:opacity-50"
            >
              {isDiagnosing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t.coach.diagnosing}</span>
                </>
              ) : (
                <>
                  <Bug className="w-4 h-4" />
                  <span>{t.coach.diagnoseButton}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Visual Error Card & Diagnosis Output (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {diagnosis ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
              {/* Card Header: Error Name & Location */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                    {diagnosis.errorType}
                  </span>
                  <h3 className="text-sm font-bold text-white mt-0.5">{diagnosis.location}</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {language === 'ru' ? 'Когда: ' : 'When: '}{diagnosis.whenOccurs}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[10px] text-slate-400 block font-medium">
                    {language === 'ru' ? 'Уверенность ИИ' : 'AI Confidence'}
                  </span>
                  <span className="text-sm font-bold text-emerald-400">{diagnosis.confidenceScore}%</span>
                </div>
              </div>

              {/* Explanation Level Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">{t.coach.explanationLevelLabel}</span>
                </div>

                <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-semibold">
                  <button
                    onClick={() => setExplanationLevel('verySimple')}
                    className={`py-1.5 rounded-md transition-all cursor-pointer ${
                      explanationLevel === 'verySimple'
                        ? 'bg-rose-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.coach.levelVerySimple}
                  </button>
                  <button
                    onClick={() => setExplanationLevel('clear')}
                    className={`py-1.5 rounded-md transition-all cursor-pointer ${
                      explanationLevel === 'clear'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.coach.levelClear}
                  </button>
                  <button
                    onClick={() => setExplanationLevel('technical')}
                    className={`py-1.5 rounded-md transition-all cursor-pointer ${
                      explanationLevel === 'technical'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.coach.levelTechnical}
                  </button>
                </div>

                {/* Explanation Output Box */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 leading-relaxed font-medium">
                  {explanationLevel === 'verySimple' && (
                    <p className="text-rose-200"><strong>{t.coach.levelVerySimple}:</strong> {diagnosis.explanations.verySimple}</p>
                  )}
                  {explanationLevel === 'clear' && (
                    <p className="text-indigo-200"><strong>{t.coach.levelClear}:</strong> {diagnosis.explanations.clear}</p>
                  )}
                  {explanationLevel === 'technical' && (
                    <p className="text-slate-300 font-mono text-[11px]"><strong>{t.coach.levelTechnical}:</strong> {diagnosis.explanations.technical}</p>
                  )}
                </div>
              </div>

              {/* Visual Cause Chain Diagram */}
              {diagnosis.visualCauseChain?.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-200 block">{t.coach.rootCauseTitle}</span>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
                      {diagnosis.visualCauseChain.map((node, idx) => (
                        <React.Fragment key={idx}>
                          <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-center flex-1 w-full space-y-0.5">
                            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">
                              {node.label}
                            </span>
                            <span className="text-[11px] text-slate-300 block">{node.detail}</span>
                          </div>
                          {idx < diagnosis.visualCauseChain.length - 1 && (
                            <ArrowRight className="w-4 h-4 text-slate-400 shrink-0 rotate-90 sm:rotate-0" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Code Diff Highlight */}
              {diagnosis.codeDiff && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                      <span>{t.coach.suggestedFixTitle} ({diagnosis.codeDiff.filePath})</span>
                    </span>
                    {onApplyFixToCode && (
                      <button
                        onClick={() => onApplyFixToCode?.(diagnosis.codeDiff!.filePath, diagnosis.codeDiff!.oldCode, diagnosis.codeDiff!.newCode)}
                        className="bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{t.coach.applyFixButton}</span>
                      </button>
                    )}
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs space-y-2">
                    <div className="bg-rose-950/40 border border-rose-900/60 text-rose-300 p-2 rounded line-through">
                      - {diagnosis.codeDiff.oldCode}
                    </div>
                    <div className="bg-emerald-950/40 border border-emerald-900/60 text-emerald-300 p-2 rounded whitespace-pre-wrap">
                      + {diagnosis.codeDiff.newCode}
                    </div>
                  </div>
                </div>
              )}

              {/* Verification Checklist */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-200 block">
                  {language === 'ru' ? 'Шаги проверки исправления:' : 'Verification Steps to Test Fix:'}
                </span>
                <ul className="text-xs text-slate-300 space-y-1 bg-slate-950 border border-slate-800 rounded-xl p-3">
                  {diagnosis.verificationSteps?.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">{idx + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 1-Click Repair Prompt Generator */}
              <div className="bg-indigo-950/80 border border-indigo-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span>{language === 'ru' ? 'Промпт исправления' : 'Agent Fix Prompt'}</span>
                  </span>

                  <button
                    onClick={handleCopyFixPrompt}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedFix ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedFix ? t.common.copied : t.common.copy}</span>
                  </button>
                </div>

                <p className="text-xs font-mono text-slate-200 bg-slate-950 p-3 rounded-lg border border-slate-800 leading-relaxed">
                  {diagnosis.repairPrompt}
                </p>

                {onSendFixToCompiler && (
                  <button
                    onClick={() => onSendFixToCompiler(diagnosis.repairPrompt)}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>{t.coach.sendFixToCompilerButton}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
              <Bug className="w-10 h-10 text-slate-400 mx-auto" />
              <h3 className="text-sm font-bold text-slate-200">
                {language === 'ru' ? 'Ошибок пока нет' : 'No Error Diagnosed Yet'}
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {language === 'ru'
                  ? 'Вставьте текст ошибки или выберите пример слева для запуска визуальной диагностики.'
                  : 'Paste an error stack trace or select a preset sample on the left to run visual diagnosis.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
