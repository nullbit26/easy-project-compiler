/**
 * The first steps of a new project when no API key is configured: the clarifying questions, the
 * architectural trade-offs and the voice of the local plan.
 *
 * With a key the model receives levelInstructionBlock() and decides all of this for the level on its
 * own. Without one there is no model, so this file has to do the same job with fixed content —
 * otherwise the working mode would quietly stop mattering the moment the key is missing, and the
 * wizard would ask a Новичок the same architecture questions as a Продвинутый user.
 *
 * Two voices are written for each question: "plain" for Новичок / Вайб-кодер and "technical" for
 * Средний / Продвинутый. The count comes from questionLimit() and the voice from levelVoice() — the
 * same numbers and the same split the prompt carries, never a second opinion.
 *
 * What the level must NOT change lives outside this file: the plan's phases, tasks, acceptance
 * criteria and test demands are built by the controller and handed to every level untouched.
 */

import { LevelVoice, levelVoice, questionLimit } from './levelGuidance';

export interface OfflineQuestion {
  id: string;
  topic: string;
  questionText: string;
  placeholder: string;
  defaultSuggestion: string;
}

export interface OfflineTradeOff {
  id: string;
  title: string;
  optionA: string;
  optionB: string;
  recommendation: string;
}

export interface OfflineFirstSteps {
  /** Capped at questionLimit(), most important first, so a shorter list is still the useful one. */
  questions: OfflineQuestion[];
  tradeOffs: OfflineTradeOff[];
}

type Lang = 'ru' | 'en';
type Family = 'game' | 'app';

/**
 * Plain-voice questions: no storage engines, no patterns, no test jargon. There are enough of them
 * for the highest plain level (Вайб-кодер asks three) and the list is ordered by how much the answer
 * changes the product, so Новичок's two are still the two that matter.
 */
const PLAIN_QUESTIONS: Record<Lang, Record<Family, OfflineQuestion[]>> = {
  ru: {
    game: [
      {
        id: 'q1',
        topic: 'Что происходит на экране',
        questionText: 'Опишите самыми простыми словами: что человек видит на экране и что происходит, когда он нажимает кнопку или касается экрана?',
        placeholder: 'например: шарик летает по экрану, при нажатии он подпрыгивает',
        defaultSuggestion: 'Понятное управление нажатием и касанием'
      },
      {
        id: 'q2',
        topic: 'Как игра заканчивается',
        questionText: 'Как игра поймёт, что человек выиграл или проиграл — по времени, очкам или оставшимся жизням?',
        placeholder: 'например: игра заканчивается, когда кончаются жизни',
        defaultSuggestion: 'Очки и завершение по времени'
      },
      {
        id: 'q3',
        topic: 'Как это должно выглядеть',
        questionText: 'Как должно выглядеть то, что на экране: простые фигурки и цвета или нарисованные персонажи?',
        placeholder: 'например: простые фигурки и яркие цвета',
        defaultSuggestion: 'Простые фигурки и яркие цвета'
      }
    ],
    app: [
      {
        id: 'q1',
        topic: 'Что человек делает в приложении',
        questionText: 'Опишите самыми простыми словами: что человек делает в приложении и что он видит в ответ?',
        placeholder: 'например: пишет запись и сразу видит её в списке',
        defaultSuggestion: 'Одно главное действие с понятным результатом'
      },
      {
        id: 'q2',
        topic: 'Сохраняются ли данные',
        questionText: 'Должны ли записи сохраняться, когда приложение закрывают и открывают заново?',
        placeholder: 'например: да, список не должен пропадать',
        defaultSuggestion: 'Да, данные сохраняются автоматически'
      },
      {
        id: 'q3',
        topic: 'Что нужно в первой версии',
        questionText: 'Что должно работать в самой первой версии, чтобы ей уже можно было пользоваться каждый день?',
        placeholder: 'например: добавить запись, посмотреть список, удалить лишнее',
        defaultSuggestion: 'Добавление, просмотр списка и удаление'
      }
    ]
  },
  en: {
    game: [
      {
        id: 'q1',
        topic: 'What happens on screen',
        questionText: 'In the simplest words: what does the player see, and what happens when they press a key or tap the screen?',
        placeholder: 'e.g. a ball moves around and jumps when tapped',
        defaultSuggestion: 'Simple tap and key controls'
      },
      {
        id: 'q2',
        topic: 'How the game ends',
        questionText: 'How should the game know the player won or lost — a timer, points, or lives left?',
        placeholder: 'e.g. the game ends when lives run out',
        defaultSuggestion: 'Points plus a time limit'
      },
      {
        id: 'q3',
        topic: 'How it should look',
        questionText: 'What should the screen look like: simple shapes and colours, or drawn characters?',
        placeholder: 'e.g. simple shapes in bright colours',
        defaultSuggestion: 'Simple shapes in bright colours'
      }
    ],
    app: [
      {
        id: 'q1',
        topic: 'What the user does',
        questionText: 'In the simplest words: what does the person do in the app, and what do they see back?',
        placeholder: 'e.g. they write a note and see it in the list straight away',
        defaultSuggestion: 'One main action with a clear result'
      },
      {
        id: 'q2',
        topic: 'Whether data is kept',
        questionText: 'Should the entries stay there after the app is closed and opened again?',
        placeholder: 'e.g. yes, the list must not disappear',
        defaultSuggestion: 'Yes, data is saved automatically'
      },
      {
        id: 'q3',
        topic: 'What the first version needs',
        questionText: 'What has to work in the very first version for it to be usable every day?',
        placeholder: 'e.g. add an entry, see the list, delete one',
        defaultSuggestion: 'Add, view the list, and delete'
      }
    ]
  }
};

/**
 * Technical-voice questions in English used to be the only set; the test-coverage question is the
 * fourth, so the most technical level still has four to answer.
 */
const TECHNICAL_QUESTIONS: Record<Lang, Record<Family, OfflineQuestion[]>> = {
  ru: {
    game: [
      {
        id: 'q1',
        topic: 'Управление и интерактивность',
        questionText: 'Как игрок будет управлять персонажем/объектами (мышь, тач-жесты или клавиатура)?',
        placeholder: 'например: Мышь и drag-and-drop для ПК, тач для мобильных',
        defaultSuggestion: 'Адаптивное управление кликом и жестами'
      },
      {
        id: 'q2',
        topic: 'Игровая прогрессия и сложность',
        questionText: 'Каково главное условие победы или поражения (таймер, очки, полоска здоровья)?',
        placeholder: 'например: Таймер обратного отсчета и шкала ресурсов',
        defaultSuggestion: 'Счетчик очков с плавно растущей сложностью'
      },
      {
        id: 'q3',
        topic: 'Визуальный стиль и графика',
        questionText: 'Какой визуальный стиль предпочтителен (процедурная 2D-графика, спрайты или 3D)?',
        placeholder: 'например: Чистая векторная 2D-графика с частицами',
        defaultSuggestion: 'Процедурные векторные формы и эффекты частиц'
      },
      {
        id: 'q4',
        topic: 'Тестирование игровой логики',
        questionText: 'Какие сценарии должны быть покрыты автотестами — переходы состояний, обработка ввода или коллизии?',
        placeholder: 'например: юнит-тесты переходов FSM и обработки столкновений',
        defaultSuggestion: 'Юнит-тесты переходов состояний и обработки ввода'
      }
    ],
    app: [
      {
        id: 'q1',
        topic: 'Хранение данных и состояние',
        questionText: 'Где сохранять данные пользователя (LocalStorage браузера или база данных)?',
        placeholder: 'например: LocalStorage для мгновенного запуска без бэкенда',
        defaultSuggestion: 'LocalStorage с возможностью экспорта в JSON'
      },
      {
        id: 'q2',
        topic: 'Ключевые функции V1',
        questionText: 'Какие 2-3 функции наиболее критичны для первой рабочей версии MVP?',
        placeholder: 'например: Интерактивная доска, фильтры поиска, автотеги',
        defaultSuggestion: 'Главная панель + интерактивное управление + реактивный стейт'
      },
      {
        id: 'q3',
        topic: 'Интерфейс и компоновка',
        questionText: 'Какую компоновку интерфейса вы предпочитаете (темный дашборд или светлые карточки)?',
        placeholder: 'например: Темный современный дашборд с акцентами',
        defaultSuggestion: 'Темный эргономичный дашборд'
      },
      {
        id: 'q4',
        topic: 'Тестирование и граничные случаи',
        questionText: 'Какие граничные случаи и отказы должны покрывать автотесты (пустые данные, недоступный API, отклонённая операция)?',
        placeholder: 'например: пустой список и ошибка сохранения',
        defaultSuggestion: 'Юнит-тесты пустого состояния и ошибок сохранения'
      }
    ]
  },
  en: {
    game: [
      {
        id: 'q1',
        topic: 'Gameplay & Controls',
        questionText: 'How should player controls and interactions be handled (e.g. mouse drag, touch gestures, or keyboard)?',
        placeholder: 'e.g. Mouse drag & click for desktop, touch for mobile',
        defaultSuggestion: 'Responsive mouse click and drag gestures'
      },
      {
        id: 'q2',
        topic: 'Game Progression & Challenge',
        questionText: 'What is the main challenge or win/loss condition (e.g. timer, score target, health bar)?',
        placeholder: 'e.g. Timer count-down and foam level meter',
        defaultSuggestion: 'Score counter with difficulty curve'
      },
      {
        id: 'q3',
        topic: 'Visual Style & Assets',
        questionText: 'What art/graphic style do you prefer (e.g. procedural canvas graphics, pixel art, or custom sprite sheets)?',
        placeholder: 'e.g. Clean 2D vector shapes with particle effects',
        defaultSuggestion: 'Procedural vector shapes & particle physics'
      },
      {
        id: 'q4',
        topic: 'Test Coverage of Game Logic',
        questionText: 'Which scenarios must the automated tests cover — state transitions, input handling, or collisions?',
        placeholder: 'e.g. Unit tests for FSM transitions and collision handling',
        defaultSuggestion: 'Unit tests for state transitions and input handling'
      }
    ],
    app: [
      {
        id: 'q1',
        topic: 'Data Storage & State',
        questionText: 'Where should user data and settings be saved (e.g. Browser LocalStorage or persistent database)?',
        placeholder: 'e.g. Browser LocalStorage for instant setup',
        defaultSuggestion: 'LocalStorage with JSON export capability'
      },
      {
        id: 'q2',
        topic: 'Key User Features',
        questionText: 'Which 2-3 specific features are most critical for your V1 MVP?',
        placeholder: 'e.g. Interactive task board, search filter, Gemini auto-tagging',
        defaultSuggestion: 'Core dashboard + interactive controls + state feedback'
      },
      {
        id: 'q3',
        topic: 'UI Layout & Theme',
        questionText: 'What visual layout and theme do you prefer (e.g. dark modern dashboard or clean light card view)?',
        placeholder: 'e.g. Dark modern dashboard with indigo accents',
        defaultSuggestion: 'Dark modern dashboard layout'
      },
      {
        id: 'q4',
        topic: 'Test Coverage & Edge Cases',
        questionText: 'Which edge cases and failures must the automated tests cover (empty data, unavailable API, rejected operation)?',
        placeholder: 'e.g. Empty list and failed save',
        defaultSuggestion: 'Unit tests for the empty state and save failures'
      }
    ]
  }
};

/**
 * The same two product decisions at every level — what changes is only how they are spelled out.
 * Dropping a trade-off for a lower level would take a decision away from the person least able to
 * make it later.
 */
const TRADE_OFFS: Record<Lang, Record<Family, Record<LevelVoice, OfflineTradeOff[]>>> = {
  ru: {
    game: {
      plain: [
        {
          id: 't1',
          title: 'Из чего рисуется игра',
          optionA: 'Простые фигурки, нарисованные кодом (быстрее запустить и проверить)',
          optionB: 'Нарисованные картинки персонажей (нужно подготовить файлы)',
          recommendation: 'Простые фигурки — первую версию получится проверить сразу'
        },
        {
          id: 't2',
          title: 'Как игра решает, что происходит дальше',
          optionA: 'Понятные шаги: меню — игра — конец игры',
          optionB: 'Гибкие правила для сложных ситуаций',
          recommendation: 'Понятные шаги: так легче убедиться, что всё работает'
        }
      ],
      technical: [
        {
          id: 't1',
          title: 'Движок рендеринга',
          optionA: 'Canvas 2D (Легковесный, быстрый старт)',
          optionB: 'WebGL Шейдеры (Высокая производительность частиц)',
          recommendation: 'WebGL для плавной анимации и физики частиц'
        },
        {
          id: 't2',
          title: 'Архитектура игрового цикла',
          optionA: 'Конечный автомат (FSM - Предсказуемые фазы)',
          optionB: 'Entity-Component-System (ECS - Масштабируемость)',
          recommendation: 'Конечный автомат (FSM) для прозрачного управления этапами'
        }
      ]
    },
    app: {
      plain: [
        {
          id: 't1',
          title: 'Где хранятся данные',
          optionA: 'В браузере на вашем компьютере (ничего настраивать не нужно)',
          optionB: 'На сервере с базой данных (нужна настройка и вход в аккаунт)',
          recommendation: 'В браузере — первую версию видно сразу'
        },
        {
          id: 't2',
          title: 'Как приложение устроено внутри',
          optionA: 'Несколько понятных модулей (легко менять по частям)',
          optionB: 'Строгие правила разделения кода (нужно время на настройку)',
          recommendation: 'Несколько понятных модулей для первой версии'
        }
      ],
      technical: [
        {
          id: 't1',
          title: 'Модель сохранения данных',
          optionA: 'LocalStorage браузера (Мгновенно, без сервера)',
          optionB: 'REST API + Бэкенд (Синхронизация в облаке)',
          recommendation: 'LocalStorage для быстрой итерации MVP'
        },
        {
          id: 't2',
          title: 'Структура компонентов',
          optionA: 'Модульные компоненты (Понятно, просто)',
          optionB: 'Feature-Sliced Design (Строгая изоляция слоев)',
          recommendation: 'Feature-Sliced Design для масштабируемости'
        }
      ]
    }
  },
  en: {
    game: {
      plain: [
        {
          id: 't1',
          title: 'What the game is drawn from',
          optionA: 'Simple shapes drawn by code (fastest to run and check)',
          optionB: 'Drawn character artwork (files have to be prepared first)',
          recommendation: 'Simple shapes — the first version can be checked straight away'
        },
        {
          id: 't2',
          title: 'How the game decides what happens next',
          optionA: 'Clear steps: menu — game — game over',
          optionB: 'Flexible rules for complicated situations',
          recommendation: 'Clear steps: easier to confirm everything works'
        }
      ],
      technical: [
        {
          id: 't1',
          title: 'Rendering Engine Mode',
          optionA: 'Canvas 2D Context (Simple, Lightweight)',
          optionB: 'WebGL Shader Pipeline (High-Performance Particles)',
          recommendation: 'WebGL Shader Pipeline for fluid particle physics'
        },
        {
          id: 't2',
          title: 'Game Loop Architecture',
          optionA: 'State Machine / FSM (Predictable Transitions)',
          optionB: 'Entity-Component-System / ECS (Decoupled Scalability)',
          recommendation: 'State Machine (FSM) for clear stage management'
        }
      ]
    },
    app: {
      plain: [
        {
          id: 't1',
          title: 'Where the data lives',
          optionA: 'In the browser on your own computer (nothing to set up)',
          optionB: 'On a server with a database (setup and an account required)',
          recommendation: 'In the browser — the first version is visible immediately'
        },
        {
          id: 't2',
          title: 'How the app is built inside',
          optionA: 'A few clear modules (easy to change one at a time)',
          optionB: 'Strict separation rules (needs setup time first)',
          recommendation: 'A few clear modules for the first version'
        }
      ],
      technical: [
        {
          id: 't1',
          title: 'State Persistence Model',
          optionA: 'Browser LocalStorage (Zero setup, immediate)',
          optionB: 'REST API + Express Backend (Cloud synced)',
          recommendation: 'Browser LocalStorage for rapid iteration'
        },
        {
          id: 't2',
          title: 'Folder & Component Hierarchy',
          optionA: 'Modular Component Folders (Simple, clear)',
          optionB: 'Feature-Sliced Design / FSD (Strict isolation)',
          recommendation: 'Feature-Sliced Design for long-term scalability'
        }
      ]
    }
  }
};

/** Questions in the level's voice, cut to the count the level is allowed, most important first. */
export function buildOfflineFirstSteps(opts: {
  level?: string | null;
  isRu: boolean;
  isGame: boolean;
}): OfflineFirstSteps {
  const { level, isRu, isGame } = opts;
  const lang: Lang = isRu ? 'ru' : 'en';
  const family: Family = isGame ? 'game' : 'app';
  const voice = levelVoice(level);

  const pool = voice === 'plain' ? PLAIN_QUESTIONS : TECHNICAL_QUESTIONS;
  const questions = pool[lang][family].slice(0, questionLimit(level)).map((question) => ({ ...question }));

  return { questions, tradeOffs: TRADE_OFFS[lang][family][voice].map((tradeOff) => ({ ...tradeOff })) };
}

/**
 * The voice of the local plan. The plan's structure — phases, tasks, criteria, test demands — is
 * identical at every level; what the level buys is how much of it is spelled out in words instead of
 * file names and commands.
 */
export interface OfflinePlanVoice {
  plain: boolean;
  /** One line for coreValue: who does the work. */
  planNote: string;
  testingStrategy: string;
  clarifyingQuestions: string[];
  /** The no-terminal way to check a criterion, added next to the technical demand, never instead. */
  manualCheck: (criterion: string) => string;
}

const PLAIN_PLAN_VOICE: Record<Lang, Omit<OfflinePlanVoice, 'plain'>> = {
  ru: {
    planNote: 'шаги выполняет ИИ-агент, вам остаётся проверять результат',
    testingStrategy:
      'Проверяем вручную: вы открываете проект и убеждаетесь, что всё работает. Сборку и проверку типов приложение запускает само — в терминале вам ничего вводить не нужно.',
    clarifyingQuestions: [
      'Что должно происходить при самом первом запуске, чтобы это было понятно человеку?',
      'Что важнее сделать в первую очередь, если времени мало?'
    ],
    manualCheck: (criterion) => `Как проверить без терминала: откройте проект и убедитесь, что ${criterion}`
  },
  en: {
    planNote: 'your AI agent does the steps, you check the result',
    testingStrategy:
      'Checked by hand: you open the project and see it working. The app runs the build and the type check itself — you type nothing in a terminal.',
    clarifyingQuestions: [
      'What should happen on the very first run for a person to understand it?',
      'If time is short, what has to be built first?'
    ],
    manualCheck: (criterion) => `How to check without a terminal: open the project and confirm that ${criterion}`
  }
};

const TECHNICAL_PLAN_VOICE: Record<Lang, Omit<OfflinePlanVoice, 'plain'>> = {
  ru: {
    planNote: 'модульные контракты, строгая типизация и проверяемые критерии приёмки',
    testingStrategy: 'Модульное тестирование переходов стейта и граничных случаев',
    clarifyingQuestions: [
      'Целевая среда исполнения: браузер или standalone-сборка?',
      'Где должны жить данные — в браузере пользователя или на сервере, и нужен ли вход в аккаунт?'
    ],
    manualCheck: (criterion) => `Ручная проверка: ${criterion}`
  },
  en: {
    planNote: 'modular contracts, strict typing and verifiable acceptance criteria',
    testingStrategy: 'Unit tests for state transitions and edge cases',
    clarifyingQuestions: [
      'Target runtime: browser or a standalone build?',
      'Where should the data live — in the user\u2019s browser or on a server, and is signing in required?'
    ],
    manualCheck: (criterion) => `Manual check: ${criterion}`
  }
};

/**
 * The two questions a game is actually asked at a technical level.
 *
 * They used to live inside the technical voice itself, so a to-do app at Средний/Продвинутый was
 * asked whether it needed sound effects and voice synthesis — a question from another product, in
 * the middle of a wizard the user had no way to answer. The app questions stay in the voice; only the
 * game overrides them.
 */
const TECHNICAL_GAME_QUESTIONS: Record<Lang, string[]> = {
  ru: [
    'Как игрок управляет персонажем или объектами: мышь, клавиатура или касания?',
    'По какому условию игра заканчивается — время, очки или оставшиеся жизни?'
  ],
  en: [
    'How does the player control the character or the objects: mouse, keyboard, or touch?',
    'What ends the game — a timer, points, or lives left?'
  ]
};

export function offlinePlanVoice(
  level: string | undefined | null,
  isRu: boolean,
  isGame = false
): OfflinePlanVoice {
  const plain = levelVoice(level) === 'plain';
  const source = plain ? PLAIN_PLAN_VOICE : TECHNICAL_PLAN_VOICE;
  const voice = isRu ? source.ru : source.en;
  const lang: Lang = isRu ? 'ru' : 'en';
  return {
    plain,
    ...voice,
    clarifyingQuestions: !plain && isGame ? TECHNICAL_GAME_QUESTIONS[lang] : voice.clarifyingQuestions
  };
}
