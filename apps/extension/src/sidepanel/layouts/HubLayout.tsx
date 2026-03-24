import {
  ExternalLink,
  Globe,
  History,
  MoreVertical,
  Plus,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { HistoryDrawer } from '../components/HistoryDrawer.js';
import { VoxelLogo } from '../components/VoxelLogo.js';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

interface Tab {
  id: string;
  label: string;
}

export function HubLayout() {
  const navigate = useNavigate();
  const params = useParams();
  const convId = params.conversationId;

  const [historyOpen, setHistoryOpen] = useState(false);
  const [globalMenuOpen, setGlobalMenuOpen] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [currentDomain, setCurrentDomain] = useState('');

  // Track browser tab domain
  const updateDomain = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, t => {
      if (t[0]?.url) {
        try {
          setCurrentDomain(new URL(t[0].url).hostname);
        } catch {}
      }
    });
  }, []);

  useEffect(() => {
    updateDomain();
    const h = () => updateDomain();
    chrome.tabs.onActivated.addListener(h);
    chrome.tabs.onUpdated.addListener(h);
    return () => {
      chrome.tabs.onActivated.removeListener(h);
      chrome.tabs.onUpdated.removeListener(h);
    };
  }, [updateDomain]);

  // Sync tabs with current conversation
  useEffect(() => {
    if (convId && !tabs.find(t => t.id === convId)) {
      setTabs(prev => [
        ...prev,
        { id: convId, label: currentDomain || 'Chat' },
      ]);
    }
  }, [convId, currentDomain, tabs]);

  // The "active" state: either a conversation tab or the new-chat state (no convId)
  const isNewChat = !convId;

  function openConversation(id: string) {
    navigate(`/chat/${id}`);
  }

  function startNewChat() {
    navigate('/');
  }

  function closeTab(id: string) {
    setTabs(prev => prev.filter(t => t.id !== id));
    if (convId === id) {
      navigate('/');
    }
    setTabMenuOpen(null);
  }

  function dispatchAction(action: string) {
    window.dispatchEvent(
      new CustomEvent('commandra-tab-action', { detail: { action } }),
    );
    setTabMenuOpen(null);
  }

  return (
    <>
      <div className="flex flex-col border-b border-border bg-surface flex-shrink-0">
        {/* Top bar */}
        <div className="h-9 px-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setHistoryOpen(true)}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
              title="History"
            >
              <History size={13} strokeWidth={1.5} />
            </button>
            <button onClick={startNewChat} className="p-1">
              <VoxelLogo size={14} className="text-foreground" />
            </button>
          </div>
          <div className="flex items-center gap-0.5">
            {/* Global menu */}
            <div className="relative">
              <button
                onClick={() => setGlobalMenuOpen(!globalMenuOpen)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
              >
                <Settings size={13} strokeWidth={1.5} />
              </button>
              {globalMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setGlobalMenuOpen(false)}
                    role="presentation"
                  />
                  <div className="absolute right-0 top-full mt-1 z-50 w-44 border border-border bg-card py-1 shadow-lg">
                    <button
                      onClick={() => {
                        setGlobalMenuOpen(false);
                        chrome.tabs.create({ url: DASHBOARD_URL });
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-elevated"
                    >
                      <ExternalLink size={12} strokeWidth={1.5} /> Dashboard
                    </button>
                    <button
                      onClick={() => {
                        setGlobalMenuOpen(false);
                        navigate('/settings');
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-elevated"
                    >
                      <Settings size={12} strokeWidth={1.5} /> Settings
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <button
                      onClick={() => {
                        setGlobalMenuOpen(false);
                        window.close();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-elevated"
                    >
                      <X size={12} strokeWidth={1.5} /> Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center border-t border-border">
          {/* New chat tab (always first) */}
          <div
            className={`flex items-center gap-1.5 border-r border-border px-3 py-1.5 cursor-pointer transition-colors flex-shrink-0 ${
              isNewChat
                ? 'bg-background text-foreground'
                : 'bg-surface text-muted-foreground hover:text-foreground hover:bg-elevated'
            }`}
            onClick={startNewChat}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && startNewChat()}
          >
            <Plus size={10} strokeWidth={2} className="flex-shrink-0" />
            <span className="font-mono text-[10px]">New</span>
          </div>

          {/* Conversation tabs */}
          <div className="flex items-center flex-1 overflow-x-auto min-w-0">
            {tabs.map(tab => {
              const isActive = convId === tab.id;
              return (
                <div
                  key={tab.id}
                  className={`group flex items-center gap-1 border-r border-border px-2 py-1.5 min-w-0 max-w-[140px] cursor-pointer transition-colors flex-shrink-0 ${
                    isActive
                      ? 'bg-background text-foreground'
                      : 'bg-surface text-muted-foreground hover:text-foreground hover:bg-elevated'
                  }`}
                  onClick={() => openConversation(tab.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && openConversation(tab.id)}
                >
                  <span
                    className="status-pixel"
                    style={{
                      backgroundColor: isActive
                        ? 'hsl(var(--success))'
                        : 'hsl(var(--dim))',
                    }}
                  />
                  <span className="font-mono text-[10px] truncate flex-1">
                    {tab.label}
                  </span>

                  {/* Tab actions */}
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setTabMenuOpen(tabMenuOpen === tab.id ? null : tab.id);
                      }}
                      className="p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                    >
                      <MoreVertical size={10} strokeWidth={1.5} />
                    </button>
                  </div>

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <X size={9} strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab context menu — rendered outside tab bar to avoid clipping */}
      {tabMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setTabMenuOpen(null)}
            role="presentation"
          />
          <div
            className="absolute left-4 z-50 w-40 border border-border bg-card py-1 shadow-lg"
            style={{ top: '76px' }}
          >
            <button
              onClick={() => dispatchAction('reindex')}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-elevated"
            >
              <RefreshCw size={11} strokeWidth={1.5} /> Re-index page
            </button>
            <button
              onClick={() => dispatchAction('deep-index')}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-elevated"
            >
              <Globe size={11} strokeWidth={1.5} /> Deep index site
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              onClick={() => closeTab(tabMenuOpen)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-destructive hover:bg-elevated"
            >
              <X size={11} strokeWidth={1.5} /> Close tab
            </button>
          </div>
        </>
      )}

      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}
