/**
 * Workflow execution context: manages step outputs, conditional evaluation,
 * and parameter/output templating for advanced workflow features.
 */

import type { WorkflowStepDef } from './types.ts';
import type { Skill } from '../skills.ts';

/**
 * Execution context carried through a workflow run: step outputs, parameters,
 * and the state needed for conditional execution.
 */
export interface ExecutionContext {
  /** Captured outputs from previous steps (keyed by step id or output name). */
  outputs: Record<string, string>;
  /** Step execution results (status, exit codes for checks). */
  stepResults: Map<string, StepResult>;
  /** Global parameters passed to the workflow. */
  globalParams?: Record<string, unknown>;
}

export interface StepResult {
  stepId: string;
  status: 'done' | 'failed' | 'skipped';
  /** Exit code for check steps. */
  exitCode?: number;
  /** Captured output text (last agent turn or command stdout). */
  output?: string;
}

/**
 * Create a fresh execution context for a workflow run.
 */
export function createExecutionContext(globalParams?: Record<string, unknown>): ExecutionContext {
  return {
    outputs: {},
    stepResults: new Map(),
    globalParams,
  };
}

/**
 * Record a step's result in the execution context.
 */
export function recordStepResult(
  context: ExecutionContext,
  stepId: string,
  status: 'done' | 'failed' | 'skipped',
  exitCode?: number,
  output?: string,
): void {
  context.stepResults.set(stepId, { stepId, status, exitCode, output });
}

/**
 * Capture a step's output under a named key.
 */
export function captureOutput(context: ExecutionContext, name: string, value: string): void {
  context.outputs[name] = value;
}

/**
 * Evaluate a step's `if` condition against the execution context.
 * Supported conditions:
 *  - `previous.failed` — the immediately preceding step failed
 *  - `previous.done` — the immediately preceding step succeeded
 *  - `step.<id>.failed` — a specific step failed
 *  - `step.<id>.done` — a specific step succeeded
 *  - `always` — always execute (bypass condition)
 *
 * Returns true if the step should execute, false to skip.
 */
export function evaluateCondition(
  condition: string,
  context: ExecutionContext,
  currentIndex: number,
  steps: WorkflowStepDef[],
): boolean {
  const trimmed = condition.trim();

  // Always execute
  if (trimmed === 'always') return true;

  // Previous step conditions
  if (trimmed === 'previous.failed' || trimmed === 'previous.done') {
    if (currentIndex === 0) return false; // No previous step
    const previousStep = steps[currentIndex - 1];
    if (!previousStep) return false;
    const result = context.stepResults.get(previousStep.id);
    if (!result) return false;
    return trimmed === 'previous.failed' ? result.status === 'failed' : result.status === 'done';
  }

  // Specific step conditions: step.<id>.failed or step.<id>.done
  const stepMatch = /^step\.([^.]+)\.(failed|done)$/.exec(trimmed);
  if (stepMatch) {
    const [, stepId, status] = stepMatch;
    const result = context.stepResults.get(stepId as string);
    if (!result) return false;
    return status === 'failed' ? result.status === 'failed' : result.status === 'done';
  }

  // Unknown condition defaults to false (skip)
  return false;
}

/**
 * Apply templating to a prompt or skill body: replace `{{params.*}}` and
 * `{{outputs.*}}` tokens with values from the execution context.
 *
 * Supports:
 *  - `{{params.key}}` — step parameters
 *  - `{{outputs.name}}` — captured outputs from previous steps
 *  - `{{task}}` — the original task text (passed through unchanged)
 *
 * Unknown tokens are left as-is (no silent substitution with empty string).
 */
export function applyTemplating(
  text: string,
  context: ExecutionContext,
  stepParams?: Record<string, unknown>,
): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, token: string) => {
    const trimmed = token.trim();

    // Task token is preserved for later substitution by the engine
    if (trimmed === 'task') return match;

    // Step parameters
    if (trimmed.startsWith('params.')) {
      const key = trimmed.slice('params.'.length);
      const value = stepParams?.[key];
      return value !== undefined ? String(value) : match;
    }

    // Captured outputs
    if (trimmed.startsWith('outputs.')) {
      const key = trimmed.slice('outputs.'.length);
      const value = context.outputs[key];
      return value !== undefined ? value : match;
    }

    // Unknown token — leave as-is
    return match;
  });
}

/**
 * Compose a skill with its includes: merge the bodies of included skills
 * into the parent skill's body. Recursive, with cycle detection.
 *
 * Returns the composed body, or the original body if no includes or if
 * includes cannot be resolved.
 */
export function composeSkillWithIncludes(
  skill: Skill,
  allSkills: readonly Skill[],
  visited = new Set<string>(),
): string {
  // No includes — return as-is
  if (!skill.includes || skill.includes.length === 0) return skill.body;

  // Cycle detection
  if (visited.has(skill.name)) return skill.body;
  visited.add(skill.name);

  const skillMap = new Map(allSkills.map((s) => [s.name, s]));
  const parts: string[] = [];

  for (const includeName of skill.includes) {
    const included = skillMap.get(includeName);
    if (!included) {
      // Missing skill — leave a note
      parts.push(`<!-- Skill "${includeName}" not found -->`);
      continue;
    }
    // Recursively compose the included skill
    const composedBody = composeSkillWithIncludes(included, allSkills, new Set(visited));
    parts.push(`<!-- BEGIN: ${includeName} -->`);
    parts.push(composedBody);
    parts.push(`<!-- END: ${includeName} -->`);
  }

  // Parent body comes last (override behavior)
  if (skill.body.trim()) {
    parts.push(`<!-- BEGIN: ${skill.name} -->`);
    parts.push(skill.body);
    parts.push(`<!-- END: ${skill.name} -->`);
  }

  return parts.join('\n\n');
}

/**
 * Extract the last assistant turn's text from a completed agent step — this
 * becomes the output for `output:` capture.
 *
 * Called by the workflow engine after a step completes. Returns undefined if
 * no text can be extracted (the output field stays unset).
 */
export function extractStepOutput(turnText: string | undefined): string | undefined {
  if (!turnText || !turnText.trim()) return undefined;
  // Strip protocol markers (CEZ:DONE, CEZ:MONITORING, task refs) so they don't pollute outputs
  const cleaned = turnText
    .replace(/\s*CEZ:DONE\s*$/g, '')
    .replace(/\s*CEZ:MONITORING\s*$/g, '')
    .replace(/(?:^|\n)[ \t]*CEZ:(?:PR|ISSUE|TITLE)=[^\n]*/g, '')
    .trim();
  return cleaned || undefined;
}
