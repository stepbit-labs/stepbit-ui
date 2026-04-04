import { useMemo, useState } from 'react';
import { BarChart3, Download, FileJson, Files, FileText, Table2, Wrench } from 'lucide-react';
import { ChartComponent } from './ChartComponent';
import { MarkdownContent } from './MarkdownContent';
import type {
    Message,
    QuantlabRunStatusMetadata,
    StructuredResponseArtifact,
    StructuredResponseEnvelope,
    StructuredResponseOutputItem,
} from '../types';

interface ResultsPanelProps {
    message: Message | null;
}

interface ParsedResultBundle {
    runStatus: QuantlabRunStatusMetadata | null;
    toolResults: Array<{
        item: StructuredResponseOutputItem;
        payload: Record<string, any> | null;
    }>;
    artifacts: StructuredResponseArtifact[];
    assistantText: string[];
}

function artifactUrl(sessionId: string, path: string) {
    const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
    const apiKey = window.localStorage.getItem('jacox_api_key') || 'sk-dev-key-123';
    const params = new URLSearchParams({
        path,
        api_key: apiKey,
    });
    return `${apiBase}/sessions/${sessionId}/artifacts?${params.toString()}`;
}

function escapeHtml(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function extensionFromPath(path: string) {
    return path.split('.').pop()?.toLowerCase() || '';
}

function isImageExtension(extension: string) {
    return ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension);
}

async function fetchText(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch artifact text: ${response.status}`);
    }
    return response.text();
}

async function fetchDataUrl(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch artifact binary: ${response.status}`);
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function renderExportTable(headers: string[], rows: unknown[][]) {
    const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
    const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(renderPrimitive(cell))}</td>`).join('')}</tr>`)
        .join('');
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function printHtmlDocument(html: string) {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const cleanup = () => {
        window.setTimeout(() => {
            iframe.remove();
        }, 500);
    };

    const onLoad = () => {
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument;
        if (!win || !doc) {
            cleanup();
            return;
        }

        const images = Array.from(doc.images);
        const waits = images.map((image) => {
            if (image.complete) {
                return Promise.resolve();
            }
            return new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
            });
        });

        Promise.all(waits).finally(() => {
            win.focus();
            win.print();
            cleanup();
        });
    };

    iframe.addEventListener('load', onLoad, { once: true });
    const doc = iframe.contentDocument;
    if (!doc) {
        cleanup();
        return;
    }
    doc.open();
    doc.write(html);
    doc.close();
}

function renderExportArtifact(
    artifact: StructuredResponseArtifact,
    embeddedAssets: Map<string, string>,
    sessionId: string,
) {
    const data = artifact.data || {};
    const title = escapeHtml(artifact.title);

    if (artifact.family === 'markdown' && typeof data.markdown === 'string') {
        return `<section class="artifact"><h3>${title}</h3><pre>${escapeHtml(data.markdown)}</pre></section>`;
    }

    if (artifact.family === 'svg' && typeof data.svg === 'string') {
        return `<section class="artifact"><h3>${title}</h3><div class="svg-wrap">${data.svg}</div></section>`;
    }

    if (artifact.family === 'table' && Array.isArray(data.headers) && Array.isArray(data.rows)) {
        return `<section class="artifact"><h3>${title}</h3>${renderExportTable(data.headers, data.rows)}</section>`;
    }

    if (artifact.family === 'chart' && Array.isArray(data.data)) {
        const rows = data.data.slice(0, 60).map((row: Record<string, unknown>) => [row[data.xAxis || 'name'], row[data.yAxis || 'value']]);
        return `<section class="artifact"><h3>${title}</h3><p class="muted">Chart dataset preview.</p>${renderExportTable(
            [String(data.xAxis || 'x'), String(data.yAxis || 'y')],
            rows,
        )}</section>`;
    }

    if (artifact.family === 'file' && typeof data.path === 'string') {
        const extension = extensionFromPath(data.path);
        const assetKey = artifactUrl(sessionId, data.path);
        const embedded = embeddedAssets.get(assetKey);
        const parsedTable =
            Array.isArray(data.headers) && Array.isArray(data.rows)
                ? { headers: data.headers as string[], rows: data.rows as unknown[][] }
                : typeof data.content === 'string'
                    ? parseDelimitedRows(data.content)
                    : null;

        let body = `<p class="muted">${escapeHtml(data.path)}</p>`;
        if (isImageExtension(extension) && embedded) {
            body += `<img src="${embedded}" alt="${title}" />`;
        } else if (extension === 'svg' && embedded) {
            body += `<div class="svg-wrap">${embedded}</div>`;
        } else if (typeof data.json === 'object' && data.json) {
            body += `<pre>${escapeHtml(JSON.stringify(data.json, null, 2))}</pre>`;
        } else if (typeof data.markdown === 'string') {
            body += `<pre>${escapeHtml(data.markdown)}</pre>`;
        } else if (parsedTable) {
            body += renderExportTable(parsedTable.headers, parsedTable.rows);
        } else if (typeof data.content === 'string') {
            body += `<pre>${escapeHtml(data.content)}</pre>`;
        }

        return `<section class="artifact"><h3>${title}</h3>${body}</section>`;
    }

    return `<section class="artifact"><h3>${title}</h3><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></section>`;
}

async function buildExportDocument(
    sessionId: string,
    bundle: ParsedResultBundle,
) {
    const embeddedAssets = new Map<string, string>();

    for (const artifact of bundle.artifacts) {
        const data = artifact.data || {};
        if (typeof data.path !== 'string') {
            continue;
        }
        const url = artifactUrl(sessionId, data.path);
        const extension = extensionFromPath(data.path);
        try {
            if (isImageExtension(extension)) {
                embeddedAssets.set(url, await fetchDataUrl(url));
            } else if (extension === 'svg') {
                embeddedAssets.set(url, await fetchText(url));
            }
        } catch {
            // Export should still succeed even if one asset cannot be embedded.
        }
    }

    const metrics = bundle.toolResults.flatMap(({ payload }) => buildMetricRows(payload));
    const metricsHtml = metrics.length > 0
        ? `<section><h2>Metrics</h2><div class="metrics">${metrics
            .map(([label, value]) => `<article class="metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(renderPrimitive(value))}</div></article>`)
            .join('')}</div></section>`
        : '';
    const summaryHtml = bundle.assistantText.length > 0
        ? `<section><h2>Summary</h2><div class="summary">${bundle.assistantText.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}</div></section>`
        : '';
    const statusHtml = bundle.runStatus
        ? `<section><h2>Run Status</h2><div class="status-grid">
            <article><div class="metric-label">Status</div><div class="metric-value">${escapeHtml(bundle.runStatus.status)}</div></article>
            <article><div class="metric-label">Run ID</div><div class="metric-value small">${escapeHtml(bundle.runStatus.run_id || 'pending')}</div></article>
            <article><div class="metric-label">Started</div><div class="metric-value small">${escapeHtml(bundle.runStatus.started_at || 'n/a')}</div></article>
            <article><div class="metric-label">Finished</div><div class="metric-value small">${escapeHtml(bundle.runStatus.finished_at || 'n/a')}</div></article>
        </div></section>`
        : '';
    const artifactsHtml = bundle.artifacts.length > 0
        ? `<section><h2>Artifacts</h2>${bundle.artifacts
            .map((artifact) => renderExportArtifact(artifact, embeddedAssets, sessionId))
            .join('')}</section>`
        : '';
    const toolResultsHtml = bundle.toolResults.length > 0
        ? `<section><h2>Tool Output</h2>${bundle.toolResults
            .map(({ payload }, index) => `<section class="artifact"><h3>${escapeHtml(payload?.tool_name || `tool-${index + 1}`)}</h3><pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre></section>`)
            .join('')}</section>`
        : '';

    const title = escapeHtml(bundle.runStatus?.run_id || 'stepbit-results');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; --bg:#1d2021; --panel:#282828; --panel2:#32302f; --text:#ebdbb2; --muted:#a89984; --accent:#8ec07c; --cyan:#83a598; --pink:#d3869b; }
    * { box-sizing:border-box; }
    body { margin:0; padding:32px; background:linear-gradient(180deg,#1d2021,#141617); color:var(--text); font:14px/1.6 ui-sans-serif,system-ui,sans-serif; }
    h1,h2,h3 { margin:0 0 12px; }
    h1 { font-size:28px; }
    h2 { font-size:18px; color:var(--cyan); margin-top:28px; }
    h3 { font-size:15px; color:var(--accent); }
    section { margin-bottom:20px; }
    .shell { max-width:1100px; margin:0 auto; }
    .panel, .artifact, article { background:rgba(40,40,40,0.88); border:1px solid rgba(168,153,132,0.18); border-radius:14px; padding:16px; }
    .metrics, .status-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
    .metric-label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.14em; }
    .metric-value { margin-top:8px; font-size:22px; font-weight:700; }
    .metric-value.small { font-size:13px; word-break:break-word; }
    .summary p { margin:0 0 12px; }
    .artifact { margin-bottom:14px; }
    .muted { color:var(--muted); margin:0 0 10px; word-break:break-all; }
    pre { margin:0; padding:14px; overflow:auto; border-radius:10px; background:rgba(20,20,20,0.6); color:#8ec07c; white-space:pre-wrap; word-break:break-word; max-width:100%; }
    .table-wrap { margin-top:10px; max-width:100%; overflow-x:auto; overflow-y:hidden; border:1px solid rgba(168,153,132,0.12); border-radius:10px; }
    table { width:max-content; min-width:100%; border-collapse:collapse; margin:0; table-layout:auto; }
    th,td { border:1px solid rgba(168,153,132,0.18); padding:8px 10px; text-align:left; vertical-align:top; }
    th { background:rgba(131,165,152,0.12); }
    img { max-width:100%; height:auto; display:block; margin-top:12px; border-radius:10px; background:#141617; }
    .svg-wrap { margin-top:12px; padding:12px; border-radius:10px; background:rgba(20,20,20,0.4); }
    @media print {
      body { padding:0; background:white; color:black; }
      .panel, .artifact, article { break-inside:avoid; background:white; border:1px solid #ddd; }
      h2 { color:#333; }
      pre { color:#111; background:#f6f6f6; }
      th { background:#f0f0f0; }
      .table-wrap { overflow:visible; border:1px solid #ddd; }
      table { width:100%; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="panel">
      <h1>Stepbit QuantLab Results Export</h1>
      <p class="muted">Generated ${escapeHtml(new Date().toISOString())}</p>
    </header>
    ${statusHtml}
    ${summaryHtml}
    ${metricsHtml}
    ${artifactsHtml}
    ${toolResultsHtml}
  </main>
</body>
</html>`;
}

function isStructuredResponseEnvelope(value: unknown): value is StructuredResponseEnvelope {
    return !!value && typeof value === 'object';
}

function parseJsonObject(value: string): Record<string, any> | null {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function buildMetricRows(payload: Record<string, any> | null) {
    const summary =
        (payload?.machine_contract && typeof payload.machine_contract === 'object' && payload.machine_contract.summary) ||
        payload?.metrics ||
        payload?.summary;

    if (!summary || typeof summary !== 'object') {
        return [];
    }

    return Object.entries(summary)
        .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
        .slice(0, 12);
}

function renderPrimitive(value: unknown) {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (value == null) {
        return 'null';
    }
    return String(value);
}

function parseDelimitedRows(content: string) {
    const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length < 2) {
        return null;
    }

    const splitLine = (line: string) =>
        line
            .split(',')
            .map((cell) => cell.trim())
            .filter((cell) => cell.length > 0);

    const headers = splitLine(lines[0]);
    const rows = lines.slice(1, 41).map(splitLine).filter((row) => row.length === headers.length);

    if (headers.length === 0 || rows.length === 0) {
        return null;
    }

    return { headers, rows };
}

function isQuantlabRunStatus(value: unknown): value is QuantlabRunStatusMetadata {
    return !!value && typeof value === 'object' && (value as QuantlabRunStatusMetadata).command === 'quantlab_run';
}

function inferRunStatus(
    explicitStatus: QuantlabRunStatusMetadata | null,
    toolResults: Array<{ item: StructuredResponseOutputItem; payload: Record<string, any> | null }>,
    artifacts: StructuredResponseArtifact[],
): QuantlabRunStatusMetadata | null {
    const quantlabToolResult = toolResults.find(({ payload }) =>
        typeof payload?.tool_name === 'string' ? payload.tool_name === 'quantlab_run' : true,
    );
    const payload = quantlabToolResult?.payload;

    if (!payload && explicitStatus) {
        return explicitStatus;
    }
    if (!payload) {
        return null;
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    const lastEvent = events.length > 0 && events[events.length - 1] && typeof events[events.length - 1] === 'object'
        ? String(events[events.length - 1].event || events[events.length - 1].status || 'completed')
        : explicitStatus?.last_event || null;
    const runId = typeof payload.run_id === 'string'
        ? payload.run_id
        : typeof payload.machine_contract?.run_id === 'string'
            ? payload.machine_contract.run_id
            : explicitStatus?.run_id || null;
    const status = payload.status === 'success' || payload.status === 'error' ? payload.status : explicitStatus?.status || 'success';
    const finishedAt = events.length > 0 && events[events.length - 1] && typeof events[events.length - 1] === 'object'
        ? String(events[events.length - 1].timestamp || explicitStatus?.finished_at || '')
        : explicitStatus?.finished_at || null;

    return {
        command: 'quantlab_run',
        status,
        started_at: explicitStatus?.started_at || String(events[0]?.timestamp || ''),
        finished_at: finishedAt || null,
        prompt: explicitStatus?.prompt || null,
        input: explicitStatus?.input || null,
        run_id: runId,
        artifact_count: Array.isArray(payload.artifacts) ? payload.artifacts.length : artifacts.length,
        error_count: Array.isArray(payload.errors) ? payload.errors.length : explicitStatus?.error_count || 0,
        last_event: lastEvent,
    };
}

function statusTone(status: QuantlabRunStatusMetadata['status']) {
    if (status === 'running') {
        return 'text-monokai-aqua border-monokai-aqua/30 bg-monokai-aqua/10';
    }
    if (status === 'success') {
        return 'text-monokai-green border-monokai-green/30 bg-monokai-green/10';
    }
    return 'text-monokai-red border-monokai-red/30 bg-monokai-red/10';
}

function artifactView(sessionId: string, artifact: StructuredResponseArtifact, key: string) {
    const data = artifact.data || {};

    if (artifact.family === 'chart' && data.role === 'chart') {
        return <ChartComponent key={key} chartData={data as any} />;
    }

    if (artifact.family === 'table' && Array.isArray(data.headers) && Array.isArray(data.rows)) {
        return (
            <div key={key} className="overflow-x-auto rounded-sm border border-gruv-dark-4/30">
                <table className="w-full text-[11px] text-left border-collapse">
                    <thead className="bg-gruv-dark-3 text-monokai-aqua">
                        <tr>
                            {data.headers.map((header: string) => (
                                <th key={header} className="px-3 py-2 border-r border-gruv-dark-4/30 last:border-r-0">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.rows.map((row: unknown[], rowIndex: number) => (
                            <tr key={rowIndex} className="border-t border-gruv-dark-4/20">
                                {row.map((cell: unknown, cellIndex: number) => (
                                    <td key={cellIndex} className="px-3 py-2 border-r border-gruv-dark-4/20 last:border-r-0">
                                        {renderPrimitive(cell)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    if (artifact.family === 'markdown' && typeof data.markdown === 'string') {
        return <MarkdownContent key={key} content={data.markdown} />;
    }

    if (artifact.family === 'svg' && typeof data.svg === 'string') {
        return (
            <div
                key={key}
                className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/30 p-4"
                dangerouslySetInnerHTML={{ __html: data.svg }}
            />
        );
    }

    if (artifact.family === 'file' && typeof data.path === 'string') {
        const artifactHref = artifactUrl(sessionId, data.path);
        const extension = data.path.split('.').pop()?.toLowerCase() || '';
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension);
        const parsedJson = typeof data.json === 'object' && data.json ? data.json : null;
        const parsedTable =
            Array.isArray(data.headers) && Array.isArray(data.rows)
                ? { headers: data.headers, rows: data.rows }
                : typeof data.content === 'string'
                    ? parseDelimitedRows(data.content)
                    : null;

        return (
            <div key={key} className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/20 p-3">
                <div className="flex items-center justify-between gap-3 text-[11px]">
                    <div className="min-w-0">
                        <div className="truncate text-gruv-light-1 font-medium">{artifact.title}</div>
                        <div className="truncate text-gruv-light-4 font-mono">{data.path}</div>
                    </div>
                    <div className="flex items-center gap-3">
                        {typeof data.size_bytes === 'number' && (
                            <div className="text-gruv-light-4 font-mono">{data.size_bytes.toLocaleString()} B</div>
                        )}
                        <a
                            href={artifactHref}
                            target="_blank"
                            rel="noreferrer"
                            className="text-monokai-aqua hover:text-monokai-green transition-colors"
                        >
                            Open
                        </a>
                    </div>
                </div>
                {isImage && (
                    <div className="mt-3 overflow-hidden rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-3/30 p-2">
                        <img
                            src={artifactHref}
                            alt={artifact.title}
                            className="max-h-[26rem] w-full object-contain"
                            loading="lazy"
                        />
                    </div>
                )}
                {parsedJson && (
                    <pre className="mt-3 overflow-x-auto rounded-sm bg-gruv-dark-3/60 p-3 text-[11px] text-monokai-aqua">
                        {JSON.stringify(parsedJson, null, 2)}
                    </pre>
                )}
                {!parsedJson && typeof data.markdown === 'string' && (
                    <div className="mt-3">
                        <MarkdownContent content={data.markdown} />
                    </div>
                )}
                {!parsedJson && parsedTable && (
                    <div className="mt-3 overflow-x-auto rounded-sm border border-gruv-dark-4/30">
                        <table className="w-full text-[11px] text-left border-collapse">
                            <thead className="bg-gruv-dark-3 text-monokai-aqua">
                                <tr>
                                    {parsedTable.headers.map((header) => (
                                        <th key={header} className="px-3 py-2 border-r border-gruv-dark-4/30 last:border-r-0">
                                            {header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {parsedTable.rows.map((row: string[], rowIndex: number) => (
                                    <tr key={rowIndex} className="border-t border-gruv-dark-4/20">
                                        {row.map((cell: string, cellIndex: number) => (
                                            <td key={cellIndex} className="px-3 py-2 border-r border-gruv-dark-4/20 last:border-r-0">
                                                {renderPrimitive(cell)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    }

    return (
        <pre key={key} className="overflow-x-auto rounded-sm bg-gruv-dark-3/60 p-3 text-[11px] text-monokai-aqua">
            {JSON.stringify(data, null, 2)}
        </pre>
    );
}

export function ResultsPanel({ message }: ResultsPanelProps) {
    const [exportState, setExportState] = useState<'idle' | 'html' | 'pdf'>('idle');
    const bundle = useMemo<ParsedResultBundle | null>(() => {
        const runStatus = isQuantlabRunStatus(message?.metadata?.quantlab_run_status)
            ? message?.metadata?.quantlab_run_status
            : null;
        const envelope = message?.metadata?.structured_response;
        if (!isStructuredResponseEnvelope(envelope) || !Array.isArray(envelope.output)) {
            return runStatus
                ? {
                    runStatus,
                    toolResults: [],
                    artifacts: [],
                    assistantText: [],
                }
                : null;
        }

        const toolResults = envelope.output
            .filter((item) => item.item_type === 'tool_result')
            .map((item) => ({
                item,
                payload: parseJsonObject(item.content[0]?.text || ''),
            }));

        const artifacts = envelope.output
            .filter((item) => item.item_type === 'artifact')
            .flatMap((item) => item.content.map((content) => content.artifact).filter(Boolean) as StructuredResponseArtifact[]);

        const assistantText = envelope.output
            .filter((item) => item.item_type === 'message' && item.role === 'assistant')
            .flatMap((item) => item.content.map((content) => content.text).filter(Boolean));

        return {
            runStatus: inferRunStatus(runStatus, toolResults, artifacts),
            toolResults,
            artifacts,
            assistantText,
        };
    }, [message]);

    if (!bundle) {
        return (
            <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-gruv-dark-4/40 bg-gruv-dark-2/20 p-6 text-center text-[12px] text-gruv-light-4">
                Ejecuta una herramienta compatible para ver resultados estructurados aqui.
            </div>
        );
    }

    const metricCards = bundle.toolResults.flatMap(({ payload }) => buildMetricRows(payload));

    const handleExport = async (mode: 'html' | 'pdf') => {
        if (!message?.session_id) {
            return;
        }

        try {
            setExportState(mode);
            const html = await buildExportDocument(message.session_id, bundle);

            if (mode === 'html') {
                const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `${bundle.runStatus?.run_id || 'stepbit-results'}.html`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
                return;
            }

            printHtmlDocument(html);
        } finally {
            setExportState('idle');
        }
    };

    return (
        <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
            <section className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/30 p-4">
                <div className="mb-4 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-monokai-orange">
                    <FileText className="h-3.5 w-3.5" />
                    Export
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => void handleExport('html')}
                        disabled={exportState !== 'idle'}
                        className="inline-flex items-center gap-2 rounded-sm border border-monokai-aqua/30 bg-monokai-aqua/10 px-3 py-2 text-[11px] font-medium text-monokai-aqua transition-colors hover:bg-monokai-aqua/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {exportState === 'html' ? <Download className="h-3.5 w-3.5 animate-bounce" /> : <FileText className="h-3.5 w-3.5" />}
                        Export HTML
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleExport('pdf')}
                        disabled={exportState !== 'idle'}
                        className="inline-flex items-center gap-2 rounded-sm border border-monokai-green/30 bg-monokai-green/10 px-3 py-2 text-[11px] font-medium text-monokai-green transition-colors hover:bg-monokai-green/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {exportState === 'pdf' ? <Download className="h-3.5 w-3.5 animate-bounce" /> : <Download className="h-3.5 w-3.5" />}
                        Export PDF
                    </button>
                    <div className="text-[11px] text-gruv-light-4">
                        HTML sale como archivo standalone. PDF abre una vista imprimible con imágenes embebidas.
                    </div>
                </div>
            </section>

            {bundle.runStatus && (
                <section className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/30 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-monokai-aqua">
                            <Wrench className="h-3.5 w-3.5" />
                            Run Status
                        </div>
                        <div className={`rounded-sm border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] ${statusTone(bundle.runStatus.status)}`}>
                            {bundle.runStatus.status}
                        </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <article className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 p-3">
                            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gruv-light-4">Run ID</div>
                            <div className="mt-2 text-[13px] font-semibold text-gruv-light-1 break-all">
                                {bundle.runStatus.run_id || 'pending'}
                            </div>
                        </article>
                        <article className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 p-3">
                            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gruv-light-4">Last Event</div>
                            <div className="mt-2 text-[13px] font-semibold text-gruv-light-1">
                                {bundle.runStatus.last_event || (bundle.runStatus.status === 'running' ? 'SESSION_STARTED' : 'n/a')}
                            </div>
                        </article>
                        <article className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 p-3">
                            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gruv-light-4">Artifacts</div>
                            <div className="mt-2 text-[13px] font-semibold text-gruv-light-1">
                                {renderPrimitive(bundle.runStatus.artifact_count ?? bundle.artifacts.length)}
                            </div>
                        </article>
                        <article className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 p-3">
                            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gruv-light-4">Errors</div>
                            <div className="mt-2 text-[13px] font-semibold text-gruv-light-1">
                                {renderPrimitive(bundle.runStatus.error_count ?? 0)}
                            </div>
                        </article>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <article className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 p-3">
                            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gruv-light-4">Started</div>
                            <div className="mt-2 text-[12px] text-gruv-light-2">
                                {bundle.runStatus.started_at || 'n/a'}
                            </div>
                        </article>
                        <article className="rounded-sm border border-gruv-dark-4/20 bg-gruv-dark-2/20 p-3">
                            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gruv-light-4">Finished</div>
                            <div className="mt-2 text-[12px] text-gruv-light-2">
                                {bundle.runStatus.finished_at || (bundle.runStatus.status === 'running' ? 'running...' : 'n/a')}
                            </div>
                        </article>
                    </div>
                </section>
            )}

            {bundle.assistantText.length > 0 && (
                <section className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/30 p-4">
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-monokai-aqua">
                        <Wrench className="h-3.5 w-3.5" />
                        Result Summary
                    </div>
                    <MarkdownContent content={bundle.assistantText.join('\n\n')} />
                </section>
            )}

            {metricCards.length > 0 && (
                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {metricCards.map(([label, value]) => (
                        <article key={label} className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/30 p-3">
                            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gruv-light-4">{label}</div>
                            <div className="mt-2 text-[18px] font-semibold text-gruv-light-1">{renderPrimitive(value)}</div>
                        </article>
                    ))}
                </section>
            )}

            {bundle.artifacts.length > 0 && (
                <section className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/20 p-4">
                    <div className="mb-4 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-monokai-purple">
                        <Files className="h-3.5 w-3.5" />
                        Artifacts
                    </div>
                    <div className="space-y-4">
                        {bundle.artifacts.map((artifact, index) => (
                            <div key={`${artifact.title}-${index}`} className="space-y-2">
                                <div className="flex items-center gap-2 text-[11px] font-semibold text-gruv-light-2">
                                    {artifact.family === 'chart' ? <BarChart3 className="h-3.5 w-3.5 text-monokai-aqua" /> : null}
                                    {artifact.family === 'table' ? <Table2 className="h-3.5 w-3.5 text-monokai-green" /> : null}
                                    {artifact.family === 'file' ? <FileJson className="h-3.5 w-3.5 text-monokai-orange" /> : null}
                                    <span>{artifact.title}</span>
                                    <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-gruv-light-4">
                                        {artifact.family}
                                    </span>
                                </div>
                                {artifactView(message!.session_id, artifact, `${artifact.title}-${index}`)}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {bundle.toolResults.length > 0 && (
                <section className="rounded-sm border border-gruv-dark-4/30 bg-gruv-dark-2/20 p-4">
                    <div className="mb-4 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-monokai-orange">
                        <FileJson className="h-3.5 w-3.5" />
                        Tool Output
                    </div>
                    <div className="space-y-4">
                        {bundle.toolResults.map(({ item, payload }, index) => (
                            <div key={item.id || index}>
                                <div className="mb-2 text-[11px] font-semibold text-gruv-light-2">
                                    {payload?.tool_name || payload?.command || item.id || `tool-${index + 1}`}
                                </div>
                                <pre className="overflow-x-auto rounded-sm bg-gruv-dark-3/60 p-3 text-[11px] text-monokai-aqua">
                                    {JSON.stringify(payload ?? parseJsonObject(item.content[0]?.text || '') ?? item.content, null, 2)}
                                </pre>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
