import { describe, it, expect } from 'vitest';
import {
  createExecutionContext,
  recordStepResult,
  captureOutput,
  evaluateCondition,
  applyTemplating,
  composeSkillWithIncludes,
  extractStepOutput,
  type ExecutionContext,
} from './execution-context.ts';
import type { WorkflowStepDef } from './types.ts';
import type { Skill } from '../skills.ts';

describe('execution-context', () => {
  describe('createExecutionContext', () => {
    it('creates empty context', () => {
      const ctx = createExecutionContext();
      expect(ctx.outputs).toEqual({});
      expect(ctx.stepResults.size).toBe(0);
      expect(ctx.globalParams).toBeUndefined();
    });

    it('accepts global parameters', () => {
      const ctx = createExecutionContext({ foo: 'bar' });
      expect(ctx.globalParams).toEqual({ foo: 'bar' });
    });
  });

  describe('recordStepResult', () => {
    it('records step result', () => {
      const ctx = createExecutionContext();
      recordStepResult(ctx, 'step1', 'done');
      const result = ctx.stepResults.get('step1');
      expect(result).toEqual({ stepId: 'step1', status: 'done' });
    });

    it('records exit code and output', () => {
      const ctx = createExecutionContext();
      recordStepResult(ctx, 'check1', 'failed', 1, 'error output');
      const result = ctx.stepResults.get('check1');
      expect(result).toEqual({
        stepId: 'check1',
        status: 'failed',
        exitCode: 1,
        output: 'error output',
      });
    });
  });

  describe('captureOutput', () => {
    it('captures named output', () => {
      const ctx = createExecutionContext();
      captureOutput(ctx, 'issues', 'found 3 issues');
      expect(ctx.outputs.issues).toBe('found 3 issues');
    });
  });

  describe('evaluateCondition', () => {
    const steps: WorkflowStepDef[] = [
      { id: 'step1', prompt: 'first' },
      { id: 'step2', prompt: 'second' },
      { id: 'step3', prompt: 'third' },
    ];

    it('always returns true', () => {
      const ctx = createExecutionContext();
      expect(evaluateCondition('always', ctx, 0, steps)).toBe(true);
    });

    it('previous.done when previous succeeded', () => {
      const ctx = createExecutionContext();
      recordStepResult(ctx, 'step1', 'done');
      expect(evaluateCondition('previous.done', ctx, 1, steps)).toBe(true);
    });

    it('previous.failed when previous failed', () => {
      const ctx = createExecutionContext();
      recordStepResult(ctx, 'step1', 'failed');
      expect(evaluateCondition('previous.failed', ctx, 1, steps)).toBe(true);
    });

    it('previous.done returns false when previous failed', () => {
      const ctx = createExecutionContext();
      recordStepResult(ctx, 'step1', 'failed');
      expect(evaluateCondition('previous.done', ctx, 1, steps)).toBe(false);
    });

    it('previous.* returns false on first step', () => {
      const ctx = createExecutionContext();
      expect(evaluateCondition('previous.done', ctx, 0, steps)).toBe(false);
    });

    it('step.<id>.done when specific step succeeded', () => {
      const ctx = createExecutionContext();
      recordStepResult(ctx, 'step1', 'done');
      expect(evaluateCondition('step.step1.done', ctx, 2, steps)).toBe(true);
    });

    it('step.<id>.failed when specific step failed', () => {
      const ctx = createExecutionContext();
      recordStepResult(ctx, 'step1', 'failed');
      expect(evaluateCondition('step.step1.failed', ctx, 2, steps)).toBe(true);
    });

    it('returns false for unknown condition', () => {
      const ctx = createExecutionContext();
      expect(evaluateCondition('unknown.condition', ctx, 1, steps)).toBe(false);
    });
  });

  describe('applyTemplating', () => {
    it('preserves {{task}} token', () => {
      const ctx = createExecutionContext();
      const result = applyTemplating('Do {{task}}', ctx);
      expect(result).toBe('Do {{task}}');
    });

    it('substitutes params', () => {
      const ctx = createExecutionContext();
      const result = applyTemplating('Check {{params.severity}} issues', ctx, {
        severity: 'high',
      });
      expect(result).toBe('Check high issues');
    });

    it('substitutes outputs', () => {
      const ctx = createExecutionContext();
      captureOutput(ctx, 'issues', '3 bugs');
      const result = applyTemplating('Fix {{outputs.issues}}', ctx);
      expect(result).toBe('Fix 3 bugs');
    });

    it('leaves unknown tokens unchanged', () => {
      const ctx = createExecutionContext();
      const result = applyTemplating('Do {{unknown.thing}}', ctx);
      expect(result).toBe('Do {{unknown.thing}}');
    });

    it('handles multiple substitutions', () => {
      const ctx = createExecutionContext();
      captureOutput(ctx, 'count', '5');
      const result = applyTemplating('Found {{outputs.count}} issues with {{params.level}} severity', ctx, {
        level: 'critical',
      });
      expect(result).toBe('Found 5 issues with critical severity');
    });
  });

  describe('composeSkillWithIncludes', () => {
    it('returns body as-is when no includes', () => {
      const skill: Skill = {
        name: 'simple',
        body: 'Do the work',
        path: '/path/to/simple.md',
        source: 'cezar',
      };
      const result = composeSkillWithIncludes(skill, []);
      expect(result).toBe('Do the work');
    });

    it('composes with included skills', () => {
      const lint: Skill = {
        name: 'lint',
        body: 'Run linter',
        path: '/path/to/lint.md',
        source: 'cezar',
      };
      const test: Skill = {
        name: 'test',
        body: 'Run tests',
        path: '/path/to/test.md',
        source: 'cezar',
      };
      const review: Skill = {
        name: 'review',
        body: 'Review code',
        includes: ['lint', 'test'],
        path: '/path/to/review.md',
        source: 'cezar',
      };

      const result = composeSkillWithIncludes(review, [lint, test, review]);
      expect(result).toContain('<!-- BEGIN: lint -->');
      expect(result).toContain('Run linter');
      expect(result).toContain('<!-- BEGIN: test -->');
      expect(result).toContain('Run tests');
      expect(result).toContain('<!-- BEGIN: review -->');
      expect(result).toContain('Review code');
    });

    it('handles missing included skill', () => {
      const skill: Skill = {
        name: 'parent',
        body: 'Parent body',
        includes: ['missing'],
        path: '/path/to/parent.md',
        source: 'cezar',
      };
      const result = composeSkillWithIncludes(skill, [skill]);
      expect(result).toContain('<!-- Skill "missing" not found -->');
      expect(result).toContain('Parent body');
    });

    it('prevents infinite recursion with cycle', () => {
      const a: Skill = {
        name: 'a',
        body: 'A body',
        includes: ['b'],
        path: '/path/to/a.md',
        source: 'cezar',
      };
      const b: Skill = {
        name: 'b',
        body: 'B body',
        includes: ['a'],
        path: '/path/to/b.md',
        source: 'cezar',
      };
      // Should not throw — cycle detection stops recursion
      const result = composeSkillWithIncludes(a, [a, b]);
      expect(result).toContain('A body');
    });
  });

  describe('extractStepOutput', () => {
    it('returns undefined for empty text', () => {
      expect(extractStepOutput('')).toBeUndefined();
      expect(extractStepOutput('   ')).toBeUndefined();
      expect(extractStepOutput(undefined)).toBeUndefined();
    });

    it('strips CEZ:DONE marker', () => {
      const result = extractStepOutput('Task completed CEZ:DONE');
      expect(result).toBe('Task completed');
    });

    it('strips CEZ:MONITORING marker', () => {
      const result = extractStepOutput('Still working CEZ:MONITORING');
      expect(result).toBe('Still working');
    });

    it('strips task reference markers', () => {
      const result = extractStepOutput('Fixed issue\nCEZ:PR=123\nCEZ:ISSUE=456');
      expect(result).toBe('Fixed issue');
    });

    it('returns clean output', () => {
      const result = extractStepOutput('Found 3 security issues');
      expect(result).toBe('Found 3 security issues');
    });
  });
});
