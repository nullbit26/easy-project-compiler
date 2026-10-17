import { ProjectState } from '../types';

export const UNITY_SEED_PROJECT: ProjectState = {
  id: 'proj_unity_survival',
  name: 'Island Survival 3D',
  projectType: 'Unity',
  engineOrFramework: 'Unity 6 (URP)',
  language: 'C#',
  selectedAgent: 'DeepSeek / Web Chat',
  technicalLevel: 'Beginner / Non-coder',
  nextBestAction: 'Назначить ссылку на PlayerStats в компоненте PlayerHealth на префабе Player.',
  brief: {
    id: 'brief_unity_1',
    projectName: 'Island Survival 3D',
    tagline: 'Исследование необитаемого острова, сбор древесины и камня, контроль уровня голода и здоровья, постройка убежища и защита от диких зверей.',
    targetAudience: 'Любители инди-игр и симуляторов выживания',
    coreProblem: 'Прототипы игр на выживание часто страдают от хаотичных связей компонентов и пустых ссылок в инспекторе.',
    coreValue: 'Модульный игровой процесс выживания с чистыми C# событиями и надежным разделением логики.',
    mvpFeatures: [
      'Перемещение персонажа и Unity Input System',
      'Индикаторы здоровья и голода (HUD)',
      'Автоматическое истощение голода со временем',
      'Сбор ресурсов (дерево, камень)',
      'Базовый интерфейс инвентаря'
    ],
    futureFeatures: [
      'ИИ диких зверей и поиск путей',
      'Расширенная система крафта',
      'Смена дня и ночи',
      'Кооперативный режим'
    ],
    nonGoals: [
      'Без процедурной генерации острова в MVP',
      'Без мультиплеера',
      'Без микротранзакций'
    ],
    technicalConstraints: [
      'Unity 6 (URP) для ПК',
      'Пакет Unity Input System',
      'Изоляция интерфейса через события C#'
    ],
    successCriteria: [
      'Персонаж свободно перемещается по сцене ForestLevel',
      'Шкала голода плавно снижается',
      'Здоровье уменьшается при нулевом голоде',
      'Ноль исключений NullReferenceException в консоли'
    ]
  },
  architecture: {
    technologyStack: ['Unity 6.0', 'C#', 'Universal Render Pipeline (URP)', 'Unity Input System 1.7'],
    folderStructure: [
      'Assets/Core/ (GameManager, EventBus)',
      'Assets/Features/Player/ (PlayerController, PlayerHealth, PlayerStats)',
      'Assets/Features/Survival/ (HungerSystem, ResourceCollector)',
      'Assets/UI/HUD/ (SurvivalStatusBar, InventoryUI)',
      'Assets/Scenes/ (ForestLevel.unity)',
      'Assets/Prefabs/ (Player.prefab, TreeResource.prefab)'
    ],
    coreEntities: ['Player', 'PlayerStats', 'PlayerHealth', 'HungerSystem', 'ResourceItem'],
    dataFlow: 'Ввод игрока обновляет движение и параметры -> Событие OnStatChanged в C# -> HUD обновляет шкалу -> Нулевой голод наносит урон здоровью.',
    testingStrategy: 'Unity Test Runner для логики расчета характеристик и проверка привязки HUD в режиме Play.',
    deploymentPlan: 'Автономная 64-битная сборка для Windows.',
    securityRisks: ['Проверка сериализации локального файла сохранений']
  },
  projectMap: {
    projectName: 'Island Survival 3D',
    projectType: 'Unity',
    engineOrFramework: 'Unity 6 (URP)',
    language: 'C#',
    version: '6000.0.23f1',
    rulesFiles: ['AGENTS.md', 'CLAUDE.md', '.cursor/rules'],
    files: [
      {
        path: 'Assets/Features/Player/PlayerController.cs',
        type: 'code',
        symbols: ['PlayerController', 'HandleMovement', 'OnJump'],
        imports: ['UnityEngine', 'UnityEngine.InputSystem'],
        description: 'Управление 3D-физикой персонажа и вызовы Unity Input System.'
      },
      {
        path: 'Assets/Features/Player/PlayerHealth.cs',
        type: 'code',
        symbols: ['PlayerHealth', 'TakeDamage', 'Heal', 'currentHealth'],
        imports: ['UnityEngine'],
        relatedFiles: ['Assets/Prefabs/Player.prefab', 'Assets/Features/Player/PlayerStats.cs'],
        description: 'Управление очками здоровья, событиями урона и триггером гибели.'
      },
      {
        path: 'Assets/Features/Player/PlayerStats.cs',
        type: 'code',
        symbols: ['PlayerStats', 'hunger', 'maxHunger', 'OnHungerDepleted'],
        imports: ['UnityEngine'],
        relatedFiles: ['Assets/UI/HUD/SurvivalStatusBar.cs'],
        description: 'Хранение значений голода, выносливости и температуры.'
      },
      {
        path: 'Assets/UI/HUD/SurvivalStatusBar.cs',
        type: 'code',
        symbols: ['SurvivalStatusBar', 'UpdateHealthBar', 'UpdateHungerBar'],
        imports: ['UnityEngine', 'UnityEngine.UI'],
        description: 'Визуальные ползунки интерфейса HUD для здоровья и голода.'
      },
      {
        path: 'Assets/Prefabs/Player.prefab',
        type: 'prefab',
        symbols: ['Player GameObject', 'PlayerController', 'PlayerHealth', 'PlayerStats'],
        description: 'Основной игровой объект игрока с прикрепленными компонентами.'
      },
      {
        path: 'Assets/Scenes/ForestLevel.unity',
        type: 'scene',
        symbols: ['Main Light', 'Terrain', 'Player (Prefab Instance)', 'Canvas'],
        description: 'Главная игровая сцена ForestLevel.'
      },
      {
        path: 'Assets/Tests/PlayerSurvivalTests.cs',
        type: 'test',
        symbols: ['TestHungerDepletion', 'TestDamageAtZeroHunger'],
        imports: ['UnityEngine.TestTools', 'NUnit.Framework'],
        description: 'Модульные тесты механики характеристик.'
      }
    ],
    detectedArchitecture: {
      componentsOrScriptsCount: 5,
      hasTests: true,
      hasSaveSystem: false,
      mainEntry: 'Assets/Scenes/ForestLevel.unity'
    }
  },
  phases: [
    {
      id: 'p0',
      phaseNumber: 0,
      title: 'Этап 0 - Базовый каркас',
      purpose: 'Настройка префаба игрока, освещения сцены URP и управления персонажем.',
      deliverable: 'Управляемый персонаж на локации ForestLevel.',
      tasks: [
        {
          id: 't0_1',
          phaseId: 'p0',
          title: 'Настройка префаба игрока и Input System',
          goal: 'Связать контроллер персонажа с Unity Input System.',
          status: 'completed',
          relevantFiles: ['Assets/Features/Player/PlayerController.cs', 'Assets/Prefabs/Player.prefab'],
          acceptanceCriteria: [
            { id: 'ac0_1', description: 'Персонаж перемещается клавишами WASD', passed: true },
            { id: 'ac0_2', description: 'Камера вращается движением мыши', passed: true }
          ],
          testRequirements: ['Проверка привязки действий ввода'],
          estimatedComplexity: 'Малая (1 промпт)',
          dependencies: [],
          progressPercent: 100
        }
      ]
    },
    {
      id: 'p1',
      phaseNumber: 1,
      title: 'Этап 1 - Параметры выживания',
      purpose: 'Добавление системы здоровья, истощения голода и интерфейса HUD.',
      deliverable: 'Система истощения голода с нанесением урона при нулевом значении.',
      tasks: [
        {
          id: 't1_1',
          phaseId: 'p1',
          title: 'Механика голода и цикл урона',
          goal: 'Снижать голод со временем и наносить урон здоровью при нулевом голоде.',
          status: 'partial',
          relevantFiles: [
            'Assets/Features/Player/PlayerStats.cs',
            'Assets/Features/Player/PlayerHealth.cs',
            'Assets/UI/HUD/SurvivalStatusBar.cs',
            'Assets/Prefabs/Player.prefab'
          ],
          forbiddenFiles: ['Assets/Legacy/OldHealthSystem.cs'],
          acceptanceCriteria: [
            { id: 'ac1_1', description: 'Голод уменьшается каждые 2 секунды', passed: true },
            { id: 'ac1_2', description: 'Индикатор голода в HUD обновляется в реальном времени', passed: true },
            { id: 'ac1_3', description: 'Здоровье уменьшается при нулевом значении голода', passed: false, notes: 'Отсутствует ссылка в инспекторе' },
            { id: 'ac1_4', description: 'Модульные тесты добавлены в PlayerSurvivalTests.cs', passed: false }
          ],
          testRequirements: ['Проверка вызова TakeDamage(5) при нулевом голоде'],
          estimatedComplexity: 'Средняя (2-3 промпта)',
          dependencies: ['t0_1'],
          progressPercent: 60
        }
      ]
    },
    {
      id: 'p2',
      phaseNumber: 2,
      title: 'Этап 2 - Инвентарь и крафт',
      purpose: 'Сбор дерева и камня с сохранением в инвентаре.',
      deliverable: 'Рабочая сетка инвентаря и верстак для крафта.',
      tasks: [
        {
          id: 't2_1',
          phaseId: 'p2',
          title: 'Сбор ресурсов и сетка инвентаря',
          goal: 'Взаимодействие с деревьями для сбора дерева и отображение в интерфейсе.',
          status: 'backlog',
          relevantFiles: ['Assets/UI/HUD/InventoryUI.cs'],
          acceptanceCriteria: [
            { id: 'ac2_1', description: 'Сбор ресурса нажатием клавиши E', passed: false }
          ],
          testRequirements: ['Проверка подсчета предметов в стеке'],
          estimatedComplexity: 'Средняя (2-3 промпта)',
          dependencies: ['t1_1'],
          progressPercent: 0
        }
      ]
    }
  ],
  recentErrors: [
    {
      id: 'err_null_ref_1',
      errorType: 'NullReferenceException',
      location: 'Assets/Features/Player/PlayerHealth.cs, строка 42',
      whenOccurs: 'Когда показатель голода достигает 0 и PlayerHealth обращается к playerStats.TakeDamage()',
      explanations: {
        verySimple: 'Игра ищет компонент характеристик игрока, но он не был привязан в панели Inspector.',
        clear: 'Скрипт PlayerHealth ожидает ссылку на PlayerStats, но поле playerStats не заполнено (null).',
        technical: 'Переменная playerStats в PlayerHealth.cs не инициализирована. Вызов playerStats.hunger вызывает NullReferenceException.'
      },
      likelyCauses: [
        'В PlayerHealth.cs добавлено поле [SerializeField] private PlayerStats playerStats, но оно не назначено в инспекторе префаба Player.',
        'Компонент PlayerStats был случайно удален с префаба Player.'
      ],
      affectedFeatures: ['Урон от истощения голода', 'Анимация шкалы здоровья при истощении'],
      visualCauseChain: [
        { label: 'Префаб Player.prefab', type: 'component', detail: 'Содержит скрипты PlayerHealth и PlayerStats' },
        { label: 'Файл PlayerHealth.cs', type: 'file', detail: 'Строка 42: playerStats.TakeDamage()' },
        { label: 'Неназначенное поле', type: 'issue', detail: 'playerStats = null в инспекторе Unity' },
        { label: 'NullReferenceException', type: 'outcome', detail: 'Игра останавливается с ошибкой при нулевом голоде' }
      ],
      codeDiff: {
        filePath: 'Assets/Features/Player/PlayerHealth.cs',
        oldCode: 'private PlayerStats playerStats; // Неназначенное поле',
        newCode: '[SerializeField] private PlayerStats playerStats;\n\nvoid Awake() {\n    if (playerStats == null) playerStats = GetComponent<PlayerStats>();\n}',
        highlightReason: 'Автоматический поиск компонента через GetComponent в Awake'
      },
      repairPrompt: 'Измените Assets/Features/Player/PlayerHealth.cs: если playerStats равен null в Awake(), автоматически вызывайте GetComponent<PlayerStats>(). Убедитесь, что исключение NullReferenceException не возникает при получении урона от голода.',
      verificationSteps: [
        'Открыть префаб Assets/Prefabs/Player.prefab в Unity',
        'Выбрать компонент скрипта PlayerHealth',
        'Перетащить компонент PlayerStats в поле Player Stats (или дождаться автопоиска в Awake)',
        'Запустить режим Play и дождаться снижения голода до 0'
      ],
      confidenceScore: 92
    }
  ],
  rulesFilesContent: {
    agentsMd: `# Инструкции для DeepSeek и веб-чатов\n- Предоставлять полный рабочий код файлов без сокращений\n- Изолировать логику через события C#\n- Размещать скрипты в Assets/Features/<FeatureName>/\n- Использовать Unity Input System`,
    claudeMd: `# Claude Code Rules\n- Target Unity 6 URP\n- Maintain clean MonoBehaviour event hooks`,
    cursorRules: `# Cursor Rules\n- Check @Assets/Prefabs/Player.prefab references before modifying PlayerHealth.cs`
  }
};

export const REACT_SEED_PROJECT: ProjectState = {
  id: 'proj_react_saas',
  name: 'TaskMaster AI SaaS',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite + Express',
  language: 'TypeScript',
  selectedAgent: 'DeepSeek / Web Chat',
  technicalLevel: 'Vibe-coder',
  nextBestAction: 'Завершить маршрут /api/tasks в server.ts для серверной фильтрации.',
  brief: {
    id: 'brief_react_1',
    projectName: 'TaskMaster AI SaaS',
    tagline: 'Интеллектуальный таск-менеджер с автоматической расстановкой приоритетов и прогнозированием сроков.',
    targetAudience: 'Индивидуальные разработчики и менеджеры проектов',
    coreProblem: 'Традиционные планировщики перегружены ручной рутиной и тегами.',
    coreValue: 'Автоматическая категоризация задач и рекомендации топ-3 ключевых задач на день.',
    mvpFeatures: [
      'Интерактивная канбан-доска',
      'Автоматическое тегирование задач',
      'Фильтрация по приоритетам и статусам',
      'Локальное сохранение данных'
    ],
    futureFeatures: ['Синхронизация с календарем', 'Командные пространства'],
    nonGoals: ['Без диаграмм Ганта в MVP', 'Без видеозвонков'],
    technicalConstraints: ['React 19', 'Вызовы API Gemini только через Express'],
    successCriteria: ['Создание задачи быстрее 200 мс', 'Автогенерация тегов за 1.5 с']
  },
  architecture: {
    technologyStack: ['React 19', 'TypeScript', 'Tailwind CSS', 'Express', 'Vite'],
    folderStructure: [
      'src/components/ (TaskCard.tsx, KanbanBoard.tsx)',
      'src/services/ (api.ts)',
      'src/types/ (index.ts)',
      'server.ts (Express backend)'
    ],
    coreEntities: ['Task', 'Tag', 'UserPreference'],
    dataFlow: 'Клиентский UI -> POST /api/tasks -> Сервер Express -> Автотегирование -> Возврат задачи.',
    testingStrategy: 'Vitest для рендеринга компонентов и модульных тестов API.',
    deploymentPlan: 'Docker-контейнер для Cloud Run.',
    securityRisks: ['Хранение ключей строго на сервере в process.env']
  },
  projectMap: {
    projectName: 'TaskMaster AI SaaS',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite + Express',
    language: 'TypeScript',
    version: '1.0.0',
    rulesFiles: ['AGENTS.md', 'CLAUDE.md'],
    files: [
      {
        path: 'src/App.tsx',
        type: 'code',
        symbols: ['App', 'useTasks'],
        description: 'Главный макет панели управления с канбан-доской.'
      },
      {
        path: 'src/components/KanbanBoard.tsx',
        type: 'code',
        symbols: ['KanbanBoard', 'TaskColumn'],
        description: 'Многоколоночная доска задач.'
      },
      {
        path: 'src/types/index.ts',
        type: 'code',
        symbols: ['Task', 'TaskStatus', 'TaskPriority'],
        description: 'Определения интерфейсов TypeScript.'
      },
      {
        path: 'server.ts',
        type: 'code',
        symbols: ['express', 'POST /api/tasks/auto-tag'],
        description: 'Точка входа сервера Express.'
      }
    ]
  },
  phases: [
    {
      id: 'p0',
      phaseNumber: 0,
      title: 'Этап 0 - Настройка React и сервера',
      purpose: 'Подключение клиентской части Vite к серверу Express.',
      deliverable: 'Работающий сервер с проверкой работоспособности и базовым UI.',
      tasks: [
        {
          id: 't0_react',
          phaseId: 'p0',
          title: 'Настройка сервера Express и прокси API',
          goal: 'Создать server.ts с маршрутом POST /api/tasks.',
          status: 'completed',
          relevantFiles: ['server.ts'],
          acceptanceCriteria: [{ id: 'ac1', description: 'GET /api/health возвращает ok', passed: true }],
          testRequirements: ['Проверка curl health'],
          estimatedComplexity: 'Малая (1 промпт)',
          dependencies: [],
          progressPercent: 100
        }
      ]
    }
  ],
  recentErrors: [],
  rulesFilesContent: {
    agentsMd: `# Инструкции для DeepSeek и веб-чатов\n- Предоставлять полный рабочий код файлов\n- Все вызовы API направлять на /api/*\n- Не публиковать секретные ключи в клиенте`,
    claudeMd: `# Claude Rules\n- Use Tailwind utility classes for styling`,
    cursorRules: `# Cursor Rules\n- Prefer functional components with hooks`
  }
};

export const PHASER_SEED_PROJECT: ProjectState = {
  id: 'proj_phaser_beer_simulator',
  name: 'Beer Simulator 2D',
  projectType: 'Phaser.js',
  engineOrFramework: 'Phaser.js 3 (HTML5 Canvas / WebGL)',
  language: 'TypeScript',
  selectedAgent: 'DeepSeek / Web Chat',
  technicalLevel: 'Beginner / Non-coder',
  nextBestAction: 'Реализовать CapPhysicsCollider в MainScene.ts для обработки движения открывашки.',
  brief: {
    id: 'brief_phaser_1',
    projectName: 'Beer Simulator 2D',
    tagline: 'Забавная браузерная 2D-игра с векторной физикой: открывание напитков, наливание жидкости и контроль уровня пены.',
    targetAudience: 'Любители браузерных игр и инди-аркад',
    coreProblem: 'Прототипы браузерных игр часто теряют кадры без правильной предзагрузки ассетов.',
    coreValue: 'Плавные 60 fps в HTML5 Canvas, звуковые эффекты и модульная архитектура сцен Phaser 3.',
    mvpFeatures: [
      'Интерактивная открывашка с физикой перетаскивания',
      'Звук хлопка пробки и частицы пены',
      'Детектор уровня жидкости в бокале',
      'Таймер и счетчик очков'
    ],
    futureFeatures: ['Меню напитков', 'Глобальная таблица рекордов'],
    nonGoals: ['Без сложного 3D-рендеринга в 2D MVP'],
    technicalConstraints: ['Phaser 3.80+ в браузере', 'Предзагрузка ассетов в BootScene'],
    successCriteria: [
      'Пробка плавно отлетает при столкновении',
      'Жидкость наполняет бокал без перелива',
      'Стабильные 60 кадров в секунду'
    ]
  },
  architecture: {
    technologyStack: ['Phaser 3.80', 'TypeScript', 'HTML5 Canvas', 'Vite', 'Web Audio API'],
    folderStructure: [
      'src/scenes/BootScene.ts (Предзагрузчик ассетов)',
      'src/scenes/MainScene.ts (Физический мир и бутылка)',
      'src/scenes/HUDScene.ts (Интерфейс очков и шкалы)',
      'src/objects/Bottle.ts (Контейнер бутылки и крышки)',
      'public/assets/ (Спрайты и звуки)'
    ],
    coreEntities: ['Bottle', 'Opener', 'LiquidParticle', 'GlassMeter', 'ScoreTracker'],
    dataFlow: 'Жест перетаскивания -> Физическое тело открывашки -> Столкновение с пробкой -> Частицы жидкости -> Обновление очков в HUD.',
    testingStrategy: 'Проверка границ физики и симуляция сцен Phaser.',
    deploymentPlan: 'Статический веб-бандл Vite.',
    securityRisks: ['Проверка отправки рекордов']
  },
  projectMap: {
    projectName: 'Beer Simulator 2D',
    projectType: 'Phaser.js',
    engineOrFramework: 'Phaser.js 3 (HTML5 Canvas / WebGL)',
    language: 'TypeScript',
    version: '3.80.0',
    rulesFiles: ['AGENTS.md', 'CLAUDE.md'],
    files: [
      {
        path: 'src/scenes/MainScene.ts',
        type: 'code',
        symbols: ['MainScene', 'create', 'update', 'handleOpenerDrag'],
        imports: ['phaser'],
        description: 'Главная игровая сцена: физические тела, столкновения и подсчет очков.'
      },
      {
        path: 'src/objects/Bottle.ts',
        type: 'code',
        symbols: ['Bottle', 'popCap', 'pourLiquid'],
        imports: ['phaser'],
        description: 'Игровой объект бутылки, крепления крышки и эмиттера жидкости.'
      },
      {
        path: 'src/scenes/HUDScene.ts',
        type: 'code',
        symbols: ['HUDScene', 'updatePourMeter', 'showScore'],
        imports: ['phaser'],
        description: 'Интерфейс оверлея со шкалой наливания и кнопкой перезапуска.'
      }
    ]
  },
  phases: [
    {
      id: 'p0_phaser',
      phaseNumber: 0,
      title: 'Этап 0 - Настройка сцен Phaser и физики',
      purpose: 'Конфигурация игры Phaser 3, загрузчик BootScene и область холста.',
      deliverable: 'Работающий HTML5 Canvas с предзагруженными спрайтами.',
      tasks: [
        {
          id: 't0_phaser_1',
          phaseId: 'p0_phaser',
          title: 'Создание инстанса Phaser и BootScene',
          goal: 'Инициализировать Phaser 3 с Arcade Physics и экраном загрузки.',
          status: 'completed',
          relevantFiles: ['src/scenes/BootScene.ts', 'src/scenes/MainScene.ts'],
          acceptanceCriteria: [
            { id: 'ac_p1', description: 'Холст Phaser рендерится со скоростью 60 fps', passed: true },
            { id: 'ac_p2', description: 'BootScene переходит в MainScene после загрузки', passed: true }
          ],
          testRequirements: ['Проверка монтирования холста'],
          estimatedComplexity: 'Малая (1 промпт)',
          dependencies: [],
          progressPercent: 100
        }
      ]
    },
    {
      id: 'p1_phaser',
      phaseNumber: 1,
      title: 'Этап 1 - Физика открывашки и наливание',
      purpose: 'Управление открывашкой, столкновение с крышкой и частицы жидкости.',
      deliverable: 'Игровой цикл открывания напитка и наполнения бокала.',
      tasks: [
        {
          id: 't1_phaser_1',
          phaseId: 'p1_phaser',
          title: 'Создание жеста перетаскивания и столкновения',
          goal: 'Позволить игроку тянуть открывашку, срывать крышку и запускать струю.',
          status: 'ready',
          relevantFiles: ['src/scenes/MainScene.ts', 'src/objects/Bottle.ts'],
          acceptanceCriteria: [
            { id: 'ac_p3', description: 'Открывашка следует за курсором с физическим демпфированием', passed: false },
            { id: 'ac_p4', description: 'Столкновение с крышкой подбрасывает ее вверх', passed: false },
            { id: 'ac_p5', description: 'Наклон бутылки выпускает частицы жидкости в бокал', passed: false }
          ],
          testRequirements: ['Проверка коллбэка столкновения'],
          estimatedComplexity: 'Средняя (2-3 промпта)',
          dependencies: ['t0_phaser_1'],
          progressPercent: 0
        }
      ]
    }
  ],
  recentErrors: [],
  rulesFilesContent: {
    agentsMd: `# Инструкции для DeepSeek и веб-чатов\n- Предоставлять полный рабочий код\n- Использовать методы жизненного цикла сцен (preload, create, update)\n- Предзагружать ресурсы в BootScene`,
    claudeMd: `# Claude Rules for Phaser\n- Avoid direct DOM manipulation inside Phaser render loop`,
    cursorRules: `# Cursor Rules\n- Ensure Phaser.GameConfig scale mode is set to FIT`
  }
};

export const GODOT_SEED_PROJECT: ProjectState = {
  id: 'proj_godot_action',
  name: 'Pixel Knight 2D',
  projectType: 'Godot',
  engineOrFramework: 'Godot 4.3 (GDScript)',
  language: 'GDScript',
  selectedAgent: 'DeepSeek / Web Chat',
  technicalLevel: 'Vibe-coder',
  nextBestAction: 'Подключить сигналы CharacterBody2D в Player.gd к AnimatedSprite2D.',
  brief: {
    id: 'brief_godot_1',
    projectName: 'Pixel Knight 2D',
    tagline: 'Динамичный 2D экшен-платформер на узлах Godot 4 с физикой CharacterBody2D и слоями TileMap.',
    targetAudience: 'Разработчики инди-игр и поклонники ретро-платформеров',
    coreProblem: 'Сигналы узлов GDScript могут ломаться при жестко заданных путях без ссылок @export.',
    coreValue: 'Модульная иерархия узлов с типизированным экспортом и изолированной стейт-машиной.',
    mvpFeatures: [
      'Движение CharacterBody2D, прыжок и скольжение по стенам',
      'Коллизии уровней через TileMapLayer',
      'ИИ патрулирования врагов и система урона',
      'Интерфейс HUD со здоровьем и монетами'
    ],
    futureFeatures: ['Сцена битвы с боссом', 'Поддержка геймпада'],
    nonGoals: ['Без 3D-освещения в 2D MVP'],
    technicalConstraints: ['Движок Godot 4.3+', 'Строгая статическая типизация GDScript'],
    successCriteria: ['Плавное движение 60 fps', 'Ноль ошибок времени выполнения в консоли']
  },
  architecture: {
    technologyStack: ['Godot 4.3', 'GDScript', 'CharacterBody2D', 'TileMapLayer'],
    folderStructure: [
      'scenes/player/Player.tscn',
      'scenes/levels/Level01.tscn',
      'scripts/player/Player.gd',
      'scripts/enemies/PatrolEnemy.gd',
      'assets/sprites/'
    ],
    coreEntities: ['Player', 'PatrolEnemy', 'Coin', 'HUD'],
    dataFlow: 'Ввод игрока -> Расчет скорости CharacterBody2D -> move_and_slide() -> Сигнал Area2D обновляет HUD.',
    testingStrategy: 'Модульное тестирование характеристик игрока в GUT.',
    deploymentPlan: 'Экспорт в Web (HTML5 / WebAssembly) или десктоп.',
    securityRisks: []
  },
  projectMap: {
    projectName: 'Pixel Knight 2D',
    projectType: 'Godot',
    engineOrFramework: 'Godot 4.3 (GDScript)',
    language: 'GDScript',
    version: '4.3.0',
    rulesFiles: ['AGENTS.md', 'CLAUDE.md'],
    files: [
      {
        path: 'scripts/player/Player.gd',
        type: 'code',
        symbols: ['Player', '_physics_process', '_handle_jump'],
        description: 'GDScript управления 2D-движением, гравитацией и прыжком.'
      },
      {
        path: 'scenes/player/Player.tscn',
        type: 'scene',
        symbols: ['CharacterBody2D', 'AnimatedSprite2D', 'CollisionShape2D'],
        description: 'Дерево сцены игрока с физическим телом, коллизией и анимацией.'
      }
    ]
  },
  phases: [
    {
      id: 'p0_godot',
      phaseNumber: 0,
      title: 'Этап 0 - Настройка узлов Godot',
      purpose: 'Создание сцены игрока и карты ввода.',
      deliverable: 'Управляемый персонаж, передвигающийся по TileMap.',
      tasks: [
        {
          id: 't0_godot_1',
          phaseId: 'p0_godot',
          title: 'Настройка CharacterBody2D и карты ввода',
          goal: 'Настроить вызов move_and_slide() в Player.gd.',
          status: 'completed',
          relevantFiles: ['scripts/player/Player.gd', 'scenes/player/Player.tscn'],
          acceptanceCriteria: [{ id: 'ac_g1', description: 'Персонаж двигается влево/вправо и прыгает', passed: true }],
          testRequirements: ['Тестирование перемещения персонажа'],
          estimatedComplexity: 'Малая (1 промпт)',
          dependencies: [],
          progressPercent: 100
        }
      ]
    }
  ],
  recentErrors: [],
  rulesFilesContent: {
    agentsMd: `# Инструкции для DeepSeek и веб-чатов\n- Предоставлять полный рабочий код\n- Использовать типизированный GDScript\n- Использовать ссылки @onready и @export вместо get_node()`,
    claudeMd: `# Claude Godot Rules\n- Target Godot 4.3 compatibility`,
    cursorRules: `# Cursor Rules\n- Ensure signal connects are declared via GDScript or editor`
  }
};
