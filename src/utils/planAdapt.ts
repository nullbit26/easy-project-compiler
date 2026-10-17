import type { ProjectPhase } from '../types';

/**
 * The AI's re-aligned plan arrives as loose JSON. Turning it into phases is the part worth
 * testing, and it is the same transformation whether the plan is shown as columns or on the
 * board — so it lives here rather than inside one of the two views.
 */

/** "Phase 2: Add saving" reads as "Add saving" once the phase number has its own column. */
export function cleanPhaseTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  return rawTitle.replace(/^Phase \d+ - /i, '').replace(/^Phase \d+: /i, '').trim();
}

function cleanTaskTitle(rawTitle: string, index: number): string {
  return (rawTitle || `Task ${index + 1}`).replace(/^Step \d+: /i, '');
}

/**
 * A regenerated plan starts fresh: nothing is done yet, so only the very first task is ready to
 * work on and the rest wait in the backlog. An empty or malformed answer yields no phases at all
 * rather than a half-built plan.
 */
export function mapAdaptedPlanToPhases(data: any): ProjectPhase[] {
  if (!data || !Array.isArray(data.phases)) return [];

  return data.phases.map((p: any, idx: number) => {
    const phaseId = `phase_${idx}`;
    return {
      id: phaseId,
      phaseNumber: p.phaseNumber ?? idx,
      title: cleanPhaseTitle(p.title || `Phase ${idx}`),
      purpose: p.purpose || '',
      deliverable: p.deliverable || '',
      tasks: (p.tasks || []).map((t: any, tIdx: number) => ({
        id: `task_${idx}_${tIdx}`,
        phaseId,
        title: cleanTaskTitle(t.title, tIdx),
        goal: t.goal || '',
        status: idx === 0 && tIdx === 0 ? 'ready' : 'backlog',
        relevantFiles: t.relevantFiles || ['src/App.tsx'],
        acceptanceCriteria: (t.acceptanceCriteria || ['Verify build compiles']).map(
          (ac: any, acIdx: number) => ({
            id: `ac_${idx}_${tIdx}_${acIdx}`,
            description: typeof ac === 'string' ? ac : ac?.description || String(ac),
            passed: false
          })
        ),
        testRequirements: t.testRequirements || ['Unit test'],
        estimatedComplexity: t.estimatedComplexity || 'Small (1 prompt)',
        dependencies: t.dependencies || [],
        progressPercent: 0
      }))
    } as ProjectPhase;
  });
}
