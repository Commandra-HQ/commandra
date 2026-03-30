/**
 * HubLayout — top-level layout with header, tab bar, and router outlet.
 * Tab bar extracted to TabBar component for maintainability.
 */

import {
  Archive,
  Copy,
  EllipsisVertical,
  ExternalLink,
  Globe,
  History,
  LogOut,
  Minimize2,
  Plus,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { HistoryDrawer } from '../components/HistoryDrawer.js';
import { VoxelLogo } from '../components/VoxelLogo.js';
import { TabBar, type Tab } from '../components/TabBar.js';
import { useAuth } from '../contexts/auth.js';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

export function HubLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const convId = params.conversationId;

  const headerRef = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [globalMenuOpen, setGlobalMenuOpen] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [currentDomain, setCurrentDomain] = useState('');
  const [logoHovered, setLogoHovered] = useState(false);

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

  // Add a tab when navigating to a conversation that doesn't have one yet
  // Fetch the conversation title from the API for a better label
  useEffect(() => {
    if (convId && !tabs.find(t => t.id === convId)) {
      // Add tab immediately with a placeholder label
      setTabs(prev => {
        if (prev.find(t => t.id === convId)) return prev;
        return [...prev, { id: convId, label: 'Chat' }];
      });
      // Fetch the real title from the API
      fetchConvTitle(convId);
    }
  }, [convId]);

  // Listen for title updates from the SSE stream (emitted by the store)
  useEffect(() => {
    function handleTitleUpdate(e: Event) {
      const { conversationId: cId, title } = (e as CustomEvent).detail || {};
      if (cId && title) {
        setTabs(prev =>
          prev.map(t =>
            t.id === cId ? { ...t, label: title.slice(0, 40) } : t,
          ),
        );
      }
    }
    window.addEventListener('commandra-title-update', handleTitleUpdate);
    return () => window.removeEventListener('commandra-title-update', handleTitleUpdate);
  }, []);

  function fetchConvTitle(cId: string) {
    chrome.storage.local.get('authToken', ({ authToken }) => {
      if (!authToken) return;
      const apiUrl = process.env.API_URL || 'http://localhost:3001';
      fetch(`${apiUrl}/api/conversations/${cId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.conversation?.title) {
            setTabs(prev =>
              prev.map(t =>
                t.id === cId && t.label !== data.conversation.title
                  ? { ...t, label: data.conversation.title.slice(0, 40) }
                  : t,
              ),
            );
          }
        })
        .catch(() => {});
    });
  }

  const isNewChat = !convId;

  function openConversation(id: string) {
    navigate(`/chat/${id}`);
  }

  function startNewChat() {
    navigate('/');
  }

  function closeTab(id: string) {
    // Compute navigation target before modifying state
    const remaining = tabs.filter(t => t.id !== id);
    if (convId === id) {
      if (remaining.length > 0) {
        const closedIndex = tabs.findIndex(t => t.id === id);
        const nextTab = remaining[Math.min(closedIndex, remaining.length - 1)];
        navigate(`/chat/${nextTab.id}`);
      } else {
        navigate('/');
      }
    }
    setTabs(remaining);
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
      <div
        ref={headerRef}
        className="flex flex-col border-b border-border bg-surface flex-shrink-0"
      >
        {/* Top bar */}
        <div className="h-11 px-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              onClick={startNewChat}
              className="py-1 flex items-center gap-2"
              onMouseEnter={() => setLogoHovered(true)}
              onMouseLeave={() => setLogoHovered(false)}
            >
              <VoxelLogo
                size={18}
                className="text-foreground"
                hovered={logoHovered}
              />
              <span className="font-mono text-sm font-medium tracking-wide text-foreground">
                Commandra
              </span>
            </button>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="relative">
              <button
                onClick={() => setGlobalMenuOpen(!globalMenuOpen)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
              >
                <EllipsisVertical size={15} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setHistoryOpen(true)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
                title="History"
              >
                <History size={15} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => {
                  setGlobalMenuOpen(false);
                  window.close();
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
              >
                <X size={15} strokeWidth={1.5} />
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
                    <button
                      type="button"
                      onClick={() => {
                        setGlobalMenuOpen(false);
                        void logout();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-elevated"
                    >
                      <LogOut size={12} strokeWidth={1.5} /> Log out
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <button
                      onClick={() => {
                        setGlobalMenuOpen(false);
                        window.close();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-elevated"
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
        <TabBar
          tabs={tabs}
          activeTabId={convId}
          isNewChat={isNewChat}
          onNewChat={startNewChat}
          onSelectTab={openConversation}
          onCloseTab={closeTab}
          onTabMenuOpen={setTabMenuOpen}
          tabMenuOpen={tabMenuOpen}
        />
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
            style={{
              top: headerRef.current
                ? `${headerRef.current.offsetHeight + 2}px`
                : '84px',
            }}
          >
            <button
              onClick={() => dispatchAction('copy-chat')}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-elevated"
            >
              <Copy size={11} strokeWidth={1.5} /> Copy chat
            </button>
            <button
              onClick={() => {
                setTabMenuOpen(null);
                startNewChat();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-elevated"
            >
              <Plus size={11} strokeWidth={1.5} /> New chat
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              onClick={() => dispatchAction('reindex')}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-elevated"
            >
              <RefreshCw size={11} strokeWidth={1.5} /> Re-index page
            </button>
            <button
              onClick={() => dispatchAction('deep-index')}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-elevated"
            >
              <Globe size={11} strokeWidth={1.5} /> Deep index site
            </button>
            <button
              onClick={() => dispatchAction('compact')}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-elevated"
            >
              <Archive size={11} strokeWidth={1.5} /> Compact chat
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
