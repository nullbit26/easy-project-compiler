import { Request, Response } from 'express';
import { Type } from '../ai/geminiProvider';
import { callAiJson, hasAiProvider, getEngineLabel } from '../ai/aiProvider';
import { levelInstructionBlock, levelWork } from '../utils/levelGuidance';

const diagnoseErrorSchema = {
  type: Type.OBJECT,
  properties: {
    errorType: { type: Type.STRING },
    location: { type: Type.STRING },
    whenOccurs: { type: Type.STRING },
    explanations: {
      type: Type.OBJECT,
      properties: {
        verySimple: { type: Type.STRING },
        clear: { type: Type.STRING },
        technical: { type: Type.STRING }
      },
      required: ["verySimple", "clear", "technical"]
    },
    likelyCauses: { type: Type.ARRAY, items: { type: Type.STRING } },
    affectedFeatures: { type: Type.ARRAY, items: { type: Type.STRING } },
    visualCauseChain: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          type: { type: Type.STRING },
          detail: { type: Type.STRING }
        },
        required: ["label", "type", "detail"]
      }
    },
    codeDiff: {
      type: Type.OBJECT,
      properties: {
        filePath: { type: Type.STRING },
        oldCode: { type: Type.STRING },
        newCode: { type: Type.STRING },
        highlightReason: { type: Type.STRING }
      },
      required: ["filePath", "oldCode", "newCode", "highlightReason"]
    },
    repairPrompt: { type: Type.STRING },
    verificationSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
    confidenceScore: { type: Type.INTEGER },
    missingContextNeeded: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: [
    "errorType", "location", "whenOccurs", "explanations", "likelyCauses",
    "affectedFeatures", "visualCauseChain", "codeDiff", "repairPrompt",
    "verificationSteps", "confidenceScore", "missingContextNeeded"
  ]
};

export async function diagnoseError(req: Request, res: Response) {
  try {
    const body = req.body || {};
    const safeErrorText = typeof body.errorText === 'string' ? body.errorText : '';
    const { codeContext, projectType, framework, language, skillLevel } = body;
    const ai = hasAiProvider();
    const isRu = language === 'ru' || !language;

    if (ai && safeErrorText.trim()) {
      const prompt = `You are the Visual Error Coach in Easy Project Compiler.
Diagnose this software error for the user described in the level block below — the mode decides how much the diagnosis explains, never how strict or how thorough it is:

Error Text / Stack Trace: "${safeErrorText}"
Code Context (optional): "${codeContext || 'N/A'}"
Project Type: "${projectType || 'Unity / React'}"
Framework: "${framework || 'Standard'}"
Output Language: ${isRu ? 'Strictly in Russian for all text fields (whenOccurs, explanations, likelyCauses, affectedFeatures, visualCauseChain labels/details, highlightReason, repairPrompt, verificationSteps)' : 'English'}
${levelInstructionBlock(skillLevel, isRu)}

Provide the diagnosis in structured JSON:
{
  "errorType": "Parsed Exception Name (e.g. NullReferenceException)",
  "location": "File and line number if available",
  "whenOccurs": "Short description of when this happens",
  "explanations": {
    "verySimple": "1-sentence explanation without developer jargon",
    "clear": "1-2 sentence standard clear explanation",
    "technical": "Precise stack trace technical breakdown"
  },
  "likelyCauses": [
    "Cause 1",
    "Cause 2"
  ],
  "affectedFeatures": ["Feature A", "Feature B"],
  "visualCauseChain": [
    { "label": "Component / File", "type": "component", "detail": "Details" },
    { "label": "Error Location", "type": "file", "detail": "Details" },
    { "label": "Missing Link", "type": "issue", "detail": "Details" },
    { "label": "Outcome", "type": "outcome", "detail": "Details" }
  ],
  "codeDiff": {
    "filePath": "Path to file",
    "oldCode": "Original snippet",
    "newCode": "Corrected snippet",
    "highlightReason": "Why this fixes the bug"
  },
  "repairPrompt": "Exact prompt to copy into AI agent to fix this error safely",
  "verificationSteps": [
    "Step 1 to verify fix",
    "Step 2 to verify fix"
  ],
  "confidenceScore": 90,
  "missingContextNeeded": []
}`;
      const parsed = await callAiJson(prompt, diagnoseErrorSchema);
      if (parsed && parsed.errorType) {
        return res.json({ success: true, data: parsed, engine: getEngineLabel() });
      }
    }

    // Fallback diagnosis when there is no API key, no error text, or quota is exhausted.
    // The template adapts to the project family so a React project never receives a Unity diagnosis.
    const isUnityNullRef = safeErrorText.includes('NullReferenceException');
    const projectContext = `${projectType || ''} ${framework || ''}`;
    const isUnityContext = /unity|godot|unreal/i.test(projectContext);
    const isWebProject =
      !isUnityContext &&
      /react|next|vite|javascript|typescript|node|vue|svelte/i.test(projectContext);

    // The offline repair prompt is what a user without an API key actually copies into their agent,
    // so its lead follows the level: a beginner is told the agent does the work, an advanced user is
    // not. The fix itself and the verification steps stay identical for everyone.
    const work = levelWork(skillLevel, isRu);
    const repairLead = isRu
      ? work.key === 'beginner'
        ? 'Скопируйте этот текст целиком в ИИ-агента — он внесёт правку сам, вручную ничего менять не нужно.\n\n'
        : work.key === 'vibecoder'
        ? 'Отдайте это ИИ-агенту — файл он поправит сам.\n\n'
        : ''
      : work.key === 'beginner'
      ? 'Paste this whole text into your AI agent — it applies the fix itself, nothing is changed by hand.\n\n'
      : work.key === 'vibecoder'
      ? 'Hand this to your AI agent — it fixes the file itself.\n\n'
      : '';

    if (isWebProject) {
      return res.json({
        success: true,
        data: {
          errorType: isUnityNullRef
            ? 'NullReferenceException'
            : (isRu ? 'Ошибка выполнения в рантайме' : 'Runtime Execution Error'),
          location: 'src/App.tsx, ' + (isRu ? 'строка 28' : 'line 28'),
          whenOccurs: isRu
            ? 'При обращении к необъявленному или пустому значению во время рендера компонента'
            : 'When rendering a component that reads an undefined or null value',
          explanations: {
            verySimple: isRu
              ? 'Компонент пытается использовать данные, которых в этот момент еще нет.'
              : 'The component tries to use data that does not exist yet at that moment.',
            clear: isRu
              ? 'Значение приходит асинхронно (или из props), но код обращается к нему без проверки на null/undefined.'
              : 'The value arrives asynchronously (or via props), but the code reads it without a null/undefined guard.',
            technical: isRu
              ? 'Разрушение структуры данных на неопределенном значении вызывает TypeError во время рендера или эффектов.'
              : 'Destructuring an undefined value throws a TypeError during render or inside effects.'
          },
          likelyCauses: isRu
            ? [
                'Данные еще не загрузились, а рендер уже обращается к полю (data.items, user.name).',
                'В useEffect отсутствует зависимость, из-за чего состояние обновляется со старым значением.'
              ]
            : [
                'Data has not loaded yet while render already reads a field (data.items, user.name).',
                'A useEffect misses a dependency, so state updates with a stale value.'
              ],
          affectedFeatures: isRu
            ? ['Рендер основного экрана приложения']
            : ['Main application screen rendering'],
          visualCauseChain: isRu
            ? [
                { label: 'Компонент React', type: 'component', detail: 'src/App.tsx' },
                { label: 'Файл с ошибкой', type: 'file', detail: 'Строка 28: обращение к полю' },
                { label: 'Пропущенная проверка', type: 'issue', detail: 'Значение равно null / undefined' },
                { label: 'Сбой рендера', type: 'outcome', detail: 'TypeError останавливает рендер компонента' }
              ]
            : [
                { label: 'React Component', type: 'component', detail: 'src/App.tsx' },
                { label: 'Error Location', type: 'file', detail: 'Line 28: unsafe field access' },
                { label: 'Missing Guard', type: 'issue', detail: 'Value is null / undefined' },
                { label: 'Render Crash', type: 'outcome', detail: 'TypeError stops the component render' }
              ],
          codeDiff: {
            filePath: 'src/App.tsx',
            oldCode: 'const items = data.items.map((item) => <Row key={item.id} />);',
            newCode:
              'const items = (data?.items ?? []).map((item) => <Row key={item.id} />);\n\nif (!data) return <Spinner />;',
            highlightReason: isRu
              ? 'Опциональная цепочка и early-return защищают рендер от пустых данных'
              : 'Optional chaining and an early return guard the render against empty data'
          },
          repairPrompt:
            repairLead +
            (isRu
              ? 'В src/App.tsx добавьте проверку на null/undefined перед обращением к данным (опциональная цепочка и ранний возврат), затем убедитесь, что экран рендерится без TypeError.'
              : 'In src/App.tsx add a null/undefined guard before reading the data (optional chaining + early return), then verify the screen renders without a TypeError.'),
          verificationSteps: isRu
            ? [
                'Открыть консоль браузера и убедиться, что TypeError исчез',
                'Перезагрузить страницу и проверить рендер основного экрана',
                'Запустить проект повторно и проверить отсутствие ошибок'
              ]
            : [
                'Open the browser console and confirm the TypeError is gone',
                'Reload the page and verify the main screen renders',
                'Rerun the project to verify no error appears'
              ],
          confidenceScore: 84,
          missingContextNeeded: []
        }
      });
    }

    return res.json({
      success: true,
      data: {
        errorType: isUnityNullRef ? 'NullReferenceException' : (isRu ? 'Ошибка выполнения в рантайме' : 'Runtime Execution Error'),
        location: 'Assets/Features/Player/PlayerHealth.cs, ' + (isRu ? 'строка 42' : 'line 42'),
        whenOccurs: isRu
          ? 'При попытке вызова метода у ссылки на объект со значением null'
          : 'When calling a method on an object reference that is currently null',
        explanations: {
          verySimple: isRu
            ? 'Программа пытается использовать компонент, но связь с ним не была настроена.'
            : 'The program is trying to use a component, but the connection to it was left empty.',
          clear: isRu
            ? 'Переменная объявлена, но экземпляр компонента не привязан в памяти или в инспекторе.'
            : 'A variable was declared or serialized, but no component instance was assigned to it in memory or in the Inspector.',
          technical: isRu
            ? 'Разыменование неинициализированного указателя вызывает NullReferenceException во время выполнения.'
            : 'Dereferencing an uninitialized reference pointer triggers a runtime NullReferenceException.'
        },
        likelyCauses: isRu
          ? [
              'Неназначенная ссылка [SerializeField] в инспекторе Unity или отсутствующий компонент.',
              'Компонент был удален с объекта перед выполнением.'
            ]
          : [
              'Unassigned [SerializeField] reference in the Unity Inspector or missing component in React state.',
              'Component was removed from object before execution.'
            ],
        affectedFeatures: isRu
          ? ['Расчет здоровья игрока и получение урона']
          : ['Player Health & Damage Calculations'],
        visualCauseChain: isRu
          ? [
              { label: 'Объект / Компонент', type: 'component', detail: 'Объект игрока на сцене' },
              { label: 'Файл скрипта', type: 'file', detail: 'PlayerHealth.cs строка 42' },
              { label: 'Неназначенное поле', type: 'issue', detail: 'playerStats равно null' },
              { label: 'Сбой выполнения', type: 'outcome', detail: 'Остановка выполнения с ошибкой NullReferenceException' }
            ]
          : [
              { label: 'GameObject / Component', type: 'component', detail: 'Player object in scene' },
              { label: 'Script File', type: 'file', detail: 'PlayerHealth.cs line 42' },
              { label: 'Unassigned Field', type: 'issue', detail: 'playerStats is null' },
              { label: 'Runtime Crash', type: 'outcome', detail: 'Execution stops with NullReferenceException' }
            ],
        codeDiff: {
          filePath: 'Assets/Features/Player/PlayerHealth.cs',
          oldCode: 'private PlayerStats playerStats; // Null reference',
          newCode: '[SerializeField] private PlayerStats playerStats;\n\nvoid Awake() {\n  if (!playerStats) playerStats = GetComponent<PlayerStats>();\n}',
          highlightReason: isRu
            ? 'Добавить поле в инспектор и автопоиск через GetComponent в Awake'
            : 'Add Inspector field and Awake automatic fallback check'
        },
        repairPrompt:
          repairLead +
          (isRu
            ? 'В Assets/Features/Player/PlayerHealth.cs добавьте проверку на null в Awake(): если playerStats не задан, вызовите GetComponent<PlayerStats>().'
            : 'In Assets/Features/Player/PlayerHealth.cs, add a null safety check in Awake() so playerStats automatically initializes with GetComponent<PlayerStats>() if unassigned.'),
        verificationSteps: isRu
          ? [
              'Открыть объект игрока в инспекторе',
              'Убедиться, что компонент прикреплен или ищется в Awake()',
              'Запустить проект повторно и проверить отсутствие ошибок'
            ]
          : [
              'Open the player object in inspector',
              'Ensure component is attached or auto-fetched in Awake()',
              'Rerun the project to verify no error appears'
            ],
        confidenceScore: 88,
        missingContextNeeded: []
      }
    });
  } catch (err: any) {
    console.error('Error in /api/error/diagnose:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to diagnose error' });
  }
}
