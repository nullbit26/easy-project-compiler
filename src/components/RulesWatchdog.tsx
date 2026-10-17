import React, { useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useProject } from '../context/ProjectContext';
import { checkProjectRules } from '../services/rulesCheck';
import { onWorkspaceBatchWritten } from '../services/rulesWatch';
import { sameCheckReading } from '../utils/rulesCheckStamp';

/**
 * The rules check that runs by itself.
 *
 * A rules file is written once and then the project moves on: the file it names is renamed, the
 * script it calls is deleted. Every batch of changes written into the folder is one more chance for
 * the rules to have drifted — so the comparison is made here, right after the batch, instead of
 * waiting for somebody to open the rules panel and wonder.
 *
 * What it does with the answer: the date and the counts go onto the project (the panel shows them,
 * and they survive a reload). A check that found the same thing as last time passes in silence; one
 * that found problems says so, because the next prompt is built on top of these rules.
 *
 * What it refuses to do: record anything when there was no folder to compare with, and claim a
 * check it could not finish. A failed read leaves the previous date standing rather than replacing
 * it with a fresh-looking one.
 *
 * It is rendered once, next to the providers, so it keeps working on every screen — the writes it
 * listens for happen in four of them.
 */
export const RulesWatchdog: React.FC = () => {
  const { currentProject, onRecordRulesCheck, showToast } = useProject();
  const { language, t } = useLanguage();

  /**
   * The check outlives the render that started it: a batch is applied, the screen re-renders, and the
   * answer arrives afterwards. Reading the project from a ref means it is always the project as it is
   * now, and a second batch that lands while the first check is still running is not lost.
   */
  const latest = useRef({ currentProject, onRecordRulesCheck, showToast, language, t });
  latest.current = { currentProject, onRecordRulesCheck, showToast, language, t };
  const isRunning = useRef(false);
  const isPending = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (isRunning.current) {
        // One check at a time: the answer to the second batch would be about the folder as it is
        // after both writes anyway.
        isPending.current = true;
        return;
      }

      isRunning.current = true;
      try {
        do {
          isPending.current = false;

          const { currentProject: project, onRecordRulesCheck: record, showToast: toast, language: lang, t: translate } = latest.current;
          if (!project || !project.rulesFilesContent) continue;

          const previous = project.lastRulesCheck;

          try {
            const checked = await checkProjectRules(project.rulesFilesContent, project.name, lang);
            if (cancelled) return;
            // Nothing was compared (no folder), so there is no date to show: the panel says so
            // instead, and a stamp here would claim a comparison that never happened.
            if (!checked.stamp.compared.files) continue;

            record(checked.stamp);
            if (checked.stamp.problems > 0 && !sameCheckReading(previous, checked.stamp)) {
              toast(
                `${translate.map.rulesStaleAfterWrite} ${checked.stamp.problems}. ${translate.map.rulesStaleAfterWriteHint}`
              );
            }
          } catch {
            // The folder could not be read. The date of the last real check stays as it was.
          }
        } while (isPending.current);
      } finally {
        isRunning.current = false;
      }
    };

    const unsubscribe = onWorkspaceBatchWritten(() => {
      void run();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return null;
};
