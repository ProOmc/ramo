import { useCallback, useEffect, useState } from 'react';
import { useShell } from '../lib/hooks';

interface TreeEntry {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  message?: { role?: string; content?: unknown };
  summary?: string;
  customType?: string;
}
interface TreeNode { entry: TreeEntry; children: TreeNode[]; label?: string }

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (block && typeof block === 'object') {
        const record = block as Record<string, unknown>;
        return typeof record.text === 'string' ? record.text : typeof record.content === 'string' ? record.content : '';
      }
      return '';
    }).filter(Boolean).join(' ');
  }
  return '';
}

function nodeTitle(node: TreeNode): string {
  if (node.label) return node.label;
  const entry = node.entry;
  if (entry.type === 'message') {
    const role = entry.message?.role ?? 'message';
    const text = textOf(entry.message?.content).replace(/\s+/g, ' ').trim();
    return `${role}: ${text.slice(0, 110) || '(empty)'}`;
  }
  if (entry.type === 'compaction') return `Compaction: ${String(entry.summary ?? '').slice(0, 110)}`;
  if (entry.type === 'custom') return `${entry.customType ?? 'record'}`;
  return entry.type;
}

/** The session tree as a navigable timeline, backed by the worker's tree methods. */
export function SessionTreePage() {
  const { showToast } = useShell();
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useCallback((method: string, params?: Record<string, unknown>) =>
    (window as unknown as { RamoRuntime?: { request?: (m: string, p?: Record<string, unknown>) => Promise<unknown> } }).RamoRuntime?.request?.(method, params), []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await request('tree');
      setNodes(Array.isArray(raw) ? raw as TreeNode[] : []);
      setError('');
    } catch (reason) { setError(String((reason as { message?: string })?.message ?? reason)); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  const go = async (id: string) => {
    try { await request('navigateTree', { entryId: id }); showToast('Moved to that point in the session.'); await load(); }
    catch (reason) { showToast('Navigate failed: ' + String((reason as { message?: string })?.message ?? reason)); }
  };
  const branch = async (id: string) => {
    try { await request('fork', { entryId: id }); showToast('New conversation branched from that point.'); await load(); }
    catch (reason) { showToast('Branch failed: ' + String((reason as { message?: string })?.message ?? reason)); }
  };

  const rows: { node: TreeNode; depth: number }[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) { rows.push({ node, depth }); walk(node.children, depth + 1); }
  };
  walk(nodes, 0);

  return (
    <div className="ramo-chat-scroll oc-page-scroll">
      <div className="ramo-reading oc-page">
        <h1 className="oc-page-title">Sessions</h1>
        <p className="oc-page-subtitle">Every turn and branch in this conversation. Go back to a point, or branch from it without losing the original.</p>
        {error ? <p className="oc-page-note" role="alert">Session timeline unavailable: {error}</p> : null}
        <div className="oc-page-row">
          <button type="button" className="oc-shell-button" disabled={loading} onClick={() => void load()}>{loading ? 'Loading timeline…' : 'Refresh timeline'}</button>
        </div>
        <div className="oc-tree-list">
          {loading ? <p className="oc-page-note" role="status">Loading session timeline…</p>
            : rows.length === 0 ? <p className="oc-page-note">{error ? 'No timeline could be loaded. Use Refresh timeline to try again.' : 'No turns recorded yet.'}</p>
            : rows.map(({ node, depth }) => (
            <div key={node.entry.id} className="oc-tree-row" style={{ paddingLeft: `${Math.min(depth, 8) * 18}px` }}>
              <span className={`oc-tree-kind oc-tree-${node.entry.type}`}>{node.entry.type === 'custom' ? String(node.entry.customType ?? 'record') : node.entry.type}</span>
              <span className="oc-tree-title" title={nodeTitle(node)}>{nodeTitle(node)}</span>
              <button type="button" className="oc-shell-button-quiet" onClick={() => void go(node.entry.id)}>Go</button>
              <button type="button" className="oc-shell-button-quiet" onClick={() => void branch(node.entry.id)}>Branch</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
