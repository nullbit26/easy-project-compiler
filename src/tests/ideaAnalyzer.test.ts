import { describe, it, expect } from 'vitest';
import {
  analyzeIdeaLocally,
  validateIdeaLocally,
  normalizeStack,
  normalizePattern,
  normalizePlatform,
} from '../../server/utils/ideaAnalyzer';

describe('IdeaAnalyzer - AI Smart Auto-Select (локальный анализ идеи)', () => {
  it('1. Отклоняет слишком короткое описание и возвращает локализованные уточняющие вопросы', () => {
    const result = validateIdeaLocally('игра', true);
    expect(result).not.toBeNull();
    expect(result!.isTooShort).toBe(true);
    expect(result!.clarifyingQuestions.length).toBeGreaterThanOrEqual(3);
    expect(result!.clarifyingQuestions[0]).toContain('2D');
    expect(result!.validationMessage).toContain('краткое');
  });

  it('2. Полное описание проходит валидацию', () => {
    expect(validateIdeaLocally('2D браузерная игра про наливание пива с физикой', true)).toBeNull();
    expect(validateIdeaLocally('A 3D survival game on Unity with hunger mechanics', false)).toBeNull();
  });

  it('3. Для 2D браузерной игры выбирает Phaser и веб-платформу (RU-объяснение)', () => {
    const result = analyzeIdeaLocally('2D браузерная игра про наливание пива с физикой и частицами пены', true);
    expect(result.preferredStack).toBe('Phaser.js 3 (Canvas)');
    expect(result.architecturalPattern).toBe('State Machine (FSM)');
    expect(result.targetPlatform).toBe('Web Application');
    expect(result.explanation).toContain('Phaser');
  });

  it('4. Для 3D-игры на Unity выбирает Unity 6 и десктоп (EN-объяснение)', () => {
    const result = analyzeIdeaLocally('A 3D survival game on Unity with hunger and shelter building', false);
    expect(result.preferredStack).toBe('Unity 6 (URP)');
    expect(result.targetPlatform).toBe('PC / Desktop');
    expect(result.explanation).toContain('Unity');
  });

  it('5. Для React-веб-приложения выбирает React 19 + Vite и однонаправленный поток данных', () => {
    const result = analyzeIdeaLocally('Современный трекер задач на React с канбан-доской и фильтрами', true);
    expect(result.preferredStack).toBe('React 19 + Vite');
    expect(result.architecturalPattern).toBe('Unidirectional Data Flow');
  });

  it('6. Нормализует произвольные значения (например, от Gemini) в канонические опции визарда', () => {
    expect(normalizeStack('Phaser 3')).toBe('Phaser.js 3 (Canvas)');
    expect(normalizeStack('three')).toBe('Three.js / React Three Fiber');
    expect(normalizeStack('unknown engine')).toBe('React 19 + Vite');
    expect(normalizePattern('fsm')).toBe('State Machine (FSM)');
    expect(normalizePattern('')).toBe('Unidirectional Data Flow');
    expect(normalizePlatform('mobile')).toBe('Mobile App');
    expect(normalizePlatform('cross-platform')).toBe('Cross-Platform');
  });
});
