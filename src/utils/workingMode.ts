import { AutonomyLevel, InterfaceMode, ProjectState, TechnicalLevel } from '../types';

/**
 * The working mode has two independent parts, and this module is the only place that decides how
 * they are derived, so no screen can disagree with another:
 *
 *   • interface — which screens the project gets: the four-step helper, or the whole workspace.
 *   • autonomy  — how much the agent does by itself and how much the user has to read. This is the
 *                 part every AI request carries, and the only one that may change wording.
 *
 * A preset sets both at once (the wizard's four cards), and each part can then be changed on its own.
 * Neither part — and nothing else in the app — decides how good the code has to be: that list is the
 * same at every level and lives in the prompts themselves.
 */

/**
 * What each preset sets the two parts to.
 *
 * The interface a preset comes with is the plain one: choosing a preset is somebody saying how
 * technical they are, and the four-step helper is the answer for every level but the most technical
 * one. Handing a non-coder the whole workspace — ten sections and a compiler screen — on the strength
 * of a preset was the wrong default, and it put the screens in the way of the work instead of behind
 * it. The full workspace stays one click away, and a choice made there is remembered as the user's
 * own (see `interfaceModeChosen` on ProjectState).
 *
 * The autonomy half is untouched by this: it decides how much the agent explains, not which screens
 * exist, and every level keeps the one it always had.
 */
const PRESET_PARTS: Record<TechnicalLevel, { interface: InterfaceMode; autonomy: AutonomyLevel }> = {
  'Beginner / Non-coder': { interface: 'guided', autonomy: 'Beginner / Non-coder' },
  'Vibe-coder': { interface: 'guided', autonomy: 'Vibe-coder' },
  Intermediate: { interface: 'guided', autonomy: 'Intermediate' },
  Advanced: { interface: 'full', autonomy: 'Advanced' }
};

/** The autonomy levels in the order they are shown, from least to most independent. */
export const AUTONOMY_LEVELS: AutonomyLevel[] = [
  'Beginner / Non-coder',
  'Vibe-coder',
  'Intermediate',
  'Advanced'
];

export const INTERFACE_MODES: InterfaceMode[] = ['guided', 'full'];

/** Unknown or missing presets fall back to the plainest one, never to a silent technical default. */
export function presetParts(preset: TechnicalLevel | undefined | null) {
  return PRESET_PARTS[preset as TechnicalLevel] || PRESET_PARTS['Beginner / Non-coder'];
}

/**
 * The interface a project shows: the one its user picked, otherwise the one its preset comes with.
 *
 * A stored value counts only when somebody actually picked it. Presets write their own interface into
 * a project (the wizard does, and so does changing the preset), and treating that as a choice is what
 * used to freeze every existing project into the interface its author never asked for — including
 * the ones saved before the preset's default changed.
 */
export function interfaceModeOf(project: ProjectState | null | undefined): InterfaceMode {
  if (project?.interfaceModeChosen === true) {
    const chosen = project?.interfaceMode;
    if (chosen === 'guided' || chosen === 'full') return chosen;
  }
  return presetParts(project?.technicalLevel).interface;
}

/** The autonomy a project runs at: its own choice if it has one, otherwise its preset's. */
export function autonomyOf(project: ProjectState | null | undefined): AutonomyLevel {
  const chosen = project?.autonomyLevel;
  if (chosen && AUTONOMY_LEVELS.includes(chosen)) return chosen;
  return presetParts(project?.technicalLevel).autonomy;
}

/** True when the project belongs on the four-step helper. */
export function isGuidedInterface(project: ProjectState | null | undefined): boolean {
  return interfaceModeOf(project) === 'guided';
}

export function withPreset(project: ProjectState, preset: TechnicalLevel): ProjectState {
  const parts = presetParts(preset);
  return {
    ...project,
    technicalLevel: preset,
    interfaceMode: parts.interface,
    // The preset decides the screens again: picking a preset is a fresh start for this part, and the
    // interface it names is the one that applies until the user picks another one themselves.
    interfaceModeChosen: false,
    autonomyLevel: parts.autonomy
  };
}

export function withInterfaceMode(project: ProjectState, mode: InterfaceMode): ProjectState {
  return { ...project, interfaceMode: mode, interfaceModeChosen: true };
}

export function withAutonomy(project: ProjectState, level: AutonomyLevel): ProjectState {
  return { ...project, autonomyLevel: level };
}
