/**
 * Layout sub-components for the ChatTab — context bar, plan panel, and input area.
 */

import type { SelectedElement } from '@commandra/shared';
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
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
      className={`flex items-center gap-1.5 px-2 py-1 text-xs transition-colors ${
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
            className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 ${
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
            className="p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
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
                className={`flex items-center gap-2 px-2 py-1 text-[11px] transition-all ${
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
                    <div className="w-[7px] h-[7px] border-[1.5px] border-muted-foreground/30" />
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
  domain: string;
  active: boolean;
}

/**
 * Tab suggestion list component — rendered by Tiptap's Mention extension
 * as a floating dropdown when the user types @.
 */
const TabSuggestionList = React.forwardRef(
  (
    props: {
      items: BrowserTab[];
      command: (item: { id: string; label: string }) => void;
    },
    ref: React.Ref<{ onKeyDown: (event: { event: KeyboardEvent }) => boolean }>,
  ) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => { setSelectedIndex(0); }, [props.items]);

    React.useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => (i + props.items.length - 1) % props.items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => (i + 1) % props.items.length);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = props.items[selectedIndex];
          if (item) props.command({ id: String(item.tabId), label: item.title || item.domain });
          return true;
        }
        return false;
      },
    }));

    if (props.items.length === 0) return null;

    return (
      <div className="max-h-[200px] overflow-y-auto bg-background border border-border rounded-md shadow-xl">
        <div className="py-1">
          <div className="px-3 py-1 text-[10px] text-muted-foreground font-mono uppercase">
            Open Tabs
          </div>
          {props.items.map((tab, i) => (
            <button
              key={tab.tabId}
              type="button"
              onClick={() => props.command({ id: String(tab.tabId), label: tab.title || tab.domain })}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent ${
                i === selectedIndex ? 'bg-accent' : ''
              }`}
            >
              <Globe size={12} className="text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{tab.title || tab.domain}</span>
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{tab.domain}</span>
              {tab.active && <span className="text-[9px] text-green-500">active</span>}
            </button>
          ))}
        </div>
      </div>
    );
  },
);

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
  // Tiptap editor instance with mention extension for @tab picker
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable features we don't need for chat input
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: selectedElements.length > 0
          ? selectedElements.length === 1
            ? `Instruct about this ${selectedElements[0].tag}...`
            : `Instruct about ${selectedElements.length} elements...`
          : 'Ask anything... type @ to mention a tab',
      }),
      Mention.configure({
        HTMLAttributes: {
          class: 'mention-tab',
        },
        suggestion: {
          items: ({ query }: { query: string }) => {
            return new Promise<BrowserTab[]>((resolve) => {
              chrome.runtime.sendMessage({ type: 'GET_TABS' }, (response) => {
                const tabs: BrowserTab[] = response?.tabs || [];
                const q = query.toLowerCase();
                resolve(q ? tabs.filter((t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) : tabs);
              });
            });
          },
          render: () => {
            let popup: HTMLDivElement | null = null;
            let reactRoot: ReturnType<typeof import('react-dom/client').createRoot> | null = null;
            let currentProps: { items: BrowserTab[]; command: (item: { id: string; label: string }) => void } | null = null;
            const componentRef = React.createRef<{ onKeyDown: (e: { event: KeyboardEvent }) => boolean }>();

            const renderPopup = () => {
              if (!popup || !currentProps) return;
              if (!reactRoot) {
                // biome-ignore lint: we need createRoot
                import('react-dom/client').then(({ createRoot }) => {
                  reactRoot = createRoot(popup!);
                  reactRoot.render(
                    <TabSuggestionList ref={componentRef} items={currentProps!.items} command={currentProps!.command} />,
                  );
                });
              } else {
                reactRoot.render(
                  <TabSuggestionList ref={componentRef} items={currentProps!.items} command={currentProps!.command} />,
                );
              }
            };

            return {
              onStart: (props: unknown) => {
                const p = props as { editor: { view: { dom: HTMLElement } }; items: BrowserTab[]; command: (item: { id: string; label: string }) => void };
                currentProps = { items: p.items, command: p.command };
                popup = document.createElement('div');
                popup.style.position = 'absolute';
                popup.style.bottom = '100%';
                popup.style.left = '0';
                popup.style.right = '0';
                popup.style.marginBottom = '4px';
                popup.style.zIndex = '9999';
                const parent = p.editor.view.dom.closest('.chat-editor-wrapper');
                if (parent) parent.appendChild(popup);
                renderPopup();
              },
              onUpdate: (props: unknown) => {
                const p = props as { items: BrowserTab[]; command: (item: { id: string; label: string }) => void };
                currentProps = { items: p.items, command: p.command };
                renderPopup();
              },
              onKeyDown: (props: unknown) => {
                const p = props as { event: KeyboardEvent };
                if (p.event.key === 'Escape') { popup?.remove(); return true; }
                return componentRef.current?.onKeyDown({ event: p.event }) ?? false;
              },
              onExit: () => {
                reactRoot?.unmount();
                popup?.remove();
                popup = null;
                reactRoot = null;
              },
            };
          },
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'w-full min-h-10 max-h-[120px] py-2 pl-3 pr-10 text-sm bg-transparent focus:outline-none overflow-y-auto leading-6',
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Build text with inline mention markers: @[Title](tabId:N)
      // This format is parseable by the message renderer AND the agent
      let result = '';
      ed.state.doc.descendants((node) => {
        if (node.isText) {
          result += node.text;
        } else if (node.type.name === 'mention' && node.attrs.id) {
          result += `@[${node.attrs.label || ''}](tabId:${node.attrs.id})`;
        } else if (node.type.name === 'paragraph') {
          if (result.length > 0) result += '\n';
        }
      });
      setInput(result.trim());
    },
    immediatelyRender: false,
    editable: !isActive,
  });

  // Sync editable state
  useEffect(() => {
    if (editor) editor.setEditable(!isActive);
  }, [isActive, editor]);

  // Clear editor when input is externally cleared (new conversation)
  useEffect(() => {
    if (editor && input === '' && editor.getText() !== '') {
      editor.commands.clearContent();
    }
  }, [input, editor]);

  // Enter = send, Shift+Enter = newline (like Cursor)
  useEffect(() => {
    if (!editor) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (event.shiftKey) return; // Allow Shift+Enter for newlines
      if (isActive) return;

      // Don't intercept if the mention suggestion popup is open
      const popup = document.querySelector('.chat-editor-wrapper > div[style*="position: absolute"]');
      if (popup) return;

      event.preventDefault();
      event.stopPropagation();
      const text = editor.getText().trim();
      if (text) onSend();
    };
    // Use capture phase to intercept before Tiptap's own Enter handler (which inserts a paragraph)
    const editorDom = editor.view.dom;
    editorDom.addEventListener('keydown', handler, true);
    return () => editorDom.removeEventListener('keydown', handler, true);
  }, [editor, isActive, onSend]);

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

      <div className="flex gap-2 items-end">
        <button
          type="button"
          onClick={onToggleSelector}
          title={selectorActive ? 'Cancel selector' : 'Select an element'}
          className={`flex items-center justify-center h-10 w-10 text-sm rounded-md border shrink-0 ${
            selectorActive
              ? 'border-blue-500 bg-blue-500/10 text-blue-400'
              : 'border-input text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
        >
          <MousePointer size={14} />
        </button>
        <div className="chat-editor-wrapper relative flex-1 min-h-10 max-h-[120px] border border-input rounded-md bg-background focus-within:border-foreground overflow-visible">
          <EditorContent editor={editor} />
          {!isActive && (
            <button
              type="button"
              onClick={() => { if (editor?.getText().trim()) onSend(); }}
              disabled={!editor?.getText().trim()}
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
            className="flex items-center justify-center h-10 w-10 text-sm font-medium text-red-400 border border-red-500/50 rounded-md hover:bg-red-500/10 shrink-0"
          >
            <div className="w-4 h-4 bg-red-400" />
          </button>
        )}
      </div>

      {/* Mention chip styles */}
      <style>{`
        .mention-tab {
          background: hsl(var(--muted));
          border: 1px solid hsl(var(--border));
          color: hsl(var(--foreground));
          border-radius: 2px;
          padding: 1px 5px;
          font-size: 0.8em;
          font-family: ui-monospace, monospace;
          font-weight: 500;
          white-space: nowrap;
        }
        .chat-editor-wrapper .tiptap {
          outline: none;
        }
        .chat-editor-wrapper .tiptap p {
          margin: 0;
        }
        .chat-editor-wrapper .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          height: 0;
        }
      `}</style>
    </div>
  );
}
