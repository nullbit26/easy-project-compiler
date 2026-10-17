import { AgentType, ProjectType } from '../types';
import { claudePointerDocument, withCursorFrontmatter } from './rulesFiles';

export interface RulesGeneratorOptions {
  projectName: string;
  projectType: ProjectType;
  engineOrFramework: string;
  language: string;
  selectedAgent: AgentType;
  architecturalPattern?: string;
  reliabilityGuarantees?: string[];
  mvpDepth?: string;
  /** Language of the generated documents. Defaults to Russian. */
  uiLanguage?: 'ru' | 'en';
}

export function generateCustomRulesFiles(options: RulesGeneratorOptions): {
  agentsMd: string;
  claudeMd: string;
  cursorRules: string;
} {
  const {
    projectName,
    projectType,
    engineOrFramework,
    language,
    selectedAgent,
    architecturalPattern = 'Clean Modular Architecture',
    reliabilityGuarantees = ['Strict Typing', 'Automated Tests'],
    mvpDepth = 'Production MVP',
    uiLanguage = 'ru'
  } = options;

  const isRu = uiLanguage !== 'en';
  const isWebChat = selectedAgent === 'DeepSeek / Web Chat' || selectedAgent === 'ChatGPT / API';

  const guaranteeList = reliabilityGuarantees.length > 0
    ? reliabilityGuarantees
        .map(g => isRu
          ? `- **${g}**: Обязательно соблюдать во всем генерируемом коде.`
          : `- **${g}**: Must be respected in every piece of generated code.`)
        .join('\n')
    : (isRu ? '- Строгая структура и высокое качество кода' : '- Strict structure and high code quality');

  const webChatSpecific = isWebChat
    ? (isRu
      ? `\n## Специальные инструкции для DeepSeek и веб-чатов\n- Вы работаете в веб-интерфейсе чата без доступа к диску.\n- Всегда предоставляйте ПОЛНЫЙ готовый код целевого файла без сокращений вида "// остальной код без изменений".\n- Указывайте точный путь к файлу (например, Target File: src/App.tsx).\n- Приводите все необходимые импорты и типы.`
      : `\n## Special Instructions for DeepSeek and Web Chats\n- You work in a web chat UI with no access to the local disk.\n- Always provide the FULL ready-to-use code of the target file, without omissions such as "// rest of the code unchanged".\n- State the exact target file path (e.g. Target File: src/App.tsx).\n- Include all required imports and types.`)
    : '';

  const agentsMd = isRu
    ? `# AGENTS.md - Правила архитектуры и кодинга для ${projectName}

## О проекте
- **Название**: ${projectName}
- **Стек / Движок**: ${engineOrFramework} (${language})
- **Тип проекта**: ${projectType}
- **Целевой ИИ-агент**: ${selectedAgent}
- **Архитектурный паттерн**: ${architecturalPattern}
- **Глубина проработки**: ${mvpDepth}

## Архитектурные требования
1. **Строгое следование паттерну**: Соблюдать **${architecturalPattern}**. Не смешивать логику в монолитные файлы.
2. **Границы модулей**: Изолировать компоненты по принципу единой ответственности.
3. **Контроль контекста**: Перед добавлением зависимостей проверять существующие интерфейсы.

## Стандарты качества и надежности
${guaranteeList}

## Инструкции для агента
- Обеспечивать строгую типизацию \`${language}\`.
- Не удалять и не ломать существующие сигнатуры экспортов.
- Добавлять обработку ошибок вокруг вызовов API и смены состояний.
${webChatSpecific}
`
    : `# AGENTS.md - Architecture & Coding Rules for ${projectName}

## About the Project
- **Name**: ${projectName}
- **Stack / Engine**: ${engineOrFramework} (${language})
- **Project Type**: ${projectType}
- **Target AI Agent**: ${selectedAgent}
- **Architectural Pattern**: ${architecturalPattern}
- **Implementation Depth**: ${mvpDepth}

## Architecture Requirements
1. **Follow the pattern strictly**: Adhere to **${architecturalPattern}**. Do not mix logic into monolithic files.
2. **Module boundaries**: Keep components isolated with a single responsibility each.
3. **Context control**: Check existing interfaces before adding new dependencies.

## Quality & Reliability Standards
${guaranteeList}

## Agent Instructions
- Enforce strict \`${language}\` typing.
- Do not remove or break existing export signatures.
- Add error handling around API calls and state transitions.
${webChatSpecific}
`;

  // CLAUDE.md is deliberately not a second copy of the rules. Claude Code reads this file
  // *instead of* AGENTS.md when both exist, so two copies would drift apart and one of them would
  // silently stop applying. It points at AGENTS.md, which is the file the user edits.
  const claudeMd = claudePointerDocument(projectName, isRu);

  const cursorBody = isWebChat
    ? (isRu
      ? `# DEEPSEEK_PROMPT.md - Инструкция для веб-чата DeepSeek

# Проект: ${projectName}
# Стек: ${engineOrFramework} (${language})
# Архитектура: ${architecturalPattern}

[Системная директива для DeepSeek]
Вы являетесь ведущим инженером ${engineOrFramework}, разрабатывающим проект ${projectName}.

[Правила для веб-чата]
1. Так как вы работаете через веб-чат без доступа к локальной файловой системе, выводите ПОЛНЫЙ код каждого файла.
2. Никогда не используйте плейсхолдеры вроде "// здесь добавьте старый код".
3. Соблюдайте архитектурный паттерн ${architecturalPattern}.
4. Гарантии надежности:
${reliabilityGuarantees.map(g => `   - ${g}`).join('\n')}
5. Язык: ${language} в строгом режиме.
`
      : `# DEEPSEEK_PROMPT.md - Instruction for the DeepSeek Web Chat

# Project: ${projectName}
# Stack: ${engineOrFramework} (${language})
# Architecture: ${architecturalPattern}

[System Directive for DeepSeek]
You are the lead ${engineOrFramework} engineer building the project ${projectName}.

[Web Chat Rules]
1. Because you work through a web chat without access to the local filesystem, output the FULL code of every file.
2. Never use placeholders like "// add the previous code here".
3. Follow the ${architecturalPattern} architectural pattern.
4. Reliability guarantees:
${reliabilityGuarantees.map(g => `   - ${g}`).join('\n')}
5. Language: ${language} in strict mode.
`)
    : (isRu
      ? `# Правила для Cursor AI и ${selectedAgent}

# Файл: .cursor/rules/project.mdc
# Контекст проекта
# Название: ${projectName}
# Стек: ${engineOrFramework} (${language})
# Архитектура: ${architecturalPattern}

[Системная директива]
Вы являетесь экспертом по ${engineOrFramework}, создающим проект ${projectName}.

[Архитектурные правила]
1. Строго следовать паттерну ${architecturalPattern}.
2. Разделять интерфейс, логику и модели данных.
3. Соблюдать требования:
${reliabilityGuarantees.map(g => `   - ${g}`).join('\n')}

[Стиль кода]
- Язык: ${language}
- Режим: Строгая проверка типов.
- Проверять существующие интерфейсы перед объявлением новых типов.
`
      : `# Rules for Cursor AI and ${selectedAgent}

# File: .cursor/rules/project.mdc
# Project Context
# Name: ${projectName}
# Stack: ${engineOrFramework} (${language})
# Architecture: ${architecturalPattern}

[System Directive]
You are an expert in ${engineOrFramework} building the project ${projectName}.

[Architecture Rules]
1. Strictly follow the ${architecturalPattern} pattern.
2. Separate UI, logic, and data models.
3. Meet the requirements:
${reliabilityGuarantees.map(g => `   - ${g}`).join('\n')}

[Code Style]
- Language: ${language}
- Mode: Strict type checking.
- Check existing interfaces before declaring new types.
`);

  return {
    agentsMd,
    claudeMd,
    // The Cursor rule only works as `.mdc` with frontmatter, so the document carries it from here
    // on and the panel shows the file exactly as it will land on disk.
    cursorRules: withCursorFrontmatter(cursorBody, projectName)
  };
}
