export interface GoalRunCommandPayload {
  goal: string;
}

export interface ReasoningRunCommandPayload {
  prompt: string;
  max_tokens?: number;
}

export interface PipelineRunCommandPayload {
  pipeline_id?: number;
  pipeline_name?: string;
  question: string;
}

export interface CronCreateCommandPayload {
  job_id: string;
  schedule: string;
  execution_type: 'Goal' | 'ReasoningGraph' | 'Pipeline';
  enabled?: boolean;
  goal?: string;
  reasoning_prompt?: string;
  max_tokens?: number;
  pipeline_id?: number;
  pipeline_name?: string;
  input_json?: Record<string, any>;
  retry_policy?: {
    max_retries: number;
    backoff_strategy: 'Fixed' | 'Exponential';
    initial_delay_seconds: number;
  };
}

export interface TriggerCreateCommandPayload {
  trigger_id: string;
  event_type: string;
  action_kind: 'goal' | 'reasoning' | 'pipeline';
  goal?: string;
  reasoning_prompt?: string;
  max_tokens?: number;
  pipeline_id?: number;
  pipeline_name?: string;
  condition?:
    | { Equals: { path: string; value: unknown } }
    | { Contains: { path: string; value: unknown } }
    | { GreaterThan: { path: string; value: unknown } }
    | { LessThan: { path: string; value: unknown } }
    | null;
}

type AtomicTriggerCondition =
  | { Equals: { path: string; value: unknown } }
  | { Contains: { path: string; value: unknown } }
  | { GreaterThan: { path: string; value: unknown } }
  | { LessThan: { path: string; value: unknown } };

type ParseSuccess<T> = { ok: true; payload: T };
type ParseFailure = { ok: false; error: string };

function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === '\\' && index + 1 < input.length) {
        current += input[index + 1];
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parseKeyValueTokens(input: string) {
  const tokens = tokenizeArgs(input);
  const kv = new Map<string, string>();
  const positional: string[] = [];

  for (const token of tokens) {
    const separatorIndex = token.indexOf('=');
    if (separatorIndex <= 0) {
      positional.push(token);
      continue;
    }

    const key = token.slice(0, separatorIndex).trim().toLowerCase();
    const value = token.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      positional.push(token);
      continue;
    }
    kv.set(key, value);
  }

  return { kv, positional };
}

function parseOptionalInteger(value: string | undefined, field: string): ParseSuccess<number | undefined> | ParseFailure {
  if (value == null || value === '') {
    return { ok: true, payload: undefined };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, error: `\`${field}\` debe ser un entero positivo.` };
  }

  return { ok: true, payload: parsed };
}

function parseRequiredText(value: string | undefined, field: string, usage: string): ParseSuccess<string> | ParseFailure {
  const trimmed = value?.trim();
  if (!trimmed) {
    return { ok: false, error: usage || `Debes indicar \`${field}\`.` };
  }

  return { ok: true, payload: trimmed };
}

function parseJsonValue(value: string): ParseSuccess<any> | ParseFailure {
  try {
    return { ok: true, payload: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: `No se pudo interpretar JSON: ${String(error)}` };
  }
}

function parseScalarValue(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const numeric = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(numeric)) {
    return numeric;
  }
  return trimmed;
}

function parseOptionalBoolean(value: string | undefined, field: string): ParseSuccess<boolean | undefined> | ParseFailure {
  if (value == null || value === '') {
    return { ok: true, payload: undefined };
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
    return { ok: true, payload: true };
  }
  if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
    return { ok: true, payload: false };
  }

  return { ok: false, error: `\`${field}\` debe ser true/false.` };
}

export function parseGoalRunArgs(input: string): ParseSuccess<GoalRunCommandPayload> | ParseFailure {
  const goal = input.trim();
  if (!goal) {
    return {
      ok: false,
      error: 'Uso esperado: `/goal-run redacta un objetivo claro y ejecutable`',
    };
  }

  return { ok: true, payload: { goal } };
}

export function parseReasoningRunArgs(input: string): ParseSuccess<ReasoningRunCommandPayload> | ParseFailure {
  const { kv, positional } = parseKeyValueTokens(input);
  const prompt = kv.get('prompt') || positional.join(' ').trim();
  if (!prompt) {
    return {
      ok: false,
      error: 'Uso esperado: `/reasoning-run analiza este problema paso a paso` o `/reasoning-run prompt=\"...\" max_tokens=384`',
    };
  }

  const parsedMaxTokens = parseOptionalInteger(kv.get('max_tokens'), 'max_tokens');
  if (!parsedMaxTokens.ok) {
    return parsedMaxTokens;
  }

  return {
    ok: true,
    payload: {
      prompt,
      max_tokens: parsedMaxTokens.payload,
    },
  };
}

export function parsePipelineRunArgs(input: string): ParseSuccess<PipelineRunCommandPayload> | ParseFailure {
  const { kv, positional } = parseKeyValueTokens(input);
  const idValue = kv.get('id');
  const nameValue = kv.get('name');
  const question = kv.get('question') || positional.join(' ').trim();

  if (!idValue && !nameValue) {
    return {
      ok: false,
      error: 'Uso esperado: `/pipeline-run id=12 question=\"...\"` o `/pipeline-run name=\"My Pipeline\" question=\"...\"`',
    };
  }

  if (!question) {
    return {
      ok: false,
      error: 'Debes indicar una pregunta o input con `question=\"...\"` o texto posicional.',
    };
  }

  const parsedId = parseOptionalInteger(idValue, 'id');
  if (!parsedId.ok) {
    return parsedId;
  }

  return {
    ok: true,
    payload: {
      pipeline_id: parsedId.payload,
      pipeline_name: nameValue,
      question,
    },
  };
}

export function parseCronCreateArgs(input: string): ParseSuccess<CronCreateCommandPayload> | ParseFailure {
  const { kv } = parseKeyValueTokens(input);
  const jobId = parseRequiredText(
    kv.get('id'),
    'id',
    'Uso esperado: `/cron-create id=daily_job schedule="0 9 * * *" type=goal goal="..."`',
  );
  if (!jobId.ok) return jobId;

  const schedule = parseRequiredText(
    kv.get('schedule'),
    'schedule',
    'Debes indicar `schedule="..."` con una expresión cron válida.',
  );
  if (!schedule.ok) return schedule;

  const type = kv.get('type')?.trim().toLowerCase();
  if (!type || !['goal', 'reasoning', 'pipeline'].includes(type)) {
    return {
      ok: false,
      error: 'Debes indicar `type=goal`, `type=reasoning` o `type=pipeline`.',
    };
  }

  const maxTokens = parseOptionalInteger(kv.get('max_tokens'), 'max_tokens');
  if (!maxTokens.ok) return maxTokens;

  const enabled = parseOptionalBoolean(kv.get('enabled'), 'enabled');
  if (!enabled.ok) return enabled;

  const retries = parseOptionalInteger(kv.get('retries'), 'retries');
  if (!retries.ok) return retries;
  const delaySeconds = parseOptionalInteger(kv.get('delay_seconds'), 'delay_seconds');
  if (!delaySeconds.ok) return delaySeconds;

  const pipelineId = parseOptionalInteger(kv.get('pipeline_id') || kv.get('id_pipeline'), 'pipeline_id');
  if (!pipelineId.ok) return pipelineId;

  const backoffRaw = kv.get('backoff')?.trim().toLowerCase();
  if (backoffRaw && backoffRaw !== 'fixed' && backoffRaw !== 'exponential') {
    return {
      ok: false,
      error: 'Debes indicar `backoff=fixed` o `backoff=exponential`.',
    };
  }

  const retryPolicy = retries.payload
    ? {
        max_retries: retries.payload,
        backoff_strategy: backoffRaw === 'exponential' ? 'Exponential' as const : 'Fixed' as const,
        initial_delay_seconds: delaySeconds.payload ?? 60,
      }
    : undefined;

  if (type === 'goal') {
    const goal = parseRequiredText(kv.get('goal'), 'goal', 'Con `type=goal` debes indicar `goal="..."`.');
    if (!goal.ok) return goal;
    return {
      ok: true,
      payload: {
        job_id: jobId.payload,
        schedule: schedule.payload,
        execution_type: 'Goal',
        enabled: enabled.payload,
        goal: goal.payload,
        retry_policy: retryPolicy,
      },
    };
  }

  if (type === 'reasoning') {
    const prompt = parseRequiredText(kv.get('prompt'), 'prompt', 'Con `type=reasoning` debes indicar `prompt="..."`.');
    if (!prompt.ok) return prompt;
    return {
      ok: true,
      payload: {
        job_id: jobId.payload,
        schedule: schedule.payload,
        execution_type: 'ReasoningGraph',
        enabled: enabled.payload,
        reasoning_prompt: prompt.payload,
        max_tokens: maxTokens.payload,
        retry_policy: retryPolicy,
      },
    };
  }

  const pipelineName = kv.get('name');
  if (!pipelineId.payload && !pipelineName) {
    return {
      ok: false,
      error: 'Con `type=pipeline` debes indicar `pipeline_id=...` o `name="..."`.',
    };
  }

  let inputJson: Record<string, any> | undefined;
  if (kv.get('input_json')) {
    const parsedJson = parseJsonValue(kv.get('input_json')!);
    if (!parsedJson.ok) {
      return { ok: false, error: `\`input_json\` inválido. ${parsedJson.error}` };
    }
    if (!parsedJson.payload || Array.isArray(parsedJson.payload) || typeof parsedJson.payload !== 'object') {
      return { ok: false, error: '`input_json` debe ser un objeto JSON.' };
    }
    inputJson = parsedJson.payload;
  }

  return {
    ok: true,
    payload: {
      job_id: jobId.payload,
      schedule: schedule.payload,
      execution_type: 'Pipeline',
      enabled: enabled.payload,
      pipeline_id: pipelineId.payload,
      pipeline_name: pipelineName,
      input_json: inputJson,
      retry_policy: retryPolicy,
    },
  };
}

export function parseTriggerCreateArgs(input: string): ParseSuccess<TriggerCreateCommandPayload> | ParseFailure {
  const { kv } = parseKeyValueTokens(input);
  const triggerId = parseRequiredText(
    kv.get('id'),
    'id',
    'Uso esperado: `/trigger-create id=quantlab_alert event=quantlab.completed action=goal goal="..."`',
  );
  if (!triggerId.ok) return triggerId;

  const eventType = parseRequiredText(
    kv.get('event'),
    'event',
    'Debes indicar `event=...` con el tipo de evento que dispara el trigger.',
  );
  if (!eventType.ok) return eventType;

  const actionKind = kv.get('action')?.trim().toLowerCase();
  if (!actionKind || !['goal', 'reasoning', 'pipeline'].includes(actionKind)) {
    return {
      ok: false,
      error: 'Debes indicar `action=goal`, `action=reasoning` o `action=pipeline`.',
    };
  }

  const maxTokens = parseOptionalInteger(kv.get('max_tokens'), 'max_tokens');
  if (!maxTokens.ok) return maxTokens;

  const pipelineId = parseOptionalInteger(kv.get('pipeline_id') || kv.get('id_pipeline'), 'pipeline_id');
  if (!pipelineId.ok) return pipelineId;

  let condition: AtomicTriggerCondition | null | undefined;
  const conditionPath = kv.get('condition_path');
  const conditionOp = kv.get('condition_op')?.trim().toLowerCase();
  const conditionValueRaw = kv.get('condition_value');

  if (conditionPath || conditionOp || conditionValueRaw) {
    if (!conditionPath || !conditionOp || conditionValueRaw == null) {
      return {
        ok: false,
        error: 'Para condiciones debes indicar `condition_path`, `condition_op` y `condition_value`.',
      };
    }

    const value = parseScalarValue(conditionValueRaw);
    condition = (() => {
      switch (conditionOp) {
        case 'equals':
          return { Equals: { path: conditionPath, value } };
        case 'contains':
          return { Contains: { path: conditionPath, value } };
        case 'gt':
          return { GreaterThan: { path: conditionPath, value } };
        case 'lt':
          return { LessThan: { path: conditionPath, value } };
        default:
          return null;
      }
    })();

    if (!condition) {
      return {
        ok: false,
        error: 'Debes indicar `condition_op=equals`, `contains`, `gt` o `lt`.',
      };
    }
  }

  if (actionKind === 'goal') {
    const goal = parseRequiredText(kv.get('goal'), 'goal', 'Con `action=goal` debes indicar `goal="..."`.');
    if (!goal.ok) return goal;
    return {
      ok: true,
      payload: {
        trigger_id: triggerId.payload,
        event_type: eventType.payload,
        action_kind: 'goal',
        goal: goal.payload,
        condition,
      },
    };
  }

  if (actionKind === 'reasoning') {
    const prompt = parseRequiredText(kv.get('prompt'), 'prompt', 'Con `action=reasoning` debes indicar `prompt="..."`.');
    if (!prompt.ok) return prompt;
    return {
      ok: true,
      payload: {
        trigger_id: triggerId.payload,
        event_type: eventType.payload,
        action_kind: 'reasoning',
        reasoning_prompt: prompt.payload,
        max_tokens: maxTokens.payload,
        condition,
      },
    };
  }

  const pipelineName = kv.get('name');
  if (!pipelineId.payload && !pipelineName) {
    return {
      ok: false,
      error: 'Con `action=pipeline` debes indicar `pipeline_id=...` o `name="..."`.',
    };
  }

  return {
    ok: true,
    payload: {
      trigger_id: triggerId.payload,
      event_type: eventType.payload,
      action_kind: 'pipeline',
      pipeline_id: pipelineId.payload,
      pipeline_name: pipelineName,
      condition,
    },
  };
}
