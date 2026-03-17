import { Bot, Loader2, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const API_URL = process.env.API_URL || 'http://localhost:3001';

const CATEGORY_OPTIONS = [
  'productivity',
  'data-extraction',
  'outreach',
  'devtools',
  'social-media',
  'crm',
  'finance',
  'other',
] as const;

type AgentCategory = (typeof CATEGORY_OPTIONS)[number];

interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  domains: string[];
  category: AgentCategory;
}

interface AgentsTabProps {
  user: { id: string; email: string };
}

async function getAuthToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get(['authToken']);
  return stored.authToken ?? null;
}

export function AgentsTab({ user }: AgentsTabProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [domains, setDomains] = useState('');
  const [category, setCategory] = useState<AgentCategory>('productivity');

  async function loadAgents() {
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents ?? data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAgents();
  }, []);

  function resetForm() {
    setName('');
    setDescription('');
    setInstructions('');
    setDomains('');
    setCategory('productivity');
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const token = await getAuthToken();
      if (!token) {
        setError('Not authenticated');
        return;
      }
      const domainList = domains
        .split(',')
        .map(d => d.trim())
        .filter(Boolean);
      const res = await fetch(`${API_URL}/api/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          instructions: instructions.trim(),
          domains: domainList,
          category,
        }),
      });
      if (res.ok) {
        resetForm();
        setShowForm(false);
        await loadAgents();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Failed to create agent');
      }
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Agents
        </h3>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus size={13} />
            <span>Create Agent</span>
          </button>
        )}
      </div>

      {/* Creation form */}
      {showForm && (
        <div className="rounded-md border border-border bg-secondary p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              New Agent
            </span>
            <button
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Agent name"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description"
              rows={2}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="Instructions for the agent..."
              rows={3}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <input
              type="text"
              value={domains}
              onChange={e => setDomains(e.target.value)}
              placeholder="Domains (comma-separated, e.g. github.com, linear.app)"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <select
              value={category}
              onChange={e => setCategory(e.target.value as AgentCategory)}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {CATEGORY_OPTIONS.map(opt => (
                <option key={opt} value={opt}>
                  {opt.replace(/-/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {creating ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>Creating...</span>
              </>
            ) : (
              <span>Create Agent</span>
            )}
          </button>
        </div>
      )}

      {/* Agent list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Bot size={20} className="text-muted-foreground" />
          <p className="text-xs text-muted-foreground">No agents yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map(agent => (
            <div
              key={agent.id}
              className="rounded-md border border-border bg-secondary px-3 py-2.5 space-y-1"
            >
              <div className="flex items-center gap-2">
                <Bot size={14} className="text-muted-foreground shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">
                  {agent.name}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground bg-background px-1.5 py-0.5 rounded">
                  {agent.category.replace(/-/g, ' ')}
                </span>
              </div>
              {agent.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 pl-[22px]">
                  {agent.description}
                </p>
              )}
              {agent.domains?.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-[22px]">
                  {agent.domains.map(d => (
                    <span
                      key={d}
                      className="text-[10px] text-muted-foreground bg-background px-1.5 py-0.5 rounded font-mono"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
