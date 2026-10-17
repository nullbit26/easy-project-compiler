export function localizeText(text: string | undefined | null, language: 'ru' | 'en'): string {
  if (!text) return '';
  if (language === 'en') return text;

  let res = text;

  // Replace Next Best Action phrases
  res = res.replace(/^Start with Step (\d+):/i, 'Начните с Шага $1:');
  res = res.replace(/^Compile prompt for Phase (\d+) setup\./i, 'Скомпилируйте промпт для этапа $1.');
  res = res.replace(/Assign missing PlayerStats reference on PlayerHealth component in Player\.prefab\./gi, 'Назначить ссылку на PlayerStats в компоненте PlayerHealth на префабе Player.');

  // Replace Tagline prefix
  res = res.replace(/^A tailored MVP project plan for:/i, 'План MVP проекта для:');

  // Common phase titles
  res = res.replace(/Phase (\d+): Workspace & State Foundation/gi, 'Этап $1: Базовая структура и стейт');
  res = res.replace(/Phase (\d+): Implement Survival Mechanics/gi, 'Этап $1: Реализация механики выживания');
  res = res.replace(/Phase (\d+): Verification & Polish/gi, 'Этап $1: Верификация и полировка');
  res = res.replace(/Phase (\d+): Architecture & Contracts/gi, 'Этап $1: Архитектура и контракты');
  res = res.replace(/Phase (\d+): Enterprise Domain Logic/gi, 'Этап $1: Доменная логика и сервисы');
  res = res.replace(/Phase (\d+): Automated Testing & Security Guards/gi, 'Этап $1: Автотесты и барьеры ошибок');
  res = res.replace(/Phase (\d+): CI\/CD & Production Build Polish/gi, 'Этап $1: CI/CD и полировка релиза');
  res = res.replace(/Workspace & State Foundation/gi, 'Базовая структура и стейт');
  res = res.replace(/Implement (.*?) Mechanics/gi, 'Реализация механики $1');
  res = res.replace(/Verification & Polish/gi, 'Верификация и полировка');
  res = res.replace(/Rapid Prototype Skeleton/gi, 'Скелет прототипа');
  res = res.replace(/Prototype Mechanics for (.*?)/gi, 'Механика прототипа $1');
  res = res.replace(/Architecture & Contracts/gi, 'Архитектура и контракты');
  res = res.replace(/Enterprise Domain Logic/gi, 'Доменная логика и сервисы');
  res = res.replace(/Automated Testing & Security Guards/gi, 'Автотесты и барьеры ошибок');
  res = res.replace(/CI\/CD & Production Build Polish/gi, 'CI/CD и полировка релиза');
  res = res.replace(/^Foundation$/gi, 'Базовый каркас');
  res = res.replace(/^Survival Stats$/gi, 'Параметры выживания');

  // Common task titles
  res = res.replace(/Initialize (.*?) project & state provider/gi, 'Инициализировать проект $1 и стейт');
  res = res.replace(/Initialize (.*?) prototype skeleton/gi, 'Инициализировать скелет прототипа $1');
  res = res.replace(/Initialize (.*?) modular contracts/gi, 'Инициализировать модульные контракты $1');
  res = res.replace(/Build interactive core mechanics for (.*?)/gi, 'Создать интерактивную механику для $1');
  res = res.replace(/Build interactive core mechanics/gi, 'Создать интерактивную механику');
  res = res.replace(/Implement core interaction loop/gi, 'Реализовать базовый цикл взаимодействия');
  res = res.replace(/Build decoupled domain services/gi, 'Создать изолированные доменные сервисы');
  res = res.replace(/Automated test suite and defensive guards/gi, 'Интеграционные тесты и барьеры ошибок');
  res = res.replace(/Production build verification/gi, 'Верификация финальной сборки');
  res = res.replace(/UI polish and acceptance testing/gi, 'Полировка интерфейса и приемочное тестирование');
  res = res.replace(/Setup Player Prefab & Input System/gi, 'Настройка префаба игрока и Input System');
  res = res.replace(/Implement Hunger Mechanic & Damage Loop/gi, 'Реализация механики голода и урона');

  // Common goals
  res = res.replace(/Create project skeleton with (.*?) types and state context/gi, 'Создать скелет проекта с типами $1 и контекстом состояния');
  res = res.replace(/Create project skeleton with C# types and state context/gi, 'Создать скелет проекта с типами C# и контекстом состояния');
  res = res.replace(/Create type schemas and state stores/gi, 'Создать схемы типов и хранилища состояния');
  res = res.replace(/Connect primary inputs to immediate state feedback/gi, 'Связать действия пользователя с визуальным откликом');
  res = res.replace(/Implement primary user interaction flow/gi, 'Реализовать базовый пользовательский цикл');
  res = res.replace(/Implement main business logic with single responsibility/gi, 'Реализовать бизнес-логику с разделением ответственности');
  res = res.replace(/Verify edge cases and add error boundaries/gi, 'Покрыть краевые сценарии и внедрить Error Boundary');
  res = res.replace(/Ensure zero console warnings and complete user audit/gi, 'Проверка отсутствия предупреждений и аудит');
  res = res.replace(/Zero console errors and smooth UI feedback/gi, 'Ноль ошибок в консоли и плавный интерфейс');

  // Common acceptance criteria
  res = res.replace(/(.*?) app loads with zero build warnings/gi, 'Приложение $1 собирается без предупреждений');
  res = res.replace(/Unity 6 \(URP\) app loads with zero build warnings/gi, 'Приложение Unity 6 (URP) собирается без предупреждений');
  res = res.replace(/Context \/ State Machine provides currentState and step transition functions/gi, 'Стейт-машина предоставляет currentState и функции перехода');
  res = res.replace(/User actions respond immediately/gi, 'Действия пользователя вызывают немедленный отклик');
  res = res.replace(/User actions trigger state changes/gi, 'Действия пользователя меняют состояние');
  res = res.replace(/Interactive controls handle inputs cleanly/gi, 'Элементы управления корректно обрабатывают ввод');
  res = res.replace(/State updates cleanly/gi, 'Состояние корректно обновляется');
  res = res.replace(/Zero console errors/gi, 'Ноль ошибок в консоли');
  res = res.replace(/Full user flow tested/gi, 'Полный сценарий протестирован');
  res = res.replace(/Strict types enforced/gi, 'Строгая типизация настроена');
  res = res.replace(/Modular stores exported/gi, 'Модульные хранилища экспортированы');
  res = res.replace(/Domain logic isolated/gi, 'Доменная логика изолирована');
  res = res.replace(/Zero tight coupling/gi, 'Отсутствует жесткая связанность');
  res = res.replace(/Unit and integration tests pass/gi, 'Модульные и интеграционные тесты проходят успешно');
  res = res.replace(/Error boundaries catch exceptions/gi, 'Контуры ошибок перехватывают исключения');
  res = res.replace(/Clean production build/gi, 'Чистая релизная сборка');
  res = res.replace(/Audited bundle output/gi, 'Аудит бандла завершен');
  res = res.replace(/Character moves smoothly with WASD\/Arrows/gi, 'Персонаж плавно перемещается на WASD/стрелки');
  res = res.replace(/Camera follows player without jitter/gi, 'Камера следует за игроком без рывков');
  res = res.replace(/Hunger bar decreases by 1 every 5 seconds/gi, 'Шкала голода уменьшается на 1 каждые 5 секунд');
  res = res.replace(/When hunger reaches 0, health starts depleting/gi, 'При нулевом голоде здоровье начинает убывать');
  res = res.replace(/Player dies when health reaches 0 and game over screen appears/gi, 'Игрок погибает при нулевом здоровье, появляется экран завершения');

  // Task complexity labels
  res = res.replace(/^Small \(1 prompt\)$/i, 'Малая (1 промпт)');
  res = res.replace(/^Medium \(2 prompts\)$/i, 'Средняя (2 промпта)');
  res = res.replace(/^Medium \(2-3 prompts\)$/i, 'Средняя (2-3 промпта)');
  res = res.replace(/^Large \(Needs splitting\)$/i, 'Крупная (требует декомпозиции)');

  // Common deliverables & purposes
  res = res.replace(/Compiling project baseline/gi, 'Компилируемый каркас проекта');
  res = res.replace(/Functional interactive MVP/gi, 'Рабочий интерактивный MVP');
  res = res.replace(/Production-ready MVP build/gi, 'Готовый к использованию релизный MVP');
  res = res.replace(/Playable\/functional core MVP/gi, 'Рабочий функциональный прототип');
  res = res.replace(/Production ready build/gi, 'Готовая релизная сборка');
  res = res.replace(/Deployable enterprise build/gi, 'Готовая релизная сборка');
  res = res.replace(/Compiling prototype skeleton/gi, 'Компилируемый прототип');
  res = res.replace(/Architectural foundation/gi, 'Архитектурный фундамент');
  res = res.replace(/Set up file structure, types, and base state machine/gi, 'Настройка структуры файлов, типов и базового состояния');
  res = res.replace(/Build interactive core mechanics and visual feedback loop/gi, 'Интерактивная логика и визуальная обратная связь');
  res = res.replace(/Finalize UI polish, edge case checks, and deployment package/gi, 'Полировка интерфейса, краевые случаи и релизный пакет');
  res = res.replace(/Setup player prefab, URP scene lighting, and character controls\./gi, 'Настройка префаба игрока, URP освещения и управления персонажем.');
  res = res.replace(/Playable character moving on terrain in ForestLevel\./gi, 'Управляемый персонаж на локации ForestLevel.');
  res = res.replace(/Add health, hunger system, and HUD integration\./gi, 'Добавление здоровья, системы голода и интеграции с HUD.');
  res = res.replace(/Depleting hunger system that damages health when empty\./gi, 'Система убывания голода с уроном здоровью при опустошении.');
  res = res.replace(/Set up modular file structure, strict typing, and contract interfaces/gi, 'Модульная структура файлов, строгая типизация и интерфейсы');
  res = res.replace(/Implement core business entities and event pipeline/gi, 'Реализация сущностей и конвейера событий');
  res = res.replace(/Implement integration test suites and error boundary guards/gi, 'Интеграционные тесты и барьеры ошибок');
  res = res.replace(/Production bundle optimization and release checklist/gi, 'Оптимизация бандла и релизный чек-лист');
  res = res.replace(/Hardened code with error handling/gi, 'Устойчивый к сбоям код с обработкой ошибок');
  res = res.replace(/Domain logic and state machines/gi, 'Доменная логика и стейт-машины');

  return res;
}
