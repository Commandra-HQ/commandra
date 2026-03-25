/**
 * Layout sub-components for the ChatTab — context bar, plan panel, and input area.
 */

import type { SelectedElement } from '@afe/shared';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Globe,
  ListChecks,
  Loader2,
  MousePointer,
  Plus,
  RefreshCw,
  Send,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, SiteData } from './chat-types.js';

export function ContextBar({
  domain,
  siteData,
  showContext,
  setShowContext,
  contextStatus,
  planState,
  showPlanPanel,
  setShowPlanPanel,
  isReindexing,
  onReindex,
  onIndexSite,
  onNavigateBack,
  originDomain,
  isTaskActive,
}: {
  domain: string;
  siteData: SiteData;
  showContext: boolean;
  setShowContext: (v: boolean) => void;
  contextStatus: { used: number; limit: number; percent: number } | null;
  planState: {
    description: string;
    steps: { label: string; status: string }[];
  } | null;
  showPlanPanel: boolean;
  setShowPlanPanel: (v: boolean) => void;
  isReindexing: boolean;
  onReindex: () => void;
  onIndexSite: () => void;
  onNavigateBack: () => void;
  originDomain?: string;
  isTaskActive?: boolean;
}) {
  const isOnDifferentTab =
    isTaskActive && originDomain && originDomain !== domain;

  return (
    <>
      {isOnDifferentTab && (
        <div className="px-3 py-1.5 bg-blue-500/10 border-b border-blue-500/20 text-[11px] text-blue-400">
          Task running on <span className="font-semibold">{originDomain}</span>{' '}
          — actions routed to that tab
        </div>
      )}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <button
          type="button"
          onClick={onNavigateBack}
          className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary/50 flex-shrink-0"
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => setShowContext(!showContext)}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-xs font-medium text-foreground truncate">
            {domain}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {siteData.site?.totalElements ||
              siteData.pages.reduce((s, p) => s + p.elements.length, 0)}{' '}
            elements · {siteData.pages.length || siteData.site?.totalPages || 0}{' '}
            pages
          </p>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          {contextStatus && (
            <div
              className="relative w-6 h-6 flex-shrink-0 cursor-help"
              title={`Context: ${Math.round(contextStatus.used / 1000)}K / ${Math.round(contextStatus.limit / 1000)}K tokens (${contextStatus.percent}%)`}
            >
              <svg viewBox="0 0 24 24" className="w-6 h-6 -rotate-90">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-secondary"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeDasharray={`${contextStatus.percent * 0.628} 62.8`}
                  strokeLinecap="round"
                  className={
                    contextStatus.percent > 80
                      ? 'text-red-500'
                      : contextStatus.percent > 60
                        ? 'text-yellow-500'
                        : 'text-green-500'
                  }
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-muted-foreground">
                {contextStatus.percent}
              </span>
            </div>
          )}
          {contextStatus && contextStatus.percent > 60 && (
            <span
              className="text-[9px] text-yellow-500 cursor-help"
              title={`Context ${contextStatus.percent}% full. Start a new chat if the agent stops responding.`}
            >
              {contextStatus.percent > 80
                ? 'Compacting...'
                : `${contextStatus.percent}%`}
            </span>
          )}
          {planState && (
            <PlanHeaderButton
              planState={planState}
              showPlanPanel={showPlanPanel}
              onToggle={() => setShowPlanPanel(!showPlanPanel)}
            />
          )}
          <button
            type="button"
            onClick={onReindex}
            disabled={isReindexing}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 disabled:opacity-50"
            title="Re-index page"
          >
            <RefreshCw
              size={12}
              className={isReindexing ? 'animate-spin' : ''}
            />
          </button>
          <button
            type="button"
            onClick={onIndexSite}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50"
            title="Deep index site"
          >
            <Globe size={12} />
          </button>
          <button
            type="button"
            onClick={() => setShowContext(!showContext)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50"
            title={showContext ? 'Hide pages' : 'Show pages'}
          >
            <ChevronRight
              size={12}
              className={`transition-transform ${showContext ? 'rotate-90' : ''}`}
            />
          </button>
        </div>
      </div>
    </>
  );
}

function PlanHeaderButton({
  planState,
  showPlanPanel,
  onToggle,
}: {
  planState: {
    description: string;
    steps: { label: string; status: string }[];
  };
  showPlanPanel: boolean;
  onToggle: () => void;
}) {
  const completed = planState.steps.filter(
    s => s.status === 'completed',
  ).length;
  const failed = planState.steps.filter(s => s.status === 'failed').length;
  const running = planState.steps.some(s => s.status === 'in_progress');
  const total = planState.steps.length;
  const allDone = completed + failed === total && total > 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const ringColor = allDone
    ? failed > 0
      ? 'text-red-400'
      : 'text-green-400'
    : running
      ? 'text-blue-400'
      : 'text-muted-foreground';

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
        showPlanPanel
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
      }`}
      title={`Plan: ${completed}/${total} steps done`}
    >
      <div className="relative w-4 h-4 flex-shrink-0">
        <svg viewBox="0 0 20 20" className="w-4 h-4 -rotate-90">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-secondary"
          />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            strokeWidth="2.5"
            strokeDasharray={`${pct * 0.502} 50.2`}
            strokeLinecap="round"
            className={`${ringColor} transition-all duration-500`}
          />
        </svg>
        {allDone && !failed && (
          <CheckCircle2
            size={8}
            className="absolute inset-0 m-auto text-green-400"
          />
        )}
        {allDone && failed > 0 && (
          <AlertCircle
            size={8}
            className="absolute inset-0 m-auto text-red-400"
          />
        )}
        {running && (
          <Loader2
            size={7}
            className="absolute inset-0 m-auto text-blue-400 animate-spin"
          />
        )}
      </div>
      <span className="tabular-nums font-medium">
        {completed}/{total}
      </span>
      <ChevronDown
        size={10}
        className={`transition-transform ${showPlanPanel ? 'rotate-180' : ''}`}
      />
    </button>
  );
}

export function PlanPanel({
  planState,
  onClose,
}: {
  planState: {
    description: string;
    steps: { label: string; status: string }[];
  };
  onClose: () => void;
}) {
  const completed = planState.steps.filter(
    s => s.status === 'completed',
  ).length;
  const failed = planState.steps.filter(s => s.status === 'failed').length;
  const total = planState.steps.length;
  const allDone = completed + failed === total && total > 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="border-b border-border overflow-hidden">
      {/* Progress bar */}
      <div className="h-[2px] bg-secondary">
        <div
          className={`h-full transition-all duration-500 ease-out ${
            allDone
              ? failed > 0
                ? 'bg-red-500'
                : 'bg-green-500'
              : 'bg-blue-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="px-3.5 py-2.5">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-2">
          <ListChecks
            size={13}
            className="text-muted-foreground flex-shrink-0"
          />
          <p className="text-[11px] font-medium text-foreground flex-1 truncate leading-tight">
            {planState.description}
          </p>
          <span
            className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full ${
              allDone && !failed
                ? 'bg-green-500/15 text-green-400'
                : allDone && failed > 0
                  ? 'bg-red-500/15 text-red-400'
                  : 'bg-blue-500/15 text-blue-400'
            }`}
          >
            {completed}/{total}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground rounded transition-colors"
          >
            <X size={11} />
          </button>
        </div>

        {/* Steps */}
        <div className="space-y-0.5 max-h-36 overflow-y-auto">
          {planState.steps.map((step, i) => {
            const isCompleted = step.status === 'completed';
            const isRunning = step.status === 'in_progress';
            const isFailed = step.status === 'failed';
            const isPending = !isCompleted && !isRunning && !isFailed;

            return (
              <div
                key={`plan-step-${i}`}
                className={`flex items-center gap-2 px-2 py-1 rounded-md text-[11px] transition-all ${
                  isRunning ? 'bg-blue-500/8' : isFailed ? 'bg-red-500/8' : ''
                }`}
              >
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                  {isCompleted ? (
                    <CheckCircle2 size={13} className="text-green-400" />
                  ) : isRunning ? (
                    <Loader2 size={13} className="text-blue-400 animate-spin" />
                  ) : isFailed ? (
                    <AlertCircle size={13} className="text-red-400" />
                  ) : (
                    <div className="w-[7px] h-[7px] rounded-full border-[1.5px] border-muted-foreground/30" />
                  )}
                </span>
                <span
                  className={`flex-1 leading-tight ${
                    isCompleted
                      ? 'text-muted-foreground/60 line-through decoration-muted-foreground/30'
                      : isRunning
                        ? 'text-foreground font-medium'
                        : isFailed
                          ? 'text-red-400'
                          : isPending
                            ? 'text-muted-foreground'
                            : 'text-foreground'
                  }`}
                >
                  {step.label}
                </span>
                {isRunning && (
                  <span className="text-[9px] text-blue-400 font-medium flex-shrink-0">
                    running
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Completion footer */}
        {allDone && (
          <div
            className={`flex items-center gap-1.5 mt-2 pt-2 border-t border-border/50 text-[10px] font-medium ${
              failed > 0 ? 'text-red-400' : 'text-green-400'
            }`}
          >
            {failed > 0 ? (
              <>
                <AlertCircle size={11} />
                <span>
                  {completed} completed, {failed} failed
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 size={11} />
                <span>All {total} steps completed</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface BrowserTab {
  tabId: number;
  title: string;
  url: string;
  active: boolean;
}

function TabMentionPicker({
  visible,
  query,
  onSelect,
  onClose,
}: {
  visible: boolean;
  query: string;
  onSelect: (tab: BrowserTab) => void;
  onClose: () => void;
}) {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    // Get tabs from passive tab registry in background
    chrome.runtime.sendMessage({ type: 'GET_TABS' }, (response) => {
      if (response?.tabs) {
        setTabs(response.tabs);
      }
      setSelectedIndex(0);
    });
  }, [visible]);

  const filtered = tabs.filter((t) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q);
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Keyboard navigation handled by parent textarea onKeyDown
  // This component exposes selectedIndex and filtered list

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-[200px] overflow-y-auto bg-popover border border-border rounded-lg shadow-lg z-50"
    >
      <div className="py-1">
        <div className="px-3 py-1 text-[10px] text-muted-foreground font-mono uppercase">Open Tabs</div>
        {filtered.map((tab, i) => {
          const domain = (() => { try { return new URL(tab.url).hostname; } catch { return tab.url; } })();
          return (
            <button
              key={tab.tabId}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onSelect(tab); }}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent ${
                i === selectedIndex ? 'bg-accent' : ''
              }`}
            >
              <Globe size={12} className="text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{tab.title || domain}</span>
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{domain}</span>
              {tab.active && <span className="text-[9px] text-green-500">●</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ChatInput({
  input,
  setInput,
  isActive,
  chatMessages,
  selectedElements,
  selectorActive,
  chatInputRef,
  onSend,
  onStop,
  onToggleSelector,
  onNewConversation,
  onClearSelection,
}: {
  input: string;
  setInput: (v: string) => void;
  isActive: boolean;
  chatMessages: ChatMessage[];
  selectedElements: SelectedElement[];
  selectorActive: boolean;
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
  onStop: () => void;
  onToggleSelector: () => void;
  onNewConversation: () => void;
  onClearSelection: () => void;
}) {
  // @tab mention state
  const [showTabPicker, setShowTabPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionStartRef = useRef<number>(-1);
  return (
    <div className="p-3 border-t border-border">
      {selectedElements.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2 px-2 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-md">
          {selectedElements.length === 1 ? (
            <>
              <span className="text-xs text-blue-400 font-mono">
                &lt;{selectedElements[0].tag}&gt;
              </span>
              <span className="text-xs text-foreground truncate flex-1">
                {selectedElements[0].label || selectedElements[0].selector}
              </span>
            </>
          ) : (
            <span className="text-xs text-foreground flex-1">
              {selectedElements.length} elements selected
              <span className="text-muted-foreground ml-1">
                (
                {selectedElements
                  .map(e => e.tag)
                  .filter((t, i, a) => a.indexOf(t) === i)
                  .join(', ')}
                )
              </span>
            </span>
          )}
          <button
            onClick={onClearSelection}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <form
        onSubmit={e => {
          e.preventDefault();
          if (!showTabPicker) onSend();
        }}
        className="flex gap-2 items-center"
      >
        <div className="flex flex-col gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleSelector}
            title={selectorActive ? 'Cancel selector' : 'Select an element'}
            className={`flex items-center justify-center h-[40px] w-10 text-sm rounded-md border shrink-0 ${
              selectorActive
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-input text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            <MousePointer size={14} />
          </button>
        </div>
        <div className="relative flex-1 min-h-[40px] max-h-[120px] border border-input rounded-md bg-background focus-within:ring-2 focus-within:ring-ring">
          {/* Highlight overlay for @mentions — mirrors textarea position */}
          {input.includes('@[') && (
            <div
              className="absolute inset-0 py-2 pl-3 pr-10 text-sm pointer-events-none whitespace-pre-wrap break-words overflow-hidden"
              aria-hidden="true"
            >
              {input.split(/(@\[[^\]]+\])/g).map((part, i) =>
                part.startsWith('@[') ? (
                  <span key={i} className="bg-blue-500/20 text-blue-400 rounded px-0.5">{part}</span>
                ) : (
                  <span key={i} className="invisible">{part}</span>
                ),
              )}
            </div>
          )}
          <TabMentionPicker
            visible={showTabPicker}
            query={mentionQuery}
            onSelect={(tab) => {
              // Replace @query with @[Tab Title](tabId:N) mention
              const before = input.slice(0, mentionStartRef.current);
              const after = input.slice(chatInputRef.current?.selectionStart ?? input.length);
              const domain = (() => { try { return new URL(tab.url).hostname; } catch { return tab.url; } })();
              const mention = `@[${tab.title || domain}] `;
              setInput(before + mention + after);
              setShowTabPicker(false);
              setMentionQuery('');
              mentionStartRef.current = -1;
              chatInputRef.current?.focus();
            }}
            onClose={() => {
              setShowTabPicker(false);
              setMentionQuery('');
              mentionStartRef.current = -1;
            }}
          />
          <textarea
            ref={chatInputRef}
            value={input}
            onChange={e => {
              const val = e.target.value;
              setInput(val);
              // Detect @ trigger for tab mention
              const cursor = e.target.selectionStart;
              const textBefore = val.slice(0, cursor);
              const atMatch = textBefore.match(/@([^\s@]*)$/);
              if (atMatch) {
                mentionStartRef.current = cursor - atMatch[0].length;
                setMentionQuery(atMatch[1]);
                setShowTabPicker(true);
              } else {
                setShowTabPicker(false);
                setMentionQuery('');
              }
            }}
            onKeyDown={e => {
              if (showTabPicker) {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowTabPicker(false);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!showTabPicker && input.trim()) onSend();
              }
            }}
            placeholder={
              selectedElements.length > 0
                ? selectedElements.length === 1
                  ? `Instruct about this ${selectedElements[0].tag}...`
                  : `Instruct about ${selectedElements.length} elements...`
                : 'Ask anything... (type @ to mention a tab)'
            }
            disabled={isActive}
            rows={1}
            className="w-full min-h-[40px] max-h-[120px] py-2 pl-3 pr-10 text-sm resize-none border-0 bg-transparent focus:outline-none focus:ring-0 disabled:opacity-50 overflow-y-auto"
          />
          {!isActive && (
            <button
              type="submit"
              disabled={!input.trim()}
              title="Send"
              className="absolute right-1.5 bottom-1.5 p-1.5 rounded-md text-primary-foreground bg-primary hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        {isActive && (
          <button
            type="button"
            onClick={onStop}
            title="Stop"
            className="flex items-center justify-center h-[40px] w-10 text-sm font-medium text-red-400 border border-red-500/50 rounded-md hover:bg-red-500/10 shrink-0"
          >
            <div className="w-4 h-4 bg-red-400" />
          </button>
        )}
      </form>
    </div>
  );
}
