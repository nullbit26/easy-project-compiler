import { Request, Response } from 'express';
import { levelInstructionBlock } from '../utils/levelGuidance';
import { buildOfflineFirstSteps, offlinePlanVoice } from '../utils/offlineFirstSteps';
import { Type } from '../ai/geminiProvider';
import { callAiJson, hasAiProvider, getEngineLabel } from '../ai/aiProvider';
import { sendSuccess, sendError } from '../utils/apiResponse';
import {
  analyzeIdeaLocally,
  isRussianText,
  normalizePattern,
  normalizePlatform,
  normalizeStack,
  validateIdeaLocally
} from '../utils/ideaAnalyzer';
import { getWorkspaceRoot } from '../store/workspaceStore';
import { inferFileType, readWorkspaceTextFile, scanWorkspace } from '../services/workspaceFiles';
import {
  alignPlanFilesToWorkspace,
  buildLocalImportProject,
  buildWorkspaceDigest,
  clipFileContent,
  pickKeyFiles,
  planHasTasks,
  type DigestFileEntry,
  type DigestKeyFile
} from '../utils/workspaceDigest';
import {
  buildLocalInsights,
  buildWorkspaceFacts,
  pickFactCandidates,
  statusLabel,
  type FactSourceFile
} from '../utils/workspaceCode';
import type { FileImplementation, WorkspaceFacts } from '../../src/types';

/** How many source files are read for the project map, and how much of each one. */
const MAX_FACT_FILES = 60;
const FACT_READ_CHARS = 12_000;
const MAX_FACT_FILE_BYTES = 120_000;

/** Files sent to the AI when the user asks what is already implemented. */
const MAX_INSIGHT_FILES = 12;
const INSIGHT_FILE_CHARS = 2_500;

/**
 * Reads the head of a bounded set of source files, so the project map can say what a file already
 * contains instead of only how big it is. Files that cannot be read stay in the list without
 * content — that is how the map stays honest about what was and was not analysed.
 */
function readFactSources(files: DigestFileEntry[], limit = MAX_FACT_FILES): FactSourceFile[] {
  const candidates = new Set(pickFactCandidates(files, { maxFiles: limit, maxBytes: MAX_FACT_FILE_BYTES }));
  const contents = new Map<string, string>();

  files
    .filter((file) => candidates.has(file.path))
    .forEach((file) => {
      try {
        contents.set(file.path, readWorkspaceTextFile(file.path, FACT_READ_CHARS).content);
      } catch {
        /* Unreadable files simply carry no facts. */
      }
    });

  return files.map((file) => ({
    path: file.path,
    type: file.type,
    sizeBytes: file.sizeBytes,
    content: contents.get(file.path)
  }));
}

const IMPLEMENTATION_STATUSES: FileImplementation[] = ['implemented', 'partial', 'stub', 'empty'];

/** Paths arrive with either kind of slash and in either case, so they are compared canonically. */
function pathKeyOf(value: unknown): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

function normalizeStatus(value: unknown): FileImplementation | undefined {
  const status = String(value || '').trim().toLowerCase() as FileImplementation;
  return IMPLEMENTATION_STATUSES.includes(status) ? status : undefined;
}

const describeImplementedSchema = {
  type: Type.OBJECT,
  properties: {
    overall: { type: Type.STRING },
    files: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING },
          status: { type: Type.STRING },
          implemented: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['path', 'status', 'implemented']
      }
    },
    nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['overall', 'files', 'nextSteps']
};

const generateQuestionsSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      description: "List of 3-4 highly relevant, unique, project-specific questions to clarify architectural/gameplay choices.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          topic: { type: Type.STRING },
          questionText: { type: Type.STRING },
          placeholder: { type: Type.STRING },
          defaultSuggestion: { type: Type.STRING }
        },
        required: ["id", "topic", "questionText", "placeholder", "defaultSuggestion"]
      }
    },
    tradeOffs: {
      type: Type.ARRAY,
      description: "2-3 key architectural trade-offs tailored to this specific project.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          optionA: { type: Type.STRING },
          optionB: { type: Type.STRING },
          recommendation: { type: Type.STRING }
        },
        required: ["id", "title", "optionA", "optionB", "recommendation"]
      }
    }
  },
  required: ["questions"]
};

const createIdeaSchema = {
  type: Type.OBJECT,
  properties: {
    projectName: { type: Type.STRING },
    projectType: { type: Type.STRING },
    engineOrFramework: { type: Type.STRING },
    language: { type: Type.STRING },
    tagline: { type: Type.STRING },
    targetAudience: { type: Type.STRING },
    coreProblem: { type: Type.STRING },
    coreValue: { type: Type.STRING },
    mvpFeatures: { type: Type.ARRAY, items: { type: Type.STRING } },
    futureFeatures: { type: Type.ARRAY, items: { type: Type.STRING } },
    nonGoals: { type: Type.ARRAY, items: { type: Type.STRING } },
    technicalConstraints: { type: Type.ARRAY, items: { type: Type.STRING } },
    successCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
    clarifyingQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    architecture: {
      type: Type.OBJECT,
      properties: {
        technologyStack: { type: Type.ARRAY, items: { type: Type.STRING } },
        folderStructure: { type: Type.ARRAY, items: { type: Type.STRING } },
        coreEntities: { type: Type.ARRAY, items: { type: Type.STRING } },
        dataFlow: { type: Type.STRING },
        testingStrategy: { type: Type.STRING },
        deploymentPlan: { type: Type.STRING },
        securityRisks: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: [
        "technologyStack", "folderStructure", "coreEntities", "dataFlow", 
        "testingStrategy", "deploymentPlan", "securityRisks"
      ]
    },
    phases: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          phaseNumber: { type: Type.INTEGER },
          title: { type: Type.STRING },
          purpose: { type: Type.STRING },
          deliverable: { type: Type.STRING },
          tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                goal: { type: Type.STRING },
                relevantFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
                acceptanceCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
                testRequirements: { type: Type.ARRAY, items: { type: Type.STRING } },
                estimatedComplexity: { type: Type.STRING },
                dependencies: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: [
                "title", "goal", "relevantFiles", "acceptanceCriteria", 
                "testRequirements", "estimatedComplexity", "dependencies"
              ]
            }
          }
        },
        required: ["phaseNumber", "title", "purpose", "deliverable", "tasks"]
      }
    }
  },
  required: [
    "projectName", "projectType", "engineOrFramework", "language", "tagline",
    "targetAudience", "coreProblem", "coreValue", "mvpFeatures", "futureFeatures",
    "nonGoals", "technicalConstraints", "successCriteria", "clarifyingQuestions",
    "architecture", "phases"
  ]
};

const adaptPlanSchema = {
  type: Type.OBJECT,
  properties: {
    phases: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          phaseNumber: { type: Type.INTEGER },
          title: { type: Type.STRING },
          purpose: { type: Type.STRING },
          deliverable: { type: Type.STRING },
          tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                goal: { type: Type.STRING },
                relevantFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
                acceptanceCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
                testRequirements: { type: Type.ARRAY, items: { type: Type.STRING } },
                estimatedComplexity: { type: Type.STRING },
                dependencies: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: [
                "title", "goal", "relevantFiles", "acceptanceCriteria", 
                "testRequirements", "estimatedComplexity", "dependencies"
              ]
            }
          }
        },
        required: ["phaseNumber", "title", "purpose", "deliverable", "tasks"]
      }
    }
  },
  required: ["phases"]
};

const analyzeIdeaSchema = {
  type: Type.OBJECT,
  properties: {
    preferredStack: { type: Type.STRING },
    architecturalPattern: { type: Type.STRING },
    targetPlatform: { type: Type.STRING },
    explanation: { type: Type.STRING }
  },
  required: ["preferredStack", "architecturalPattern", "targetPlatform", "explanation"]
};

/**
 * AI Smart Auto-Select: analyzes a free-form idea and returns the recommended
 * stack, architectural pattern and target platform. Falls back to the local
 * deterministic analyzer whenever Gemini is unavailable or quota-limited.
 */
export async function analyzeIdea(req: Request, res: Response) {
  try {
    const body = req.body || {};
    const text = String(body.ideaText || '').trim();
    const title = String(body.title || '').trim();
    const isRu = isRussianText(text) || body.language === 'ru';

    // 1. Fail fast on descriptions that are too short for a meaningful analysis.
    const validation = validateIdeaLocally(text, isRu);
    if (validation) {
      return res.json({ success: true, data: validation, engine: 'local' });
    }

    const isGame = /игр|game|аркад|arcade|шутер|shooter|выживан|survival|симулятор|simulator/i.test(text);

    // 2. Try Gemini for a tailored recommendation.
    const ai = hasAiProvider();
    if (ai) {
      const prompt = `You are the AI Smart Auto-Select engine of Easy Project Compiler.
Analyze this project idea and pick the single most suitable engine/stack, architectural pattern, and target platform.

Project Name: "${title || 'Auto-detect'}"
Idea: "${text}"

Allowed values (return EXACTLY one of these strings per field):
- preferredStack: one of ["Phaser.js 3 (Canvas)", "Three.js / React Three Fiber", "PixiJS v8", "PlayCanvas", "Construct 3 / Defold", "Godot 4.3 (GDScript)", "Unity 6 (URP)", "Unreal Engine 5", "React 19 + Vite", "Next.js App Router", "Python FastAPI", "Flutter"]
- architecturalPattern: one of ["State Machine (FSM)", "Object Pooling & Event Bus", "Component-Driven Scene Tree", "Entity-Component-System (ECS)", "Unidirectional Data Flow", "MVC / Service-Oriented", "Clean Architecture & Repository", "Feature-Sliced Design (FSD)"]
- targetPlatform: one of ["PC / Desktop", "Web Application", "Mobile App", "Cross-Platform"]

Output Language: ${isRu ? 'Russian for the explanation field ONLY' : 'English for the explanation field ONLY'}.

Respond ONLY in valid JSON matching the schema:
{
  "preferredStack": "...",
  "architecturalPattern": "...",
  "targetPlatform": "...",
  "explanation": "2-3 sentences explaining why this stack and pattern fit this exact idea."
}`;

      const parsed = await callAiJson(prompt, analyzeIdeaSchema);
      if (parsed && parsed.preferredStack) {
        const local = analyzeIdeaLocally(text, isRu);
        return res.json({
          success: true,
          data: {
            preferredStack: normalizeStack(String(parsed.preferredStack), text),
            architecturalPattern: normalizePattern(String(parsed.architecturalPattern || ''), isGame),
            targetPlatform: normalizePlatform(String(parsed.targetPlatform || ''), isGame),
            explanation: typeof parsed.explanation === 'string' && parsed.explanation.trim()
              ? parsed.explanation.trim()
              : local.explanation
          },
          engine: getEngineLabel()
        });
      }
    }

    // 3. Deterministic local fallback (no API key / quota exceeded).
    return res.json({ success: true, data: analyzeIdeaLocally(text, isRu), engine: 'local' });
  } catch (err: any) {
    console.error('Error in /api/project/analyze-idea:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to analyze idea' });
  }
}

export async function generateQuestions(req: Request, res: Response) {
  try {
    const { idea, platform, stack, agent, skillLevel, architecturalPattern, reliabilityGuarantees, mvpDepth, language = 'ru' } = req.body;
    const ai = hasAiProvider();
    const isRu = language === 'ru' || /[а-яёА-ЯЁ]/.test(idea || '');

    if (ai) {
      const prompt = `You are Easy Project Compiler, an AI project architect.
Analyze this software/game idea and generate:
1. A few highly relevant, unique, project-specific questions to clarify important architectural or gameplay choices — how many, and how technical they are, follows the user level block below.
2. 2-3 key architectural trade-offs tailored to this project idea (e.g. Canvas 2D vs WebGL, FSM vs ECS, LocalStorage vs IndexedDB).

Idea: "${idea}"
Platform: "${platform || 'Auto-detect'}"
Stack/Engine: "${stack || 'Auto-detect'}"
User Skill Level: "${skillLevel || 'Beginner / Non-coder'}"
${levelInstructionBlock(skillLevel, isRu)}
Architectural Pattern: "${architecturalPattern || 'Clean Architecture'}"
MVP Depth: "${mvpDepth || 'Production MVP'}"
Output Language: ${isRu ? 'Russian' : 'English'}. All questions, topics, placeholders, and trade-offs MUST be written in ${isRu ? 'Russian' : 'English'}.

Respond ONLY in valid JSON matching schema:
{
  "questions": [
    {
      "id": "q1",
      "topic": "Core Mechanics / Control",
      "questionText": "Specific relevant question tailored to this exact project idea?",
      "placeholder": "Example answer...",
      "defaultSuggestion": "Recommended default choice"
    }
  ],
  "tradeOffs": [
    {
      "id": "t1",
      "title": "State Architecture",
      "optionA": "State Machine (FSM)",
      "optionB": "Component-Driven Events",
      "recommendation": "Option A for predictable state transitions"
    }
  ]
}`;
      const parsed = await callAiJson(prompt, generateQuestionsSchema);
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        return res.json({ success: true, data: parsed, engine: getEngineLabel() });
      }
    }

    // Offline fallback: the same two decisions the AI branch above describes, in the voice of the
    // chosen working mode. The mode decides how many questions are asked and how technical they are —
    // the same split levelInstructionBlock() hands to the model — so a project built without a key
    // follows the mode the user picked just as closely as one built with a key.
    const ideaStr = (idea || '').trim().toLowerCase();
    const isGame =
      ideaStr.includes('game') ||
      ideaStr.includes('phaser') ||
      ideaStr.includes('unity') ||
      ideaStr.includes('godot') ||
      ideaStr.includes('beer') ||
      ideaStr.includes('2d') ||
      ideaStr.includes('3d') ||
      ideaStr.includes('игра');

    const firstSteps = buildOfflineFirstSteps({ level: skillLevel, isRu, isGame });

    return res.json({ success: true, data: firstSteps, engine: 'local' });
  } catch (err: any) {
    console.error('Error in /api/project/generate-questions:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function createIdea(req: Request, res: Response) {
  try {
    const {
      idea,
      projectName,
      platform,
      stack,
      agent,
      skillLevel,
      architecturalPattern,
      reliabilityGuarantees,
      mvpDepth,
      userAnswers,
      tradeOffChoices,
      language = 'ru'
    } = req.body;
    const ai = hasAiProvider();
    const isRu = language === 'ru' || /[а-яёА-ЯЁ]/.test(idea || '');

    const answersText = userAnswers && typeof userAnswers === 'object'
      ? Object.entries(userAnswers).map(([k, v]) => `- Question (${k}): ${v}`).join('\n')
      : 'None provided';

    const tradeOffsText = tradeOffChoices && typeof tradeOffChoices === 'object'
      ? Object.entries(tradeOffChoices).map(([k, v]) => `- Trade-off (${k}): Chosen -> ${v}`).join('\n')
      : 'Default recommendations selected';

    const guaranteesText = Array.isArray(reliabilityGuarantees) && reliabilityGuarantees.length > 0
      ? reliabilityGuarantees.join(', ')
      : 'Strict Typing, Unit Testing';

    if (ai) {
      const prompt = `You are Easy Project Compiler, an AI project architect.
Create a structured software/game project plan tailored to these exact requirements:

Idea: "${idea}"
Project Name: "${projectName || 'Auto-generate'}"
Platform: "${platform || 'Auto-detect'}"
Stack/Engine: "${stack || 'Auto-detect'}"
Target AI Coding Agent: "${agent || 'DeepSeek / Web Chat'}"
User Technical Level: "${skillLevel || 'Beginner / Non-coder'}"
${levelInstructionBlock(skillLevel, isRu)}
Architectural Pattern: "${architecturalPattern || 'Clean Architecture'}"
Reliability Guarantees Mandated: "${guaranteesText}"
MVP Depth/Scope Level: "${mvpDepth || 'Production MVP'}"
Output Language: You MUST generate all text (projectName, tagline, targetAudience, coreProblem, coreValue, mvpFeatures, futureFeatures, nonGoals, technicalConstraints, successCriteria, clarifyingQuestions, phases titles, task titles, task goals, acceptance criteria, testRequirements) strictly in ${isRu ? 'Russian' : 'English'}!

User Clarifications / Answers to Project Questions:
${answersText}

User Architectural Trade-Off Decisions:
${tradeOffsText}

Scope instructions based on MVP Depth ("${mvpDepth || 'Production MVP'}"):
- "Fast Prototype": Generate 2 phases, 3-4 concise tasks total.
- "Production MVP": Generate 3 phases, 6-8 detailed tasks total with state handling and testing.
- "Scalable Enterprise": Generate 4-5 phases, 10-12 tasks total including CI/CD, unit tests, security guards, and docs.

Important: Name phases cleanly (e.g. "Setup & Foundation", "Core Mechanics", "Polish & Testing") without doubling the words "Phase 0" inside the title!

Respond in clean JSON with the following structure:
{
  "projectName": "Name of app/game",
  "projectType": "Unity | Phaser.js | Godot | Three.js | Unreal Engine | React | Next.js | Node.js | Python | Flutter | Generic",
  "engineOrFramework": "Detected engine or framework (e.g. Unity 6 URP, Phaser.js 3 Canvas, React 19 + Vite)",
  "language": "Primary language (e.g. C#, GDScript, TypeScript, Python)",
  "tagline": "One sentence summary",
  "targetAudience": "Target users",
  "coreProblem": "Problem solved",
  "coreValue": "Core value provided",
  "mvpFeatures": ["Feature 1", "Feature 2", "Feature 3"],
  "futureFeatures": ["Future 1", "Future 2"],
  "nonGoals": ["Non goal 1", "Non goal 2"],
  "technicalConstraints": ["Constraint 1", "Constraint 2"],
  "successCriteria": ["Criteria 1", "Criteria 2"],
  "clarifyingQuestions": ["Question 1?", "Question 2?"],
  "architecture": {
    "technologyStack": ["Tech 1", "Tech 2"],
    "folderStructure": ["Folder 1/", "Folder 2/"],
    "coreEntities": ["Entity 1", "Entity 2"],
    "dataFlow": "Short explanation of data flow",
    "testingStrategy": "Testing strategy",
    "deploymentPlan": "Deployment plan",
    "securityRisks": ["Risk 1"]
  },
  "phases": [
    {
      "phaseNumber": 0,
      "title": "Setup & Foundation",
      "purpose": "Set up project baseline",
      "deliverable": "Working skeleton",
      "tasks": [
        {
          "title": "Initialize project structure & state provider",
          "goal": "Create initial files and type definitions",
          "relevantFiles": ["src/App.tsx"],
          "acceptanceCriteria": ["App compiles cleanly", "State machine initializes"],
          "testRequirements": ["Build passes"],
          "estimatedComplexity": "Small (1 prompt)",
          "dependencies": []
        }
      ]
    },
    {
      "phaseNumber": 1,
      "title": "Core Mechanics & Features",
      "purpose": "Build interactive core functionality",
      "deliverable": "Playable/functional core MVP",
      "tasks": [
        {
          "title": "Build interactive core mechanics",
          "goal": "Implement primary user interaction flow",
          "relevantFiles": ["src/App.tsx"],
          "acceptanceCriteria": ["User actions trigger state changes", "Interactive controls handle inputs cleanly"],
          "testRequirements": ["Verify input handling"],
          "estimatedComplexity": "Medium (2 prompts)",
          "dependencies": ["0_0"]
        }
      ]
    },
    {
      "phaseNumber": 2,
      "title": "Verification & Polish",
      "purpose": "Final polish and error testing",
      "deliverable": "Production ready build",
      "tasks": [
        {
          "title": "UI polish and acceptance testing",
          "goal": "Zero console errors and smooth UI feedback",
          "relevantFiles": ["src/App.tsx"],
          "acceptanceCriteria": ["Zero console errors", "Full user flow tested"],
          "testRequirements": ["Full flow test"],
          "estimatedComplexity": "Small (1 prompt)",
          "dependencies": ["1_0"]
        }
      ]
    }
  ]
}`;
      const parsed = await callAiJson(prompt, createIdeaSchema);
      if (parsed && parsed.projectName) {
        return res.json({ success: true, data: parsed, engine: getEngineLabel() });
      }
    }

    // Smart Local Fallback if API Key missing or quota exceeded
    const ideaStr = (idea || '').trim();
    const ideaLower = ideaStr.toLowerCase();
    const stackLower = (stack || '').toLowerCase();

    const isPhaser = ideaLower.includes('phaser') || stackLower.includes('phaser');
    const isGodot = ideaLower.includes('godot') || ideaLower.includes('gdscript') || stackLower.includes('godot');
    const isThree = ideaLower.includes('three') || ideaLower.includes('webgl') || stackLower.includes('three');
    const isUnreal = ideaLower.includes('unreal') || ideaLower.includes('ue5') || stackLower.includes('unreal');
    const isUnity = ideaLower.includes('unity') || stackLower.includes('unity');
    const isGame = isPhaser || isGodot || isThree || isUnreal || isUnity || ideaLower.includes('game') || ideaLower.includes('beer') || ideaLower.includes('simulator') || ideaLower.includes('2d') || ideaLower.includes('3d');

    const customName = (projectName || '').trim();
    const projName = customName || (ideaStr.length > 32 ? ideaStr.slice(0, 32) + '...' : (ideaStr || 'New AI Project'));
    
    let projType = 'Web';
    let framework = stack || 'React 19 + Vite';
    let lang = 'TypeScript';
    let mainFiles = ['src/App.tsx'];
    let folders = ['src/components/', 'src/services/', 'src/types/'];

    if (isPhaser) {
      projType = 'Phaser.js';
      framework = stack || 'Phaser.js 3 (Canvas / WebGL)';
      lang = 'TypeScript';
      mainFiles = ['src/scenes/BootScene.ts', 'src/scenes/MainScene.ts', 'src/objects/Bottle.ts'];
      folders = ['src/scenes/', 'src/objects/', 'public/assets/'];
    } else if (isGodot) {
      projType = 'Godot';
      framework = stack || 'Godot 4.3 (GDScript)';
      lang = 'GDScript';
      mainFiles = ['scripts/player/Player.gd', 'scenes/player/Player.tscn'];
      folders = ['scenes/player/', 'scenes/levels/', 'scripts/player/'];
    } else if (isThree) {
      projType = 'Three.js';
      framework = stack || 'Three.js / React Three Fiber';
      lang = 'TypeScript';
      mainFiles = ['src/components/canvas/Scene.tsx', 'src/App.tsx'];
      folders = ['src/components/canvas/', 'src/hooks/', 'src/assets/'];
    } else if (isUnreal) {
      projType = 'Unreal Engine';
      framework = stack || 'Unreal Engine 5.4 (C++ / Blueprint)';
      lang = 'C++ / Blueprint';
      mainFiles = ['Source/MyProject/MyCharacter.cpp', 'Content/Blueprints/BP_Player.uasset'];
      folders = ['Source/MyProject/', 'Content/Blueprints/', 'Content/Levels/'];
    } else if (isUnity || isGame) {
      projType = 'Unity';
      framework = stack || 'Unity 6 (2D/URP)';
      lang = 'C#';
      mainFiles = ['Assets/Scripts/Core/GameManager.cs', 'Assets/Scenes/MainScene.unity'];
      folders = ['Assets/Scripts/Core/', 'Assets/Scripts/UI/', 'Assets/Prefabs/'];
    }

    // The level decides how the plan is worded, never what it demands: the phases, tasks, criteria and
    // technical test requirements below are identical for every level, and the plain voice only adds a
    // no-terminal way to check each task next to them.
    const planVoice = offlinePlanVoice(skillLevel, isRu);
    const withPlainChecks = (phases: any[]) =>
      planVoice.plain
        ? phases.map((phase) => ({
            ...phase,
            tasks: (phase.tasks || []).map((task: any) => ({
              ...task,
              testRequirements: [
                ...(task.testRequirements || []),
                planVoice.manualCheck(
                  (task.acceptanceCriteria || [])[0] || (isRu ? 'всё работает' : 'everything works')
                )
              ]
            }))
          }))
        : phases;

    return res.json({
      success: true,
      data: {
        projectName: projName,
        projectType: projType,
        engineOrFramework: framework,
        language: lang,
        tagline: isRu
          ? `План MVP проекта для: "${ideaStr}"`
          : `A tailored MVP project plan for: "${ideaStr}"`,
        targetAudience: isRu ? 'Пользователи, тестировщики или игроки' : 'Players, testers, or end-users',
        coreProblem: isRu
          ? `Декомпозиция архитектуры и задач для: ${ideaStr}`
          : `Automating architecture and prompt steps for: ${ideaStr}`,
        coreValue: isRu
          ? `Пошаговый план разработки, оптимизированный под ${agent || 'DeepSeek / Web Chat'} в ${projType}: ${planVoice.planNote}`
          : `Structured step-by-step tasks optimized for ${agent || 'Cursor'} in ${projType}: ${planVoice.planNote}`,
        mvpFeatures: isRu
          ? [
              `Базовая механика и стейт-машина для ${ideaStr.slice(0, 25)}`,
              'Интерактивное управление и визуальная обратная связь',
              'Локальный стейт-менеджер и сохранение настроек'
            ]
          : [
              `Core mechanics & state machine for ${ideaStr.slice(0, 25)}`,
              'Interactive user controls and responsive visual state feedback',
              'Local state provider / persistent settings'
            ],
        futureFeatures: isRu
          ? ['Звуковые эффекты и визуальные частицы', 'Таблица рекордов и аналитика']
          : ['Audio synthesis & visual particle polish', 'High score / analytics dashboard'],
        nonGoals: isRu
          ? ['Сложная серверная инфраструктура в V1', 'Лишние второстепенные вкладки']
          : ['Complex server infrastructure in V1', 'Unrequested secondary tabs or heavy backends'],
        technicalConstraints: isRu
          ? ['Модульные компоненты', 'Чистые переходы и отсутствие ошибок в консоли']
          : ['Keep components modular', 'Ensure clean state transitions and zero console errors'],
        successCriteria: isRu
          ? ['Основной сценарий компилируется без предупреждений', 'Приемочные критерии проверены']
          : ['Primary task completes with zero build warnings', 'Acceptance test criteria verified'],
        clarifyingQuestions: planVoice.clarifyingQuestions,
        architecture: {
          technologyStack: [framework, lang, 'HTML5 / Graphics Pipeline'],
          folderStructure: folders,
          coreEntities: ['GameState', 'UserAction', 'UIController'],
          dataFlow: 'User Input -> Event Handler -> State Machine -> View Render',
          testingStrategy: planVoice.testingStrategy,
          deploymentPlan: isRu ? 'Веб-билд / Исполняемый пакет' : 'Web Build / Executable Package',
          securityRisks: isRu ? ['Секретные ключи хранить в .env'] : ['Keep environment keys in .env']
        },
        phases: withPlainChecks(mvpDepth === 'Fast Prototype'
          ? [
              {
                phaseNumber: 0,
                title: isRu ? 'Этап 0 - Скелет прототипа' : 'Phase 0 - Rapid Prototype Skeleton',
                purpose: isRu ? 'Инициализация исполняемого холста и базового состояния' : 'Initialize minimal executable canvas and state bindings',
                deliverable: isRu ? 'Компилируемый прототип' : 'Compiling prototype skeleton',
                tasks: [
                  {
                    title: isRu ? `Инициализировать прототип ${projType}` : `Initialize ${projType} prototype skeleton`,
                    goal: isRu ? `Создать структуру файлов на ${lang}` : `Set up baseline ${lang} files`,
                    relevantFiles: mainFiles,
                    acceptanceCriteria: isRu
                      ? [`${framework} загружается без ошибок сборки`, 'Минимальное состояние инициализировано']
                      : [`${framework} loads with zero errors`, 'Minimal state initialized'],
                    testRequirements: [isRu ? 'Проверка типов и компиляции' : 'Type check / build pass'],
                    estimatedComplexity: 'Small (1 prompt)',
                    dependencies: []
                  }
                ]
              },
              {
                phaseNumber: 1,
                title: isRu ? `Этап 1 - Механика прототипа ${projName}` : `Phase 1 - Prototype Mechanics for ${projName}`,
                purpose: isRu ? 'Создание цикла интерактивного взаимодействия' : 'Build quick interactive gameplay or UI loop',
                deliverable: isRu ? 'Интерактивный прототип с элементами управления' : 'Interactive prototype with user controls',
                tasks: [
                  {
                    title: isRu ? 'Реализовать базовый цикл взаимодействия' : 'Implement core interaction loop',
                    goal: isRu ? 'Связать действия пользователя с визуальным откликом' : 'Connect primary inputs to immediate state feedback',
                    relevantFiles: mainFiles,
                    acceptanceCriteria: isRu
                      ? ['Действия пользователя вызывают отклик', 'Состояние корректно обновляется']
                      : ['User actions respond immediately', 'State updates cleanly'],
                    testRequirements: [isRu ? 'Проверка обработки пользовательского ввода' : 'Verify user input handling'],
                    estimatedComplexity: 'Small (1 prompt)',
                    dependencies: ['0_0']
                  }
                ]
              }
            ]
          : mvpDepth === 'Scalable Enterprise'
          ? [
              {
                phaseNumber: 0,
                title: isRu ? 'Этап 0 - Архитектура и контракты' : 'Phase 0 - Architecture & Contracts',
                purpose: isRu ? 'Модульная структура файлов, строгая типизация и интерфейсы' : 'Set up modular file structure, strict typing, and contract interfaces',
                deliverable: isRu ? 'Архитектурный фундамент' : 'Architectural foundation',
                tasks: [
                  {
                    title: isRu ? `Инициализировать модульные контракты ${projType}` : `Initialize ${projType} modular contracts`,
                    goal: isRu ? `Создать схемы типов и хранилища состояния` : `Create type schemas and state stores`,
                    relevantFiles: mainFiles,
                    acceptanceCriteria: isRu ? ['Строгая типизация настроена', 'Модульные хранилища экспортированы'] : ['Strict types enforced', 'Modular stores exported'],
                    testRequirements: [isRu ? 'Статическая проверка типов' : 'Static type checking'],
                    estimatedComplexity: 'Small (1 prompt)',
                    dependencies: []
                  }
                ]
              },
              {
                phaseNumber: 1,
                title: isRu ? 'Этап 1 - Доменная логика и сервисы' : 'Phase 1 - Enterprise Domain Logic',
                purpose: isRu ? 'Реализация сущностей и конвейера событий' : 'Implement core business entities and event pipeline',
                deliverable: isRu ? 'Доменная логика и стейт-машины' : 'Domain logic and state machines',
                tasks: [
                  {
                    title: isRu ? 'Создать изолированные доменные сервисы' : 'Build decoupled domain services',
                    goal: isRu ? 'Реализовать бизнес-логику с разделением ответственности' : 'Implement main business logic with single responsibility',
                    relevantFiles: mainFiles,
                    acceptanceCriteria: isRu ? ['Доменная логика изолирована', 'Отсутствует жесткая связанность'] : ['Domain logic isolated', 'Zero tight coupling'],
                    testRequirements: [isRu ? 'Модульные тесты сервисов' : 'Unit test domain services'],
                    estimatedComplexity: 'Medium (2 prompts)',
                    dependencies: ['0_0']
                  }
                ]
              },
              {
                phaseNumber: 2,
                title: isRu ? 'Этап 2 - Автоматизированные тесты и защита' : 'Phase 2 - Automated Testing & Security Guards',
                purpose: isRu ? 'Наборы интеграционных тестов и обработка исключений' : 'Implement integration test suites and error boundary guards',
                deliverable: isRu ? 'Устойчивый к сбоям код' : 'Hardened code with error handling',
                tasks: [
                  {
                    title: isRu ? 'Интеграционные тесты и барьеры ошибок' : 'Automated test suite and defensive guards',
                    goal: isRu ? 'Покрыть краевые сценарии и внедрить Error Boundary' : 'Verify edge cases and add error boundaries',
                    relevantFiles: mainFiles,
                    acceptanceCriteria: isRu ? ['Тесты успешно выполняются', 'Исключения перехватываются безопасно'] : ['Unit and integration tests pass', 'Error boundaries catch exceptions'],
                    testRequirements: [isRu ? 'Запуск автоматизированных тестов' : 'Run automated test suite'],
                    estimatedComplexity: 'Medium (2 prompts)',
                    dependencies: ['1_0']
                  }
                ]
              },
              {
                phaseNumber: 3,
                title: isRu ? 'Этап 3 - CI/CD и подготовка релиза' : 'Phase 3 - CI/CD & Production Build Polish',
                purpose: isRu ? 'Оптимизация бандла и финальный чек-лист' : 'Production bundle optimization and release checklist',
                deliverable: isRu ? 'Готовая релизная сборка' : 'Deployable enterprise build',
                tasks: [
                  {
                    title: isRu ? 'Верификация финальной сборки' : 'Production build verification',
                    goal: isRu ? 'Проверка отсутствия предупреждений и аудит бандла' : 'Ensure zero console warnings and complete user audit',
                    relevantFiles: mainFiles,
                    acceptanceCriteria: isRu ? ['Чистая сборка без предупреждений', 'Аудит бандла завершен'] : ['Clean production build', 'Audited bundle output'],
                    testRequirements: [isRu ? 'Проверка сборки и бандла' : 'Build & bundle check'],
                    estimatedComplexity: 'Small (1 prompt)',
                    dependencies: ['2_0']
                  }
                ]
              }
            ]
          : [
              {
                phaseNumber: 0,
                title: isRu ? 'Этап 0 - Базовая структура и стейт' : 'Phase 0 - Workspace & State Foundation',
                purpose: isRu ? 'Настройка структуры файлов, типов и базового состояния' : 'Set up file structure, types, and base state machine',
                deliverable: isRu ? 'Компилируемый каркас проекта' : 'Compiling project baseline',
                tasks: [
                  {
                    title: isRu ? `Инициализировать проект ${projType} и стейт` : `Initialize ${projType} project & state provider`,
                    goal: isRu ? `Создать скелет проекта с типами ${lang} и контекстом` : `Create project skeleton with ${lang} types and state context`,
                    relevantFiles: mainFiles,
                    acceptanceCriteria: isRu
                      ? [`Приложение ${framework} собирается без ошибок`, 'Стейт-машина предоставляет методы перехода']
                      : [`${framework} app loads with zero build warnings`, 'Context / State Machine provides currentState and step transition functions'],
                    testRequirements: [isRu ? 'Проверка типов и успешный билд' : 'Type check / build pass'],
                    estimatedComplexity: 'Small (1 prompt)',
                    dependencies: []
                  }
                ]
              },
              {
                phaseNumber: 1,
                title: isRu ? `Этап 1 - Реализация механики ${projName}` : `Phase 1 - Implement ${projName} Mechanics`,
                purpose: isRu ? 'Интерактивная логика и визуальная обратная связь' : 'Build interactive core mechanics and visual feedback loop',
                deliverable: isRu ? 'Рабочий интерактивный MVP' : 'Functional interactive MVP',
                tasks: [
                  {
                    title: isRu ? `Создать интерактивную механику для ${ideaStr.slice(0, 25)}` : `Build interactive core mechanics for ${ideaStr.slice(0, 25)}`,
                    goal: isRu ? 'Связать ввод пользователя с реакцией интерфейса' : 'Connect user inputs to visual animations and state transitions',
                    relevantFiles: mainFiles,
                    acceptanceCriteria: isRu
                      ? ['Действия пользователя вызывают визуальный отклик', 'Все элементы управления работают плавно']
                      : ['User actions trigger responsive animations and state changes', 'All interactive controls handle inputs cleanly'],
                    testRequirements: [isRu ? 'Проверка смены состояния от пользовательского ввода' : 'Verify user input state transitions'],
                    estimatedComplexity: 'Medium (2 prompts)',
                    dependencies: ['0_0']
                  }
                ]
              },
              {
                phaseNumber: 2,
                title: isRu ? 'Этап 2 - Верификация и полировка' : 'Phase 2 - Verification & Polish',
                purpose: isRu ? 'Полировка интерфейса, краевые случаи и релизный пакет' : 'Finalize UI polish, edge case checks, and deployment package',
                deliverable: isRu ? 'Готовый к использованию релизный MVP' : 'Production-ready MVP build',
                tasks: [
                  {
                    title: isRu ? 'Полировка интерфейса и приемочное тестирование' : 'UI polish and acceptance testing',
                    goal: isRu ? 'Убедиться в отсутствии ошибок в консоли' : 'Ensure all acceptance criteria are met without console errors',
                    relevantFiles: mainFiles,
                    acceptanceCriteria: isRu
                      ? ['Ноль ошибок и исключений в консоли', 'Полный сценарий пользователя протестирован']
                      : ['Zero console errors or unhandled exceptions', 'Full user flow complete'],
                    testRequirements: [isRu ? 'Запуск полного сценария пользователя' : 'Run complete user flow test'],
                    estimatedComplexity: 'Small (1 prompt)',
                    dependencies: ['1_0']
                  }
                ]
              }
            ])
      }
    });
  } catch (err: any) {
    console.error('Error in /api/project/create-idea:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to process idea' });
  }


}

/**
 * Importing an existing project: the app reads the connected folder (or a pasted file list),
 * sends what the files say about themselves to the AI, and returns the same plan shape as
 * `create-idea` — so the rest of the flow (brief, plan, prompts, step-by-step helper) works
 * exactly as it does for a project created from an idea.
 */
export async function importWorkspace(req: Request, res: Response) {
  try {
    const { paths, projectName, language = 'ru' } = req.body || {};
    const isRu = language === 'ru';
    const root = getWorkspaceRoot();

    let files: DigestFileEntry[] = [];
    let contents: DigestKeyFile[] = [];
    let facts: WorkspaceFacts | null = null;
    let source: 'folder' | 'paths' = 'folder';

    if (root) {
      const scan = scanWorkspace();
      files = scan.files.map((file) => ({
        path: file.path,
        type: file.type,
        sizeBytes: file.sizeBytes,
        isText: file.isText
      }));
      // Only the files that describe the project are read, and only as text.
      contents = pickKeyFiles(files)
        .filter((file) => file.isText !== false)
        .flatMap((file) => {
          try {
            const read = readWorkspaceTextFile(file.path, 20_000);
            return [{ path: read.path, content: clipFileContent(read.content) }];
          } catch {
            return [];
          }
        });
      // What the files themselves already contain: the project map is built from this, so an
      // imported project shows what is implemented instead of a list of names.
      facts = buildWorkspaceFacts(readFactSources(files));
    } else if (Array.isArray(paths) && paths.length > 0) {
      source = 'paths';
      files = paths
        .map((value: unknown) => String(value || '').trim().replace(/\\/g, '/'))
        .filter(Boolean)
        .slice(0, 500)
        .map((value: string) => ({ path: value, type: inferFileType(value) }));
    } else {
      return sendError(
        res,
        422,
        'No workspace to import',
        isRu
          ? 'Сначала подключите папку с проектом или вставьте список файлов.'
          : 'Connect the project folder or paste a file list first.'
      );
    }

    if (files.length === 0) {
      return sendError(
        res,
        422,
        'Nothing readable to import',
        isRu
          ? 'В папке не нашлось файлов, по которым можно понять проект.'
          : 'The folder has no file that says anything about the project.'
      );
    }

    const digest = buildWorkspaceDigest(files, contents);
    const folderName = root ? root.split(/[\\/]/).filter(Boolean).pop() : undefined;
    const understanding = {
      source,
      root: root || null,
      fileCount: files.length,
      keyFiles: contents.map((file) => file.path),
      evidence: digest.signals.evidence,
      projectType: digest.signals.projectType,
      engineOrFramework: digest.signals.engineOrFramework,
      language: digest.signals.language,
      facts: facts || undefined
    };

    if (hasAiProvider()) {
      const prompt = `You are Easy Project Compiler. The user is importing an EXISTING software project, not describing a new idea.
Below is the real file tree of the project folder, what the file names already tell about it, and the contents of its most informative files.

Step 1 — understand what this project is: what it does, its stack, its main modules.
Step 2 — return a plan to CONTINUE this project (never to start from scratch).

Strict rules:
- Everything must be based on the files below. If something is not visible there, do not invent it.
- projectName: use "${projectName || ''}" when it is not empty. Otherwise use the project's own name as the files state it (a README title or the name in the manifest); only if the files never name it, use the folder name "${folderName || ''}".
- projectType must be one of: Unity | Phaser.js | Godot | Three.js | Unreal Engine | React | Next.js | Node.js | Python | Flutter | Generic.
- engineOrFramework and language must match what the files actually show.
- relevantFiles of every task MUST be paths that appear in the file tree below.
- Phase 1 must be about reading the existing code and verifying that the project builds.
- Later phases must extend the existing modules rather than rewriting them.
- Return 2-4 phases, each with 1-3 concrete tasks, and never an empty phases array.
- All text (projectName, tagline, targetAudience, coreProblem, coreValue, mvpFeatures, futureFeatures, nonGoals, technicalConstraints, successCriteria, clarifyingQuestions, phase titles, task titles, goals, acceptance criteria, testRequirements) MUST be in ${isRu ? 'Russian' : 'English'}.

=== PROJECT FOLDER ===
${digest.text}
=== END OF PROJECT FOLDER ===

Respond in clean JSON with this structure:
{
  "projectName": "...",
  "projectType": "...",
  "engineOrFramework": "...",
  "language": "...",
  "tagline": "one sentence about what this project already is",
  "targetAudience": "...",
  "coreProblem": "...",
  "coreValue": "...",
  "mvpFeatures": ["what already exists or is worth having next"],
  "futureFeatures": ["..."],
  "nonGoals": ["..."],
  "technicalConstraints": ["..."],
  "successCriteria": ["..."],
  "clarifyingQuestions": ["..."],
  "architecture": {
    "technologyStack": ["..."],
    "folderStructure": ["real folders from the tree"],
    "coreEntities": ["real main files from the tree"],
    "dataFlow": "...",
    "testingStrategy": "...",
    "deploymentPlan": "...",
    "securityRisks": ["..."]
  },
  "phases": [
    {
      "phaseNumber": 0,
      "title": "Onboarding into the existing code",
      "purpose": "...",
      "deliverable": "...",
      "tasks": [
        {
          "title": "...",
          "goal": "...",
          "relevantFiles": ["real/path/from/the/tree"],
          "acceptanceCriteria": ["..."],
          "testRequirements": ["..."],
          "estimatedComplexity": "Small (1 prompt)",
          "dependencies": []
        }
      ]
    }
  ]
}`;

      const parsed = await callAiJson(prompt, createIdeaSchema);
      if (parsed && parsed.projectName) {
        // The model may name a file the folder does not have; every path is checked against the real tree.
        const aligned = alignPlanFilesToWorkspace(parsed, files);

        // It also happens that the model understands the project but returns no tasks at all.
        // Handing the user an empty plan would stall the flow, so the understanding is kept and
        // the step-by-step plan is taken from the real files instead.
        if (!planHasTasks(aligned)) {
          const localPlan = buildLocalImportProject({ signals: digest.signals, files, isRu, projectName, folderName });
          console.warn('Import returned no usable tasks — falling back to the plan built from the file tree.');
          return sendSuccess(res, {
            ...aligned,
            phases: localPlan.phases,
            architecture: aligned.architecture || localPlan.architecture,
            understanding,
            engine: getEngineLabel()
          });
        }

        return sendSuccess(res, { ...aligned, understanding, engine: getEngineLabel() });
      }
    }

    // No API key (or the model failed): the honest local understanding of the same real files.
    const localProject = buildLocalImportProject({
      signals: digest.signals,
      files,
      isRu,
      projectName,
      folderName
    });
    return sendSuccess(res, { ...localProject, understanding, engine: 'local' });
  } catch (err: any) {
    console.error('Error in /api/project/import-workspace:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * The second layer of the project map: the user asks what their project already implements. The AI
 * reads the same files the deterministic reading measured, and those measurements go into the
 * prompt, so the answer is about this project rather than about projects in general. With no key
 * (or an unusable answer) the measured facts answer on their own — the map never goes blank.
 */
export async function describeImplemented(req: Request, res: Response) {
  try {
    const { paths, projectName, language = 'ru' } = req.body || {};
    const isRu = language === 'ru';
    const root = getWorkspaceRoot();

    if (!root) {
      return sendError(
        res,
        422,
        'No workspace connected',
        isRu
          ? 'Сначала подключите папку с проектом — читать пока нечего.'
          : 'Connect the project folder first — there is nothing to read yet.'
      );
    }

    const scan = scanWorkspace();
    const allFiles: DigestFileEntry[] = scan.files.map((file) => ({
      path: file.path,
      type: file.type,
      sizeBytes: file.sizeBytes,
      isText: file.isText
    }));

    // Without a list the whole project is described; with one, only the files the screen asked about.
    const requested = Array.isArray(paths) ? paths.map(pathKeyOf).filter(Boolean) : null;
    const wanted = requested
      ? allFiles.filter((file) => requested.includes(pathKeyOf(file.path)))
      : allFiles;

    const sources = readFactSources(wanted.length > 0 ? wanted : allFiles, MAX_INSIGHT_FILES);
    const facts = buildWorkspaceFacts(sources);

    if (facts.analyzedFiles === 0) {
      return sendError(
        res,
        422,
        'Nothing readable to describe',
        isRu
          ? 'В папке не нашлось файлов с кодом, которые можно разобрать.'
          : 'The folder has no source files that can be read.'
      );
    }

    const localInsights = { ...buildLocalInsights(facts, isRu), engine: 'local' };
    if (!hasAiProvider()) {
      return sendSuccess(res, localInsights);
    }

    const reading = facts.files
      .map(
        (file) =>
          `- ${file.path} — ${statusLabel(file.status, isRu)}: ${file.codeLines} ${
            isRu ? 'строк кода' : 'lines of code'
          }; ${isRu ? 'объявления' : 'declarations'}: ${file.symbols.slice(0, 6).join(', ') || '—'}; ${
            isRu ? 'импорты' : 'imports'
          }: ${file.imports.slice(0, 4).join(', ') || '—'}`
      )
      .join('\n');

    const contentsBlock = sources
      .filter((file) => typeof file.content === 'string' && facts.files.some((fact) => fact.path === pathKeyOf(file.path)))
      .slice(0, MAX_INSIGHT_FILES)
      .map((file) => `--- ${file.path} ---\n${clipFileContent(file.content || '', INSIGHT_FILE_CHARS)}`)
      .join('\n\n');

    const prompt = `You are Easy Project Compiler. The user is working on an EXISTING project "${projectName || ''}" and wants to know what is ALREADY implemented inside its files, so they extend it instead of rewriting it.

Below is what a static reading of the real files found (status, lines of code, declared symbols, imports), followed by the contents of the most telling files.

Strict rules:
- Base every sentence on the files below. Never invent a file, class or feature that is not there.
- Name only files from the list below, exactly as written there.
- For each file you were given, list the concrete things that already exist in it (classes, functions, systems, data structures). An empty array is correct for a stub or an empty file.
- status must be one of: implemented | partial | stub | empty, judged from the code you actually see.
- overall: one or two sentences about how far this project already is.
- nextSteps: 2-4 concrete things to do next in THIS project, based on what is missing.
- All text MUST be in ${isRu ? 'Russian' : 'English'}.

=== STATIC READING OF THE FILES ===
${reading}
=== FILE CONTENTS ===
${contentsBlock}
=== END OF FILES ===

Respond in clean JSON with this structure:
{
  "overall": "...",
  "files": [
    { "path": "path/from/the/list", "status": "implemented", "implemented": ["what already exists in this file"] }
  ],
  "nextSteps": ["..."]
}`;

    const parsed = await callAiJson(prompt, describeImplementedSchema);
    const knownPaths = new Map(facts.files.map((file) => [pathKeyOf(file.path), file.path]));
    const files = (Array.isArray(parsed?.files) ? parsed.files : [])
      .map((entry: any) => {
        const realPath = knownPaths.get(pathKeyOf(entry?.path));
        if (!realPath) return null;
        const implemented = (Array.isArray(entry?.implemented) ? entry.implemented : [])
          .map((line: unknown) => String(line || '').trim())
          .filter(Boolean)
          .slice(0, 6);
        return { path: realPath, status: normalizeStatus(entry?.status), implemented };
      })
      .filter((entry: any): entry is { path: string; status: FileImplementation | undefined; implemented: string[] } => Boolean(entry));

    // A model answer that names no real file teaches the user nothing, so the measured facts win.
    if (files.length === 0) {
      console.warn('Describe-implemented returned no usable file — falling back to the static reading.');
      return sendSuccess(res, localInsights);
    }

    return sendSuccess(res, {
      generatedAt: new Date().toISOString(),
      engine: getEngineLabel(),
      overall: String(parsed?.overall || localInsights.overall).trim(),
      files,
      nextSteps: (Array.isArray(parsed?.nextSteps) ? parsed.nextSteps : localInsights.nextSteps)
        .map((step: unknown) => String(step || '').trim())
        .filter(Boolean)
        .slice(0, 6)
    });
  } catch (err: any) {
    console.error('Error in /api/project/describe-implemented:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function adaptPlan(req: Request, res: Response) {
  try {
    const { project, userGoal, targetPhaseId } = req.body;
    const ai = hasAiProvider();

    const projName = project?.name || 'Current Project';
    const projType = project?.projectType || 'Generic';
    const framework = project?.engineOrFramework || 'Standard';

    if (ai) {
      const prompt = `You are Easy Project Compiler, an AI project architect.
Re-analyze this software/game project and dynamically suggest updated/adapted tasks for the roadmap based on current user goals and progress.

Project Name: "${projName}"
Project Type: "${projType}" (${framework})
User Goal / Feedback / Desired Feature: "${userGoal || 'Suggest next logical MVP steps based on project brief'}"
Current Phases: ${JSON.stringify(
        (project?.phases || []).map((p: any) => ({
          phaseNumber: p.phaseNumber,
          title: p.title,
          tasksCount: p.tasks?.length || 0
        }))
      )}

Generate a clean updated set of phases and tasks. Keep titles clean (no doubling "Phase 1: Phase 1").

Respond ONLY in valid JSON:
{
  "phases": [
    {
      "phaseNumber": 0,
      "title": "Setup & Foundation",
      "purpose": "Purpose of setup",
      "deliverable": "Skeleton code",
      "tasks": [
        {
          "title": "Clean Task Title",
          "goal": "Detailed task goal",
          "relevantFiles": ["src/App.tsx"],
          "acceptanceCriteria": ["Criteria 1", "Criteria 2"],
          "testRequirements": ["Verification test"],
          "estimatedComplexity": "Small (1 prompt)",
          "dependencies": []
        }
      ]
    }
  ]
}`;
      const parsed = await callAiJson(prompt, adaptPlanSchema);
      if (parsed && Array.isArray(parsed.phases)) {
        return res.json({ success: true, data: parsed, engine: getEngineLabel() });
      }
    }

    // Fallback task adapter
    const goalStr = (userGoal || '').trim() || 'Next logical feature steps';
    const fallbackTasks = [
      {
        title: `Implement ${goalStr.slice(0, 30)} mechanics`,
        goal: `Build core logic and UI feedback for ${goalStr}`,
        relevantFiles: ['src/App.tsx'],
        acceptanceCriteria: [
          `Feature ${goalStr.slice(0, 20)} renders cleanly`,
          'State updates trigger responsive visual changes'
        ],
        testRequirements: ['Interactive UI test'],
        estimatedComplexity: 'Medium (2 prompts)',
        dependencies: []
      },
      {
        title: `Add state management & error handling for ${goalStr.slice(0, 20)}`,
        goal: 'Ensure state transitions and invalid actions are handled gracefully',
        relevantFiles: ['src/App.tsx'],
        acceptanceCriteria: ['Zero unhandled exceptions', 'State resets properly'],
        testRequirements: ['Boundary testing'],
        estimatedComplexity: 'Small (1 prompt)',
        dependencies: []
      }
    ];

    return res.json({
      success: true,
      data: {
        phases: (project?.phases || []).map((p: any, pIdx: number) => {
          if (pIdx === 1) {
            return {
              ...p,
              tasks: [...(p.tasks || []), ...fallbackTasks]
            };
          }
          return p;
        })
      },
      engine: 'local'
    });
  } catch (err: any) {
    console.error('Error in /api/project/adapt-plan:', err);
    res.status(500).json({ success: false, error: err.message });
  }


}
