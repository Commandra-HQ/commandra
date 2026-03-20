/**
 * Layout sub-components for the ChatTab — context bar, plan panel, and input area.
 */

import type { SelectedElement } from '@afe/shared';
import {
	AlertCircle,
	ArrowLeft,
	Check,
	ChevronRight,
	Circle,
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
}: {
	domain: string;
	siteData: SiteData;
	showContext: boolean;
	setShowContext: (v: boolean) => void;
	contextStatus: { used: number; limit: number; percent: number } | null;
	planState: { description: string; steps: { label: string; status: string }[] } | null;
	showPlanPanel: boolean;
	setShowPlanPanel: (v: boolean) => void;
	isReindexing: boolean;
	onReindex: () => void;
	onIndexSite: () => void;
	onNavigateBack: () => void;
}) {
	return (
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
				<p className="text-xs font-medium text-foreground truncate">{domain}</p>
				<p className="text-[10px] text-muted-foreground">
					{siteData.site?.totalElements ||
						siteData.pages.reduce((s, p) => s + p.elements.length, 0)}{' '}
					elements · {siteData.pages.length || siteData.site?.totalPages || 0} pages
				</p>
			</button>
			<div className="flex items-center gap-1 flex-shrink-0">
				{contextStatus && (
					<div
						className="relative w-6 h-6 flex-shrink-0 cursor-help"
						title={`Context: ${Math.round(contextStatus.used / 1000)}K / ${Math.round(contextStatus.limit / 1000)}K tokens (${contextStatus.percent}%)`}
					>
						<svg viewBox="0 0 24 24" className="w-6 h-6 -rotate-90">
							<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-secondary" />
							<circle
								cx="12" cy="12" r="10" fill="none" strokeWidth="2.5"
								strokeDasharray={`${contextStatus.percent * 0.628} 62.8`}
								strokeLinecap="round"
								className={contextStatus.percent > 80 ? 'text-red-500' : contextStatus.percent > 60 ? 'text-yellow-500' : 'text-green-500'}
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
						{contextStatus.percent > 80 ? 'Compacting...' : `${contextStatus.percent}%`}
					</span>
				)}
				{planState && (
					<button
						type="button"
						onClick={() => setShowPlanPanel(!showPlanPanel)}
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 relative"
						title="View plan"
					>
						<ListChecks size={12} />
						<span className="absolute -top-0.5 -right-0.5 text-[8px] font-bold bg-primary text-primary-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center">
							{planState.steps.filter((s) => s.status === 'completed').length}/{planState.steps.length}
						</span>
					</button>
				)}
				<button
					type="button"
					onClick={onReindex}
					disabled={isReindexing}
					className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 disabled:opacity-50"
					title="Re-index page"
				>
					<RefreshCw size={12} className={isReindexing ? 'animate-spin' : ''} />
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
					<ChevronRight size={12} className={`transition-transform ${showContext ? 'rotate-90' : ''}`} />
				</button>
			</div>
		</div>
	);
}

export function PlanPanel({
	planState,
	onClose,
}: {
	planState: { description: string; steps: { label: string; status: string }[] };
	onClose: () => void;
}) {
	return (
		<div className="border-b border-border bg-secondary/20 px-4 py-3 space-y-2 max-h-48 overflow-y-auto">
			<div className="flex items-center justify-between">
				<p className="text-xs font-medium text-foreground">{planState.description}</p>
				<button type="button" onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground">
					<X size={10} />
				</button>
			</div>
			<div className="space-y-1">
				{planState.steps.map((step, i) => (
					<div key={`plan-step-${i}`} className="flex items-center gap-2 text-xs">
						{step.status === 'completed' ? (
							<Check size={12} className="text-green-500 flex-shrink-0" />
						) : step.status === 'in_progress' ? (
							<Loader2 size={12} className="text-blue-500 animate-spin flex-shrink-0" />
						) : step.status === 'failed' ? (
							<AlertCircle size={12} className="text-red-500 flex-shrink-0" />
						) : (
							<Circle size={12} className="text-muted-foreground flex-shrink-0" />
						)}
						<span className={step.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
							{step.label}
						</span>
					</div>
				))}
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
	return (
		<div className="p-3 border-t border-border">
			{chatMessages.length > 0 && !isActive && (
				<div className="flex justify-end mb-2">
					<button
						onClick={onNewConversation}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-secondary/50"
					>
						<Plus size={12} />
						New chat
					</button>
				</div>
			)}

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
								({selectedElements.map((e) => e.tag).filter((t, i, a) => a.indexOf(t) === i).join(', ')})
							</span>
						</span>
					)}
					<button onClick={onClearSelection} className="text-xs text-muted-foreground hover:text-foreground shrink-0">
						✕
					</button>
				</div>
			)}

			<form
				onSubmit={(e) => {
					e.preventDefault();
					onSend();
				}}
				className="flex gap-2 items-center"
			>
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
				<div className="relative flex-1 flex min-h-[40px] max-h-[120px] border border-input rounded-md bg-background focus-within:ring-2 focus-within:ring-ring">
					<textarea
						ref={chatInputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								if (input.trim()) onSend();
							}
						}}
						placeholder={
							selectedElements.length > 0
								? selectedElements.length === 1
									? `Instruct about this ${selectedElements[0].tag}...`
									: `Instruct about ${selectedElements.length} elements...`
								: 'Ask about this page...'
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
							<Send size={16} />
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
						<Square size={16} />
					</button>
				)}
			</form>
		</div>
	);
}
