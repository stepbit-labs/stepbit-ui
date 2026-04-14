export type ComposerCommandId =
  | 'task'
  | 'workspace'
  | 'refs'
  | 'definition'
  | 'file'
  | 'quantlabRun'
  | 'goalRun'
  | 'reasoningRun'
  | 'pipelineRun'
  | 'cronCreate'
  | 'triggerCreate';

export interface ComposerCommand {
  id: ComposerCommandId;
  trigger: string;
  title: string;
  description: string;
  keywords: string[];
}

export interface ComposerCommandSuggestion extends ComposerCommand {
  prefix: string;
  remainder: string;
}

export interface ComposerContext {
  workspaceName?: string | null;
  currentFilePath?: string | null;
  currentSymbolName?: string | null;
  currentSymbolPath?: string | null;
}

export const COMPOSER_COMMANDS: ComposerCommand[] = [
  {
    id: 'task',
    trigger: '/task',
    title: 'Task template',
    description: 'Expand into a structured task prompt for implementation work and acceptance criteria.',
    keywords: ['task', 'todo', 'fix', 'implement'],
  },
  {
    id: 'workspace',
    trigger: '/workspace',
    title: 'Workspace prompt',
    description: 'Ask the model to inspect the active workspace, current files, and file tree.',
    keywords: ['workspace', 'repo', 'project'],
  },
  {
    id: 'refs',
    trigger: '/refs',
    title: 'Find references',
    description: 'Request references for the current symbol or the active file.',
    keywords: ['references', 'refs', 'search'],
  },
  {
    id: 'definition',
    trigger: '/definition',
    title: 'Go to definition',
    description: 'Ask for the definition of the current symbol or the active file target.',
    keywords: ['definition', 'def', 'jump'],
  },
  {
    id: 'file',
    trigger: '/file',
    title: 'Inspect file',
    description: 'Open and inspect the current file or a specific path from the workspace.',
    keywords: ['file', 'open', 'preview'],
  },
  {
    id: 'quantlabRun',
    trigger: '/quantlab-run',
    title: 'Run QuantLab',
    description: 'Execute quantlab_run directly and show structured results in the Results tab.',
    keywords: ['quantlab', 'ql', 'run', 'backtest', 'finance', 'web3'],
  },
  {
    id: 'goalRun',
    trigger: '/goal-run',
    title: 'Execute goal',
    description: 'Run a goal directly in stepbit-core and persist the execution in Runs.',
    keywords: ['goal', 'agent', 'automation', 'execute'],
  },
  {
    id: 'reasoningRun',
    trigger: '/reasoning-run',
    title: 'Execute reasoning',
    description: 'Run a reasoning graph derived from a prompt and inspect its steps in Runs.',
    keywords: ['reasoning', 'analyze', 'graph', 'inspect'],
  },
  {
    id: 'pipelineRun',
    trigger: '/pipeline-run',
    title: 'Execute pipeline',
    description: 'Run a saved pipeline by id or name and persist its execution and artifacts.',
    keywords: ['pipeline', 'workflow', 'run', 'execute'],
  },
  {
    id: 'cronCreate',
    trigger: '/cron-create',
    title: 'Create cron job',
    description: 'Create a scheduled goal, reasoning graph, or pipeline job and inspect it in Automations.',
    keywords: ['cron', 'schedule', 'job', 'automation'],
  },
  {
    id: 'triggerCreate',
    trigger: '/trigger-create',
    title: 'Create trigger',
    description: 'Create an event-driven automation that dispatches a goal, reasoning graph, or pipeline.',
    keywords: ['trigger', 'event', 'automation', 'workflow'],
  },
];

export function parseComposerCommand(input: string): ComposerCommandSuggestion | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/') && !trimmed.startsWith('-')) {
    return null;
  }

  const prefix = trimmed[0];
  const body = trimmed.slice(1);
  const [rawCommand = '', ...rest] = body.split(/\s+/);
  const remainder = rest.join(' ').trim();
  const query = rawCommand.trim().toLowerCase();

  if (!query) {
    return null;
  }

  const command = COMPOSER_COMMANDS.find((entry) =>
    entry.trigger.slice(1).startsWith(query) ||
    entry.keywords.some((keyword) => keyword.startsWith(query))
  );

  if (!command) {
    return null;
  }

  return {
    ...command,
    prefix,
    remainder,
  };
}

export function getComposerCommandSuggestions(input: string): ComposerCommandSuggestion[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/') && !trimmed.startsWith('-')) {
    return [];
  }

  const prefix = trimmed[0];
  const query = trimmed.slice(1).split(/\s+/)[0].trim().toLowerCase();

  return COMPOSER_COMMANDS.filter((entry) => {
    if (!query) return true;
    return entry.trigger.slice(1).startsWith(query) || entry.keywords.some((keyword) => keyword.startsWith(query));
  }).map((entry) => ({
    ...entry,
    prefix,
    remainder: trimmed.slice(1 + query.length).trim(),
  }));
}

export function expandComposerCommand(
  command: ComposerCommandSuggestion,
  context: ComposerContext = {},
): string {
  const topic = command.remainder.trim();
  const workspaceName = context.workspaceName || 'active workspace';
  const currentFilePath = context.currentFilePath || 'current file';
  const currentSymbolName = context.currentSymbolName || 'selected symbol';
  const currentSymbolPath = context.currentSymbolPath || currentFilePath;

  switch (command.id) {
    case 'task':
      return [
        `Task: ${topic || 'Describe the work to be done'}`,
        '',
        'Context:',
        `- Workspace: ${workspaceName}`,
        '',
        'Deliverables:',
        '-',
        '',
        'Constraints:',
        '-',
        '',
        'Acceptance:',
        '-',
      ].join('\n');
    case 'workspace':
      return [
        `Inspect the active workspace${topic ? ` for: ${topic}` : ''}.`,
        `Workspace: ${workspaceName}`,
        'Report the relevant files, symbols, and next steps.',
      ].join('\n');
    case 'refs':
      return [
        `Find references${topic ? ` for ${topic}` : ` for ${currentSymbolName} in ${currentSymbolPath}`}.`,
        'Return file paths, line numbers, and a short snippet for each hit.',
      ].join('\n');
    case 'definition':
      return [
        `Find the definition${topic ? ` of ${topic}` : ` of ${currentSymbolName} in ${currentSymbolPath}`}.`,
        'Prefer the most relevant symbol definition and cite the path and line.',
      ].join('\n');
    case 'file':
      return [
        `Inspect the file${topic ? ` ${topic}` : ` ${currentFilePath}`}.`,
        'Summarize its purpose, symbols, and any obvious follow-up work.',
      ].join('\n');
    case 'quantlabRun':
      return topic || '/quantlab-run strategy=rsi_ma_cross_v2 ticker=ETH-USD start=2023-01-01 end=2024-01-01 interval=1d rsi_buy_max=55 rsi_sell_min=80 cooldown_days=5';
    case 'goalRun':
      return topic || '/goal-run audit the active workspace and list the main architectural risks';
    case 'reasoningRun':
      return topic || '/reasoning-run prompt="Analyze the active workspace architecture and explain the main tradeoffs" max_tokens=384';
    case 'pipelineRun':
      return topic || '/pipeline-run id=1 question="Run the pipeline against the active workspace and summarize the result"';
    case 'cronCreate':
      return topic || '/cron-create id=daily_quant schedule="0 9 * * *" type=goal goal="Review the active workspace and summarize the important changes"';
    case 'triggerCreate':
      return topic || '/trigger-create id=quantlab_alert event=quantlab.completed action=goal goal="Summarize the completed run and flag anomalies"';
    default:
      return topic || command.trigger;
  }
}
