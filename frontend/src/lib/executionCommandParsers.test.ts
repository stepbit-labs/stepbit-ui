import { describe, expect, it } from 'vitest';
import {
  parseCronCreateArgs,
  parseGoalRunArgs,
  parsePipelineRunArgs,
  parseReasoningRunArgs,
  parseTriggerCreateArgs,
} from './executionCommandParsers';

describe('executionCommandParsers', () => {
  it('parses goal-run as free text', () => {
    const parsed = parseGoalRunArgs('Monitoriza quantlab y resume desviaciones diarias');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        goal: 'Monitoriza quantlab y resume desviaciones diarias',
      },
    });
  });

  it('parses reasoning-run with positional prompt and optional max_tokens', () => {
    const parsed = parseReasoningRunArgs('Analiza el workspace quantlab max_tokens=384');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.prompt).toBe('Analiza el workspace quantlab');
    expect(parsed.payload.max_tokens).toBe(384);
  });

  it('parses reasoning-run with quoted prompt', () => {
    const parsed = parseReasoningRunArgs('prompt="Analiza los riesgos de esta estrategia" max_tokens=256');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        prompt: 'Analiza los riesgos de esta estrategia',
        max_tokens: 256,
      },
    });
  });

  it('parses pipeline-run by id', () => {
    const parsed = parsePipelineRunArgs('id=12 question="Compara el ultimo run con el anterior"');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        pipeline_id: 12,
        pipeline_name: undefined,
        question: 'Compara el ultimo run con el anterior',
      },
    });
  });

  it('parses pipeline-run by name with positional question', () => {
    const parsed = parsePipelineRunArgs('name="Daily Compare" compara ETH contra BTC');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        pipeline_id: undefined,
        pipeline_name: 'Daily Compare',
        question: 'compara ETH contra BTC',
      },
    });
  });

  it('rejects missing pipeline selector', () => {
    const parsed = parsePipelineRunArgs('question="hola"');
    expect(parsed.ok).toBe(false);
  });

  it('parses cron-create for goal jobs with retry policy', () => {
    const parsed = parseCronCreateArgs('id=daily_quant schedule="0 9 * * *" type=goal goal="Monitor quantlab" retries=3 backoff=exponential delay_seconds=120');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        job_id: 'daily_quant',
        schedule: '0 9 * * *',
        execution_type: 'Goal',
        enabled: undefined,
        goal: 'Monitor quantlab',
        retry_policy: {
          max_retries: 3,
          backoff_strategy: 'Exponential',
          initial_delay_seconds: 120,
        },
      },
    });
  });

  it('parses cron-create for reasoning jobs', () => {
    const parsed = parseCronCreateArgs('id=repo_reasoning schedule="0 10 * * *" type=reasoning prompt="Analiza el workspace" max_tokens=384');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        job_id: 'repo_reasoning',
        schedule: '0 10 * * *',
        execution_type: 'ReasoningGraph',
        enabled: undefined,
        reasoning_prompt: 'Analiza el workspace',
        max_tokens: 384,
        retry_policy: undefined,
      },
    });
  });

  it('parses cron-create for pipeline jobs with input json', () => {
    const parsed = parseCronCreateArgs(`id=daily_pipe schedule="0 11 * * *" type=pipeline name="Daily Compare" input_json='{"asset":"ETH"}'`);
    expect(parsed).toEqual({
      ok: true,
      payload: {
        job_id: 'daily_pipe',
        schedule: '0 11 * * *',
        execution_type: 'Pipeline',
        enabled: undefined,
        pipeline_id: undefined,
        pipeline_name: 'Daily Compare',
        input_json: { asset: 'ETH' },
        retry_policy: undefined,
      },
    });
  });

  it('rejects cron-create when pipeline selector is missing', () => {
    const parsed = parseCronCreateArgs('id=daily_pipe schedule="0 11 * * *" type=pipeline');
    expect(parsed.ok).toBe(false);
  });

  it('parses cron-create enabled flag explicitly', () => {
    const parsed = parseCronCreateArgs('id=manual_check schedule="0 9 * * *" type=goal enabled=true goal="Review the repo"');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        job_id: 'manual_check',
        schedule: '0 9 * * *',
        execution_type: 'Goal',
        enabled: true,
        goal: 'Review the repo',
        retry_policy: undefined,
      },
    });
  });

  it('parses trigger-create for goal action with condition', () => {
    const parsed = parseTriggerCreateArgs('id=quant_alert event=quantlab.completed action=goal goal="Resume el run" condition_path=summary.total_return condition_op=lt condition_value=-0.1');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        trigger_id: 'quant_alert',
        event_type: 'quantlab.completed',
        action_kind: 'goal',
        goal: 'Resume el run',
        condition: {
          LessThan: {
            path: 'summary.total_return',
            value: -0.1,
          },
        },
      },
    });
  });

  it('parses trigger-create for reasoning action', () => {
    const parsed = parseTriggerCreateArgs('id=workspace_drift event=workspace.index.completed action=reasoning prompt="Explica la deriva" max_tokens=256');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        trigger_id: 'workspace_drift',
        event_type: 'workspace.index.completed',
        action_kind: 'reasoning',
        reasoning_prompt: 'Explica la deriva',
        max_tokens: 256,
        condition: undefined,
      },
    });
  });

  it('parses trigger-create for pipeline action by id', () => {
    const parsed = parseTriggerCreateArgs('id=pipe_trigger event=quantlab.completed action=pipeline pipeline_id=7');
    expect(parsed).toEqual({
      ok: true,
      payload: {
        trigger_id: 'pipe_trigger',
        event_type: 'quantlab.completed',
        action_kind: 'pipeline',
        pipeline_id: 7,
        pipeline_name: undefined,
        condition: undefined,
      },
    });
  });

  it('rejects trigger-create when condition triple is incomplete', () => {
    const parsed = parseTriggerCreateArgs('id=bad event=quantlab.completed action=goal goal="x" condition_path=summary.total_return');
    expect(parsed.ok).toBe(false);
  });
});
