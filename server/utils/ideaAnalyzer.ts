/**
 * Shared idea-analysis helpers used by the `/api/project/analyze-idea` endpoint.
 *
 * Everything here is pure and side-effect free so both the Express controller
 * and the Vitest suite can use it without any runtime dependencies.
 */

/**
 * Canonical option values. They MUST match the <select> options rendered in
 * ProjectSetup.tsx, otherwise the wizard would silently fall back to a blank field.
 */
export const STACK_OPTIONS = [
  'Phaser.js 3 (Canvas)',
  'Three.js / React Three Fiber',
  'PixiJS v8',
  'PlayCanvas',
  'Construct 3 / Defold',
  'Godot 4.3 (GDScript)',
  'Unity 6 (URP)',
  'Unreal Engine 5',
  'React 19 + Vite',
  'Next.js App Router',
  'Python FastAPI',
  'Flutter',
] as const;

export const PATTERN_OPTIONS = [
  'State Machine (FSM)',
  'Object Pooling & Event Bus',
  'Component-Driven Scene Tree',
  'Entity-Component-System (ECS)',
  'Unidirectional Data Flow',
  'MVC / Service-Oriented',
  'Clean Architecture & Repository',
  'Feature-Sliced Design (FSD)',
] as const;

export const PLATFORM_OPTIONS = [
  'PC / Desktop',
  'Web Application',
  'Mobile App',
  'Cross-Platform',
] as const;

export type CanonicalStack = (typeof STACK_OPTIONS)[number];
export type CanonicalPattern = (typeof PATTERN_OPTIONS)[number];
export type CanonicalPlatform = (typeof PLATFORM_OPTIONS)[number];

export interface IdeaAnalysisResult {
  preferredStack: CanonicalStack;
  architecturalPattern: CanonicalPattern;
  targetPlatform: CanonicalPlatform;
  explanation: string;
}

export interface IdeaValidationResult {
  isTooShort: true;
  validationMessage: string;
  clarifyingQuestions: string[];
}

export function isRussianText(text: string): boolean {
  return /[а-яёА-ЯЁ]/.test(text || '');
}

export function validateIdeaLocally(text: string, isRu: boolean): IdeaValidationResult | null {
  const trimmed = (text || '').trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  if (trimmed.length >= 12 && words.length >= 3) return null;

  return {
    isTooShort: true,
    validationMessage: isRu
      ? 'Описание слишком краткое для точного анализа ИИ. Добавьте детали о механике, платформе и визуальном стиле.'
      : 'The description is too short for a precise AI analysis. Add details about mechanics, platform, and visual style.',
    clarifyingQuestions: isRu
      ? [
          'Какая графика планируется: 2D или 3D?',
          'Какова главная игровая механика или ключевая функция приложения?',
          'Целевая платформа: браузер, ПК или мобильные устройства?',
        ]
      : [
          'Is the visual style 2D or 3D?',
          'What is the core gameplay mechanic or key application feature?',
          'What is the target platform: browser, desktop, or mobile?',
        ],
  };
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Normalizes an arbitrary (e.g. Gemini-generated) stack string into one of the
 * canonical <select> option values.
 */
export function normalizeStack(raw: string, text = ''): CanonicalStack {
  const value = `${raw || ''} ${text}`.toLowerCase();

  if (value.includes('pixi')) return 'PixiJS v8';
  if (value.includes('playcanvas')) return 'PlayCanvas';
  if (value.includes('defold') || value.includes('construct')) return 'Construct 3 / Defold';
  if (value.includes('unreal') || value.includes('ue5')) return 'Unreal Engine 5';
  if (value.includes('godot') || value.includes('gdscript')) return 'Godot 4.3 (GDScript)';
  if (value.includes('unity') || value.includes('urp')) return 'Unity 6 (URP)';
  if (value.includes('three')) return 'Three.js / React Three Fiber';
  if (value.includes('phaser')) return 'Phaser.js 3 (Canvas)';
  if (value.includes('flutter') || value.includes('dart')) return 'Flutter';
  if (value.includes('next')) return 'Next.js App Router';
  if (value.includes('fastapi') || value.includes('python') || value.includes('django') || value.includes('flask')) {
    return 'Python FastAPI';
  }
  if (value.includes('react') || value.includes('vite') || value.includes('vue') || value.includes('svelte')) {
    return 'React 19 + Vite';
  }
  return 'React 19 + Vite';
}

/** Normalizes an arbitrary pattern string into one of the canonical option values. */
export function normalizePattern(raw: string, isGame = false): CanonicalPattern {
  const value = (raw || '').toLowerCase();

  if (value.includes('ecs') || value.includes('entity-component')) return 'Entity-Component-System (ECS)';
  if (value.includes('fsm') || value.includes('state machine')) return 'State Machine (FSM)';
  if (value.includes('pool') || value.includes('event bus')) return 'Object Pooling & Event Bus';
  if (value.includes('scene tree') || value.includes('scene')) return 'Component-Driven Scene Tree';
  if (value.includes('unidirectional') || value.includes('flux') || value.includes('redux')) return 'Unidirectional Data Flow';
  if (value.includes('mvc') || value.includes('service')) return 'MVC / Service-Oriented';
  if (value.includes('clean') || value.includes('repository')) return 'Clean Architecture & Repository';
  if (value.includes('fsd') || value.includes('feature-sliced')) return 'Feature-Sliced Design (FSD)';

  return isGame ? 'State Machine (FSM)' : 'Unidirectional Data Flow';
}

/** Normalizes an arbitrary platform string into one of the canonical option values. */
export function normalizePlatform(raw: string, isGame = false): CanonicalPlatform {
  const value = (raw || '').toLowerCase();

  if (value.includes('mobile') || value.includes('мобил') || value.includes('ios') || value.includes('android')) {
    return 'Mobile App';
  }
  if (value.includes('cross') || value.includes('кроссплатформ')) return 'Cross-Platform';
  if (/(^|\s)pc(\s|$)/.test(value) || value.includes('desktop') || value.includes('десктоп') || /(^|\s)пк(\s|$)/.test(value) || value.includes('windows') || value.includes('steam')) {
    return 'PC / Desktop';
  }
  if (value.includes('web') || value.includes('browser') || value.includes('браузер') || value.includes('веб') || value.includes('сайт')) {
    return 'Web Application';
  }
  return isGame ? 'PC / Desktop' : 'Web Application';
}

interface LocalAnalysis {
  stack: CanonicalStack;
  pattern: CanonicalPattern;
  platform: CanonicalPlatform;
  isGame: boolean;
}

function analyzeLocally(text: string): LocalAnalysis {
  const value = (text || '').toLowerCase();

  const isMobile = includesAny(value, ['flutter', 'android', 'ios', 'мобильн']);
  const isUnreal = includesAny(value, ['unreal', 'ue5']);
  const isUnity = includesAny(value, ['unity', 'urp']);
  const isGodot = includesAny(value, ['godot', 'gdscript']);
  const isPixi = value.includes('pixi');
  const isPlayCanvas = value.includes('playcanvas');
  const isDefold = includesAny(value, ['defold', 'construct']);
  const isThree = includesAny(value, ['three.js', 'threejs', 'react three fiber', 'r3f', 'webgl']);
  const isPhaser = value.includes('phaser');
  const isNext = includesAny(value, ['next.js', 'nextjs', 'next js']);
  const isPython = includesAny(value, ['fastapi', 'python', 'django', 'flask']);
  const is2D = includesAny(value, ['2d', '2д', 'пиксел', 'платформер', 'platformer', 'аркад', 'arcade', 'canvas', 'спрайт']);
  const is3D = includesAny(value, ['3d', '3д', 'шейдер', 'shader', 'полигонал']);
  const isGame = includesAny(value, [
    'игр', 'game', 'геймплей', 'gameplay', 'шутер', 'shooter', 'выживан', 'survival',
    'симулятор', 'simulator', 'аркад', 'arcade', 'платформер', 'platformer', 'квест', 'quest',
  ]);
  const isBrowser = includesAny(value, ['браузер', 'browser', 'веб', 'web', 'html5']);
  const isWebApp = includesAny(value, [
    'сайт', 'веб', 'web', 'приложен', 'application', 'сервис', 'service',
    'дашборд', 'dashboard', 'менеджер', 'manager', 'трекер', 'tracker', 'api', 'сервер', 'backend',
  ]);

  let stack: CanonicalStack;
  if (isPixi) stack = 'PixiJS v8';
  else if (isPlayCanvas) stack = 'PlayCanvas';
  else if (isDefold) stack = 'Construct 3 / Defold';
  else if (isUnreal) stack = 'Unreal Engine 5';
  else if (isUnity && !isMobile) stack = 'Unity 6 (URP)';
  else if (isGodot) stack = 'Godot 4.3 (GDScript)';
  else if (isThree || (isGame && is3D && isBrowser)) stack = 'Three.js / React Three Fiber';
  else if (isPhaser || (isGame && is2D && isBrowser)) stack = 'Phaser.js 3 (Canvas)';
  else if (isMobile) stack = 'Flutter';
  else if (isNext) stack = 'Next.js App Router';
  else if (isPython) stack = 'Python FastAPI';
  else if (isGame && is3D) stack = 'Unity 6 (URP)';
  else if (isGame) stack = 'Unity 6 (URP)';
  else if (isWebApp) stack = 'React 19 + Vite';
  else stack = 'React 19 + Vite';

  let pattern: CanonicalPattern;
  if (isGame) {
    if (value.includes('ecs')) pattern = 'Entity-Component-System (ECS)';
    else if (includesAny(value, ['пул', 'pool', 'событ', 'event bus'])) pattern = 'Object Pooling & Event Bus';
    else if (includesAny(value, ['сцен', 'scene'])) pattern = 'Component-Driven Scene Tree';
    else pattern = 'State Machine (FSM)';
  } else {
    if (includesAny(value, ['fsd', 'feature-sliced'])) pattern = 'Feature-Sliced Design (FSD)';
    else if (includesAny(value, ['масштаб', 'enterprise', 'команд', 'team', 'модул', 'module'])) {
      pattern = 'Clean Architecture & Repository';
    } else if (includesAny(value, ['api', 'сервер', 'backend', 'база данных', 'database', 'crud'])) {
      pattern = 'MVC / Service-Oriented';
    } else {
      pattern = 'Unidirectional Data Flow';
    }
  }

  const platform = normalizePlatform(value, isGame);

  return { stack, pattern, platform, isGame };
}

function buildExplanation(analysis: LocalAnalysis, isRu: boolean): string {
  const { stack, pattern, isGame } = analysis;

  const stackReasonRu: Record<CanonicalStack, string> = {
    'Phaser.js 3 (Canvas)': 'Phaser 3 обеспечивает стабильные 60 FPS в браузере и не требует установки движка.',
    'Three.js / React Three Fiber': 'Three.js / R3F позволяет собрать 3D-сцену прямо в браузере без десктопных движков.',
    'PixiJS v8': 'PixiJS v8 — легковесный 2D-рендерер с высокой производительностью для WebGL/Canvas.',
    PlayCanvas: 'PlayCanvas — зрелый WebGL-движок с онлайн-редактором для 3D-проектов.',
    'Construct 3 / Defold': 'Construct 3 / Defold — быстрый HTML5-пайплайн для 2D-игр без сложной настройки.',
    'Godot 4.3 (GDScript)': 'Godot 4.3 — бесплатный движок с быстрой итерацией и лаконичным GDScript.',
    'Unity 6 (URP)': 'Unity 6 (URP) — индустриальный стандарт для 3D-игр с физикой и шейдерной графикой.',
    'Unreal Engine 5': 'Unreal Engine 5 даёт максимальное качество графики и Blueprint-визуализацию логики.',
    'React 19 + Vite': 'React 19 + Vite обеспечивают мгновенный HMR, реактивное состояние и модульную структуру.',
    'Next.js App Router': 'Next.js App Router даёт серверный рендеринг, маршрутизацию и API из коробки.',
    'Python FastAPI': 'FastAPI — быстрый Python-бэкенд с автодокументацией и строгими схемами данных.',
    Flutter: 'Flutter — единая кодовая база для iOS и Android с нативной производительностью.',
  };

  const stackReasonEn: Record<CanonicalStack, string> = {
    'Phaser.js 3 (Canvas)': 'Phaser 3 delivers stable 60 FPS in the browser with zero engine installation.',
    'Three.js / React Three Fiber': 'Three.js / R3F renders a 3D scene directly in the browser without desktop engines.',
    'PixiJS v8': 'PixiJS v8 is a lightweight, high-performance 2D WebGL/Canvas renderer.',
    PlayCanvas: 'PlayCanvas is a mature WebGL engine with an online editor for 3D projects.',
    'Construct 3 / Defold': 'Construct 3 / Defold provides a fast HTML5 pipeline for 2D games with minimal setup.',
    'Godot 4.3 (GDScript)': 'Godot 4.3 is a free engine with fast iteration and concise GDScript.',
    'Unity 6 (URP)': 'Unity 6 (URP) is the industry standard for 3D games with physics and shader graphics.',
    'Unreal Engine 5': 'Unreal Engine 5 delivers top-tier graphics and Blueprint-based visual logic.',
    'React 19 + Vite': 'React 19 + Vite give instant HMR, reactive state, and a modular architecture.',
    'Next.js App Router': 'Next.js App Router provides server rendering, routing, and API routes out of the box.',
    'Python FastAPI': 'FastAPI is a fast Python backend with auto-generated docs and strict data schemas.',
    Flutter: 'Flutter shares a single codebase across iOS and Android with native performance.',
  };

  const patternReasonRu = isGame
    ? 'Для игровой логики выбран предсказуемый паттерн управления состоянием.'
    : 'Для приложения выбран паттерн с изолированной бизнес-логикой.';
  const patternReasonEn = isGame
    ? 'A predictable state-management pattern was chosen for the game loop.'
    : 'A pattern with isolated business logic was chosen for the application.';

  const platformRu = analysis.platform === 'Web Application'
    ? 'Платформа — браузер.'
    : analysis.platform === 'Mobile App'
      ? 'Платформа — мобильные устройства.'
      : analysis.platform === 'PC / Desktop'
        ? 'Платформа — ПК / десктоп.'
        : 'Платформа — кроссплатформенная.';
  const platformEn = analysis.platform === 'Web Application'
    ? 'Platform: browser.'
    : analysis.platform === 'Mobile App'
      ? 'Platform: mobile devices.'
      : analysis.platform === 'PC / Desktop'
        ? 'Platform: desktop.'
        : 'Platform: cross-platform.';

  if (isRu) {
    return `Выбран стек «${stack}» и паттерн «${pattern}». ${stackReasonRu[stack]} ${patternReasonRu} ${platformRu}`;
  }
  return `Selected stack "${stack}" and pattern "${pattern}". ${stackReasonEn[stack]} ${patternReasonEn} ${platformEn}`;
}

/** Full local (offline) analysis used when Gemini is unavailable or quota-limited. */
export function analyzeIdeaLocally(text: string, isRu: boolean): IdeaAnalysisResult {
  const analysis = analyzeLocally(text);
  return {
    preferredStack: analysis.stack,
    architecturalPattern: analysis.pattern,
    targetPlatform: analysis.platform,
    explanation: buildExplanation(analysis, isRu),
  };
}
