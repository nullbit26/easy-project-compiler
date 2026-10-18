/**
 * What the local engine may honestly say about a compiled prompt when no model answered.
 *
 * A live pass through the flow as a beginner found the same three sentences under every task in
 * every project: "Код собирается без синтаксических ошибок", "Запрошенный функционал работает
 * корректно", "Отсутствуют неразрешенные импорты" — and, in `tests`, "Запустить проверку
 * измененных модулей", which is not a command anything can run. A beginner copies that prompt into
 * an agent and has no way to tell it apart from one the model wrote.
 *
 * Nothing here is invented: the task's own title, the real file list and the script names a real
 * package.json declares are the only inputs. A fact that is missing makes the list shorter and the
 * confidence lower, never a plausible sentence.
 */

export interface LocalAcceptanceInput {
  isRu: boolean;
  /** The task the prompt is compiled for; falls back to the user's own request. */
  taskTitle: string;
  /** Paths that exist in the project map — never a guess at where the code lives. */
  files: string[];
  /** Script names from the connected folder's package.json, or null when it has none. */
  commands: string[] | null;
  /** Whether a folder is connected at all, so a missing command list can be explained. */
  folderConnected: boolean;
}

export interface LocalAcceptance {
  criteria: string[];
  /** Commands the project can really run; one manual check when it can run none. */
  tests: string[];
  /** Lower than the model's, because it is built from facts rather than from reading the answer. */
  confidence: number;
  warnings: string[];
}

/** The scripts that say something about whether the code still works. */
const VERIFICATION_SCRIPT = /(^|:)(test|tests|spec|lint|typecheck|check|build|verify|e2e)/i;

/** `npm run <script>` — the same form the app's own checks use on the folder. */
export function verificationCommands(commands: string[] | null): string[] {
  if (!commands || commands.length === 0) return [];
  return commands.filter((name) => VERIFICATION_SCRIPT.test(name)).map((name) => `npm run ${name}`);
}

/**
 * Whether the project has a test runner at all.
 *
 * `null` is its own answer: no package.json was read, so the prompt must not claim either way. This
 * is what lets the compiler stop demanding automated tests from a project that has no runner — the
 * demand used to be identical for all projects, so the agent either invented a framework or the
 * app's check failed on an infrastructure nobody asked for.
 */
export function hasTestRunner(commands: string[] | null): boolean | null {
  if (commands === null) return null;
  return commands.some((name) => /test|spec/i.test(name));
}

/** Three paths are enough to name the work; the rest live in the file section of the prompt. */
function sampleFiles(files: string[]): string {
  return files.slice(0, 3).join(', ') + (files.length > 3 ? `, +${files.length - 3}` : '');
}

export function localAcceptance(input: LocalAcceptanceInput): LocalAcceptance {
  const { isRu, taskTitle, files, commands, folderConnected } = input;
  const title = (taskTitle || '').trim() || (isRu ? 'текущая задача' : 'the current task');
  const commandsToRun = verificationCommands(commands);

  const criteria: string[] = [];
  criteria.push(
    isRu
      ? `«${title}» работает в запущенном проекте: действие выполняется, в консоли браузера нет ошибок.`
      : `"${title}" works in the running project: the action completes and the browser console stays clean.`
  );

  criteria.push(
    files.length > 0
      ? isRu
        ? `Затронутые файлы (${sampleFiles(files)}) по-прежнему собираются: существующие экспорты и импорты не переименованы.`
        : `The touched files (${sampleFiles(files)}) still build: no existing export or import was renamed.`
      : isRu
      ? 'Проект собирается без ошибок — папка не подключена, поэтому сборку нужно проверить вручную.'
      : 'The project builds without errors — no folder is connected, so the build has to be checked by hand.'
  );

  if (commandsToRun.length > 0) {
    criteria.push(
      isRu
        ? `Проверки проекта (${commandsToRun.join(', ')}) проходят в папке проекта.`
        : `The project's checks (${commandsToRun.join(', ')}) pass in the project folder.`
    );
  } else {
    criteria.push(
      isRu
        ? 'В проекте нет объявленных команд проверки — поведение проверяется вручную по шагам из задачи.'
        : 'The project declares no verification commands — the behaviour is checked by hand against the task steps.'
    );
  }

  const warnings: string[] = [];
  if (!folderConnected) {
    warnings.push(
      isRu
        ? 'Папка проекта не подключена: критерии собраны по списку файлов, а не по коду. Подключите папку, чтобы проверки запускались сами.'
        : 'No project folder is connected: the criteria come from the file list, not from the code. Connect the folder so the checks run by themselves.'
    );
  } else if (commands && commands.length === 0) {
    warnings.push(
      isRu
        ? 'В package.json нет ни одной команды: запускать в фоне нечего, критерии проверяются вручную.'
        : 'The package.json declares no scripts at all: nothing can run in the background, so the criteria are checked by hand.'
    );
  }
  if (files.length === 0) {
    warnings.push(
      isRu
        ? 'В проекте нет ни одного файла, который можно назвать целевым: промпт опирается только на текст задачи.'
        : 'The project has no file that could be named as a target: the prompt rests on the task text alone.'
    );
  }

  const tests =
    commandsToRun.length > 0
      ? commandsToRun
      : [
          isRu
            ? 'Проверить вручную: выполнить действие из задачи в запущенном проекте и посмотреть консоль'
            : 'Check by hand: run the task action in the running project and watch the console'
        ];

  let confidence = 40;
  if (folderConnected) confidence += 20;
  if (commands && commands.length > 0) confidence += 15;
  if (files.length > 0) confidence += 10;
  if (commandsToRun.length > 0) confidence += 5;

  return {
    criteria,
    tests,
    confidence: Math.min(confidence, 85),
    warnings
  };
}
