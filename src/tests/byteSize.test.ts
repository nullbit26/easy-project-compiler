import { describe, it, expect } from 'vitest';

import {
  buildWeightLine,
  formatBytes,
  formatSignedBytes,
  formatSignedPct,
  weightDetailLine,
  weightLine,
  weightTitle
} from '../utils/byteSize';
import type { BuildWeight, WriteWeight } from '../services/api';

/**
 * Those sentences are what a person reads after a write, so what they *cannot* say matters as much
 * as what they say: no percentage from a base of 41 bytes, no "the project got heavier" without a
 * previous measurement, no blaming the batch for changes it did not make.
 */

function writeWeight(overrides: Partial<WriteWeight> = {}): WriteWeight {
  return {
    at: '2026-10-15T10:00:00.000Z',
    changesetId: 'cs-1',
    files: 2,
    beforeBytes: 1000,
    afterBytes: 13_400,
    netBytes: 12_400,
    heaviest: { path: 'src/main.js', deltaBytes: 10_000, afterBytes: 12_000 },
    projectBytes: 348_160,
    projectFileCount: 42,
    projectTruncated: false,
    projectDeltaBytes: 12_400,
    projectDeltaPct: 3.7,
    otherBytes: 0,
    heavy: false,
    ...overrides
  };
}

function buildWeight(overrides: Partial<BuildWeight> = {}): BuildWeight {
  return {
    at: '2026-10-15T10:05:00.000Z',
    dir: 'dist',
    bytes: 1_450_000,
    fileCount: 12,
    truncated: false,
    deltaBytes: 40_000,
    deltaPct: 2.8,
    heavy: false,
    ...overrides
  };
}

describe('Talking about sizes', () => {
  it('1. formats a size the same way everywhere', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1_450_000)).toBe('1.38 MB');
    expect(formatSignedBytes(12_400)).toBe('+12.1 KB');
    expect(formatSignedBytes(-5000)).toBe('−4.9 KB');
    expect(formatSignedBytes(0)).toBe('0 B');
    expect(formatSignedPct(3.7)).toBe('+3.7%');
    expect(formatSignedPct(-12)).toBe('−12%');
  });

  it('2. says the project’s new weight, what it was and what this write cost', () => {
    const line = weightLine(writeWeight(), true);

    expect(line).toContain('340.0 KB');
    expect(line).toContain('было 327.9 KB');
    expect(line).toContain('+3.7%');
    expect(line).toContain('Эта запись: +12.1 KB');
    expect(line).not.toContain('тяжелее');
  });

  it('3. does not claim the project changed when there is nothing to compare with', () => {
    const line = weightLine(writeWeight({ projectDeltaBytes: null, projectDeltaPct: null, note: 'first_measurement' }), true);

    expect(line).toContain('сравнивать пока не с чем');
    expect(line).not.toContain('было');
  });

  it('4. speaks about the batch, not the project, in a heavy write with no history', () => {
    const line = weightLine(
      writeWeight({ projectDeltaBytes: null, projectDeltaPct: null, netBytes: 60_000, heavy: true, note: 'first_measurement' }),
      true
    );

    expect(line).toContain('Эта запись тяжёлая');
    expect(line).not.toContain('Проект стал заметно тяжелее');
  });

  it('5. calls out a heavy project change, and names what the batch did not do', () => {
    const line = weightLine(writeWeight({ heavy: true, otherBytes: 2048 }), true);

    expect(line).toContain('Проект стал заметно тяжелее');
    expect(line).toContain('Прочие изменения: +2.0 KB');
  });

  it('6. leaves the percentage out when the base is not worth dividing by', () => {
    // 41 bytes growing into 60 KB is +146341%, which is true and useless.
    const line = buildWeightLine(buildWeight({ bytes: 60_041, deltaBytes: 60_000, deltaPct: 146_341.5 }), true);

    expect(line).toContain('58.6 KB');
    expect(line).toContain('+58.6 KB');
    expect(line).not.toContain('%');
    expect(line).not.toContain('тяжелее');
  });

  it('7. reports a build that has nothing to compare with, and one that a comparison justifies', () => {
    const first = buildWeightLine(buildWeight({ deltaBytes: null, deltaPct: null, note: 'first_measurement' }), true);
    expect(first).toContain('первое измерение');

    const compared = buildWeightLine(buildWeight({ heavy: true }), true);
    expect(compared).toContain('Сборка заметно потяжелела');
    expect(compared).toContain('+2.8%');
    expect(compared).toContain('было 1.34 MB');

    const floor = buildWeightLine(buildWeight({ truncated: true }), true);
    expect(floor).toContain('не меньше');
  });

  it('8. names the file that grew most and admits when the size is a floor', () => {
    expect(weightDetailLine(writeWeight(), true)).toContain('src/main.js');
    expect(weightDetailLine(writeWeight({ heaviest: null }), true)).toBe('');

    const title = weightTitle(writeWeight({ projectTruncated: true, heaviest: null }), true);
    expect(title).toContain('Эта запись: +12.1 KB в 2 файл(ах)');
    expect(title).toContain('С прошлой записи: +12.1 KB, +3.7%');
    expect(title).toContain('оценка снизу');
  });

  it('9. says nothing at all when there is nothing to say', () => {
    expect(weightLine(null, true)).toBe('');
    expect(weightLine(undefined, false)).toBe('');
    expect(weightDetailLine(null, true)).toBe('');
    expect(weightTitle(null, true)).toBe('');
    expect(buildWeightLine(null, true)).toBe('');
    expect(buildWeightLine(undefined, false)).toBe('');
  });
});
