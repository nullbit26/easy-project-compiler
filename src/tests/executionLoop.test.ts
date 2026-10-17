import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractFilesFromAgentOutput } from '../utils/fileExtractor';
import { buildContinuationPromptText } from '../../server/utils/promptTexts';
import { ProjectState, ProjectTask } from '../types';

describe('AI Agent Execution Loop (Compiler -> Code -> Review -> Continuation -> Next Task)', () => {
  const mockInitialTask: ProjectTask = {
    id: 'task-1',
    phaseId: 'phase-1',
    title: 'Setup Player Movement Controller',
    goal: 'Create keyboard controller with arrow keys and boundary checking',
    status: 'ready',
    relevantFiles: ['src/components/PlayerController.tsx'],
    acceptanceCriteria: [
      { id: 'ac-1', description: 'Arrow key input event listeners attached', passed: false },
      { id: 'ac-2', description: 'Player moves smoothly with velocity', passed: false },
      { id: 'ac-3', description: 'Screen edge clamp prevents player leaving canvas', passed: false }
    ],
    testRequirements: ['Verify left/right boundaries'],
    estimatedComplexity: 'Small (1 prompt)',
    dependencies: [],
    progressPercent: 0,
    reviewHistory: []
  };

  const mockNextTask: ProjectTask = {
    id: 'task-2',
    phaseId: 'phase-1',
    title: 'Add Score and Coins Collection',
    goal: 'Spawn collectible items and update player score counter',
    status: 'ready',
    relevantFiles: ['src/components/ScoreBoard.tsx'],
    acceptanceCriteria: [
      { id: 'ac-4', description: 'Coin items render on screen', passed: false },
      { id: 'ac-5', description: 'Collision triggers score increase', passed: false }
    ],
    testRequirements: ['Unit test score increment'],
    estimatedComplexity: 'Small (1 prompt)',
    dependencies: ['task-1'],
    progressPercent: 0,
    reviewHistory: []
  };

  const mockProject: ProjectState = {
    id: 'proj-123',
    name: 'Platformer Arcade',
    projectType: 'React',
    engineOrFramework: 'React 19 + Canvas',
    language: 'TypeScript',
    selectedAgent: 'Cursor',
    technicalLevel: 'Intermediate',
    phases: [
      {
        id: 'phase-1',
        phaseNumber: 1,
        title: 'Core Mechanics',
        purpose: 'Player movement and basic collectibles',
        deliverable: 'Playable prototype',
        tasks: [mockInitialTask, mockNextTask]
      }
    ],
    projectMap: {
      projectName: 'Platformer Arcade',
      projectType: 'React',
      engineOrFramework: 'React 19 + Canvas',
      language: 'TypeScript',
      rulesFiles: ['.cursorrules'],
      files: [
        {
          path: 'src/App.tsx',
          type: 'code',
          content: 'export default function App() { return <div>App</div>; }'
        }
      ]
    },
    recentErrors: [],
    nextBestAction: 'Compile prompt for Task 1',
    rulesFilesContent: {
      agentsMd: '',
      claudeMd: '',
      cursorRules: ''
    }
  };

  it('1. Extracts code and target files accurately from agent chat response', () => {
    const agentChatResponse = `
I have created the PlayerController for you!

\`\`\`tsx
// File: src/components/PlayerController.tsx
import React, { useEffect, useState } from 'react';

export const PlayerController = () => {
  const [position, setPosition] = useState({ x: 100, y: 100 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPosition(p => ({ ...p, x: p.x + 5 }));
      if (e.key === 'ArrowLeft') setPosition(p => ({ ...p, x: p.x - 5 }));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return <div style={{ left: position.x, top: position.y }}>Player</div>;
};
\`\`\`
Notice: boundary clamping is not yet implemented.
`;

    const extracted = extractFilesFromAgentOutput(agentChatResponse);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].path).toBe('src/components/PlayerController.tsx');
    expect(extracted[0].content).toContain('PlayerController');
    expect(extracted[0].content).toContain('handleKeyDown');
  });

  it('2. synthesizes the targeted next-attempt continuation prompt the local engine really sends', () => {
    // The partial evaluation: the boundary clamp criterion is still missing. The prompt is not a
    // copy of the builder written out again here — it is the builder, so this test cannot pass while
    // the text the app sends has drifted.
    const continuationPrompt = buildContinuationPromptText({
      isRu: false,
      taskTitle: mockInitialTask.title,
      attemptNumber: 1,
      nextAttemptNumber: 2,
      progressPercent: 67,
      completed: ['Arrow key input event listeners attached', 'Player moves smoothly with velocity'],
      missing: ['Screen edge clamp prevents player leaving canvas'],
      skillLevel: 'Intermediate'
    });

    expect(continuationPrompt).toContain('CONTINUATION PROMPT (attempt 2 — to reach 100%)');
    expect(continuationPrompt).toContain('Screen edge clamp prevents player leaving canvas');
    expect(continuationPrompt).toContain('Do not delete or rewrite');
    // A pass of the loop is an attempt, never a "step" — the step is the screen (see the journey).
    expect(continuationPrompt).not.toContain('Step 1');
    expect(continuationPrompt).not.toContain('Step 2');
  });

  it('3. Advances to 100% and unlocks the next task in the plan for the next loop iteration', () => {
    const allTasks = mockProject.phases.flatMap(p => p.tasks);
    const currentIndex = allTasks.findIndex(t => t.id === mockInitialTask.id);
    expect(currentIndex).toBe(0);

    const nextTask = allTasks.slice(currentIndex + 1).find(t => t.status !== 'completed');
    expect(nextTask).toBeDefined();
    expect(nextTask?.id).toBe('task-2');
    expect(nextTask?.title).toBe('Add Score and Coins Collection');
  });
});
