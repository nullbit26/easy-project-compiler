import { describe, it, expect } from 'vitest';

import { cleanPhaseTitle, mapAdaptedPlanToPhases } from '../utils/planAdapt';

/**
 * The AI answers with loose JSON, and this mapping is the only thing standing between that answer
 * and the plan the user sees. Both the board and the columns run it, so a mistake here would show
 * up in two places at once.
 */

describe('Reading a re-aligned plan', () => {
  it('1. drops the phase number, which has a column of its own', () => {
    expect(cleanPhaseTitle('Phase 2: Add saving')).toBe('Add saving');
    expect(cleanPhaseTitle('Phase 3 - Add saving')).toBe('Add saving');
    expect(cleanPhaseTitle('Add saving')).toBe('Add saving');
    expect(cleanPhaseTitle('')).toBe('');
  });

  it('2. turns an answer into phases with tasks that belong to them', () => {
    const phases = mapAdaptedPlanToPhases({
      phases: [
        {
          phaseNumber: 1,
          title: 'Phase 1: Core',
          purpose: 'Playable',
          deliverable: 'Build',
          tasks: [
            { title: 'Step 1: Move the player', goal: 'Input works' },
            { title: 'Add a camera', goal: 'Camera follows' }
          ]
        }
      ]
    });

    expect(phases).toHaveLength(1);
    expect(phases[0].title).toBe('Core');
    expect(phases[0].tasks.map((task) => task.title)).toEqual(['Move the player', 'Add a camera']);
    // Every task points back at its own phase, which is what the board groups by.
    expect(phases[0].tasks.every((task) => task.phaseId === 'phase_0')).toBe(true);
  });

  it('3. starts a regenerated plan at the first task, with nothing already done', () => {
    const phases = mapAdaptedPlanToPhases({
      phases: [
        { title: 'One', tasks: [{ title: 'first' }, { title: 'second' }] },
        { title: 'Two', tasks: [{ title: 'third' }] }
      ]
    });

    expect(phases[0].tasks[0].status).toBe('ready');
    expect(phases[0].tasks[1].status).toBe('backlog');
    expect(phases[1].tasks[0].status).toBe('backlog');

    const everyCriterion = phases.flatMap((phase) => phase.tasks.flatMap((task) => task.acceptanceCriteria));
    expect(everyCriterion.length).toBeGreaterThan(0);
    expect(everyCriterion.every((criterion) => criterion.passed === false)).toBe(true);
  });

  it('4. accepts acceptance criteria written as plain strings or as objects', () => {
    const phases = mapAdaptedPlanToPhases({
      phases: [
        {
          title: 'One',
          tasks: [{ title: 'a', acceptanceCriteria: ['builds', { description: 'tested' }] }]
        }
      ]
    });

    expect(phases[0].tasks[0].acceptanceCriteria.map((criterion) => criterion.description)).toEqual([
      'builds',
      'tested'
    ]);
  });

  it('5. fills in what a half-written answer leaves out instead of producing blanks', () => {
    const phases = mapAdaptedPlanToPhases({ phases: [{ tasks: [{}, {}] }] });

    // An untitled phase still gets a readable name instead of an empty heading.
    expect(phases[0].title.length).toBeGreaterThan(0);
    expect(phases[0].tasks.map((task) => task.title)).toEqual(['Task 1', 'Task 2']);
    expect(phases[0].tasks[0].acceptanceCriteria[0].description).toBeTruthy();
    expect(phases[0].tasks[0].estimatedComplexity).toBeTruthy();
    expect(phases[0].tasks[0].relevantFiles.length).toBeGreaterThan(0);
  });

  it('6. refuses an answer with no plan in it rather than inventing a half-built one', () => {
    expect(mapAdaptedPlanToPhases(null)).toEqual([]);
    expect(mapAdaptedPlanToPhases(undefined)).toEqual([]);
    expect(mapAdaptedPlanToPhases({})).toEqual([]);
    expect(mapAdaptedPlanToPhases({ phases: 'not an array' })).toEqual([]);
    expect(mapAdaptedPlanToPhases({ phases: [] })).toEqual([]);
  });
});
