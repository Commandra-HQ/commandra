/**
 * Sub-components for rendering chat message blocks.
 */

import {
	AlertCircle,
	Check,
	CheckCircle2,
	ChevronRight,
	Circle,
	Download,
	Globe,
	ListChecks,
	Loader2,
	Settings2,
	X,
} from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { CrawlProgress } from '@afe/shared';
import type { ChatMessage, MessageBlock, Plan, TOOL_LABELS as TL } from './chat-types.js';
import {
	TOOL_LABELS,
	TOOL_ICON_COMPONENTS,
	formatToolLabel,
	formatToolArgs,
	formatRelativeTime,
} from './chat-types.js';

// --- User & Assistant Messages ---

export function UserMessage({ msg }: { msg: ChatMessage }) {
	return (
		<div className="flex justify-end">
			<div className="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-primary text-primary-foreground">
				{msg.selectedElements && msg.selectedElements.length > 0 && (
					<div className="flex flex-wrap gap-1 mb-1.5">
						{msg.selectedElements.length === 1 ? (
							<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 text-xs font-mono">
								<span className="opacity-70">&lt;{msg.selectedElements[0].tag}&gt;</span>
								<span className="truncate max-w-[160px]">
									{msg.selectedElements[0].label || msg.selectedElements[0].selector}
								</span>
							</span>
						) : (
							msg.selectedElements.map((el, i) => (
								<span
									key={i}
									className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 text-xs font-mono"
								>
									<span className="opacity-70">&lt;{el.tag}&gt;</span>
									<span className="truncate max-w-[100px]">{el.label || el.selector}</span>
								</span>
							))
						)}
					</div>
				)}
				{msg.content}
			</div>
		</div>
	);
}

export function AssistantMessage({
	msg,
	isActive,
	onApprove,
}: {
	msg: ChatMessage;
	isActive: boolean;
	onApprove: (requestId: string, approved: boolean) => void;
}) {
	const rawBlocks = msg.blocks;

	if (!rawBlocks || rawBlocks.length === 0) {
		return null;
	}

	const blocks = rawBlocks.filter(
		(b, i) => b.type !== 'thinking' || b.content || i === rawBlocks.length - 1,
	);

	if (blocks.length === 0) return null;

	return (
		<div className="flex justify-start">
			<div className="max-w-[90%] space-y-2">
				{blocks.map((block, i) => {
					switch (block.type) {
						case 'thinking':
							return (
								<ThinkingBlock key={i} content={block.content} isLast={i === blocks.length - 1} />
							);
						case 'text': {
							if (block.content.startsWith('__approval__:')) {
								const parts = block.content.split(':');
								const approvalType = parts[1];
								const requestId = parts[2];
								if (approvalType === 'plan') {
									const desc = parts[3];
									const steps = parts[4]?.split('|') || [];
									return (
										<InlineApprovalBlock
											key={i}
											requestId={requestId}
											type="plan"
											description={desc}
											steps={steps}
											onApprove={onApprove}
										/>
									);
								}
								const action = parts[3];
								const label = parts[4];
								const reason = parts[5];
								return (
									<InlineApprovalBlock
										key={i}
										requestId={requestId}
										type="tool"
										action={action}
										label={label}
										reason={reason}
										onApprove={onApprove}
									/>
								);
							}
							return <TextBlock key={i} content={block.content} />;
						}
						case 'tool_call':
							return <ToolCallBlock key={i} block={block} />;
						case 'sub_agent':
							return <SubAgentBlock key={i} block={block} />;
						case 'blocked':
							return <BlockedBlock key={i} toolName={block.toolName} reason={block.reason} />;
						case 'plan':
							return <PlanBlock key={i} plan={block.plan} />;
						default:
							return null;
					}
				})}

				{blocks.length === 0 && isActive && <ThinkingBlock content="" isLast />}
			</div>
		</div>
	);
}

// --- Block components ---

export function ThinkingBlock({ content, isLast }: { content: string; isLast: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const hasContent = content.length > 0;
	const showContent = expanded || (isLast && hasContent);

	return (
		<div className="text-xs text-muted-foreground py-1">
			<button
				type="button"
				className="flex items-center gap-2 hover:text-foreground transition-colors"
				onClick={() => hasContent && setExpanded(!expanded)}
			>
				{isLast && !content ? (
					<Loader2 size={12} className="animate-spin shrink-0" />
				) : isLast && hasContent ? (
					<Loader2 size={12} className="animate-spin shrink-0" />
				) : (
					<ChevronRight
						size={12}
						className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
					/>
				)}
				<span>Thinking{isLast && hasContent ? '...' : ''}</span>
			</button>
			{showContent && hasContent && (
				<div className="mt-1 ml-5 text-[11px] text-muted-foreground/70 whitespace-pre-wrap max-h-[200px] overflow-y-auto leading-relaxed">
					{content}
				</div>
			)}
		</div>
	);
}

export function TextBlock({ content }: { content: string }) {
	if (!content.trim()) return null;
	return (
		<div className="rounded-lg px-3 py-2 text-sm bg-secondary text-foreground prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1 prose-code:text-xs">
			<ReactMarkdown>{content}</ReactMarkdown>
		</div>
	);
}

export function InlineApprovalBlock({
	requestId,
	type,
	action,
	label,
	reason,
	description,
	steps,
	onApprove,
}: {
	requestId: string;
	type: 'tool' | 'plan';
	action?: string;
	label?: string;
	reason?: string;
	description?: string;
	steps?: string[];
	onApprove: (requestId: string, approved: boolean) => void;
}) {
	const [responded, setResponded] = useState<'approved' | 'rejected' | null>(null);

	const handleClick = (approved: boolean) => {
		onApprove(requestId, approved);
		setResponded(approved ? 'approved' : 'rejected');
	};

	if (responded) {
		return (
			<div className={`rounded-md px-3 py-2 text-xs border ${responded === 'approved' ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
				{responded === 'approved' ? (
					<span className="text-green-500 font-medium">Approved</span>
				) : (
					<span className="text-red-500 font-medium">Rejected</span>
				)}
				{type === 'tool' && <span className="text-muted-foreground"> — {TOOL_LABELS[action || ''] || action}{label ? ` "${label}"` : ''}</span>}
				{type === 'plan' && <span className="text-muted-foreground"> — {description}</span>}
			</div>
		);
	}

	return (
		<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2.5 space-y-2">
			{type === 'tool' ? (
				<>
					<p className="text-xs font-medium text-foreground">
						Agent wants to:{' '}
						<span className="font-semibold">{TOOL_LABELS[action || ''] || action}</span>
						{label ? ` "${label}"` : ''}
					</p>
					{reason && <p className="text-[11px] text-muted-foreground">{reason}</p>}
				</>
			) : (
				<>
					<p className="text-xs font-semibold text-foreground">Plan: {description}</p>
					{steps && steps.length > 0 && (
						<ol className="list-decimal list-inside space-y-0.5 pl-1">
							{steps.map((s, i) => (
								<li key={`step-${i}`} className="text-xs text-foreground">{s}</li>
							))}
						</ol>
					)}
				</>
			)}
			<div className="flex gap-2">
				<button
					onClick={() => handleClick(true)}
					className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700"
				>
					{type === 'plan' ? 'Approve Plan' : 'Approve'}
				</button>
				<button
					onClick={() => handleClick(false)}
					className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700"
				>
					Reject
				</button>
			</div>
		</div>
	);
}

export function ToolCallBlock({
	block,
}: {
	block: Extract<MessageBlock, { type: 'tool_call' }>;
}) {
	const [expanded, setExpanded] = useState(false);
	const IconComponent = TOOL_ICON_COMPONENTS[block.toolName] || Settings2;
	const label = formatToolLabel(block.toolName, block.label);
	const argsPreview = formatToolArgs(block.toolName, block.args);

	const statusColor =
		block.status === 'running'
			? 'border-blue-500/40 bg-blue-500/5'
			: block.status === 'success'
				? 'border-green-500/30 bg-green-500/5'
				: 'border-red-500/30 bg-red-500/5';

	const statusIcon =
		block.status === 'running' ? (
			<Loader2 size={12} className="text-blue-400 animate-spin shrink-0" />
		) : block.status === 'success' ? (
			<Check size={12} className="text-green-400 shrink-0" />
		) : (
			<X size={12} className="text-red-400 shrink-0" />
		);

	return (
		<div className={`border rounded-md text-xs ${statusColor}`}>
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
			>
				<IconComponent size={13} className="shrink-0 text-muted-foreground" />
				<span className="flex-1 truncate text-foreground">
					{label}
					{argsPreview && (
						<span className="text-muted-foreground ml-1 font-mono">{argsPreview}</span>
					)}
				</span>
				{statusIcon}
			</button>

			{expanded && (
				<div className="px-2.5 pb-2 space-y-1.5 border-t border-border/30 pt-1.5">
					{block.args && (
						<div>
							<span className="text-muted-foreground">Args: </span>
							<code className="text-[10px] text-foreground/70 font-mono break-all">
								{JSON.stringify(block.args)}
							</code>
						</div>
					)}
					{block.error && <div className="text-red-400">Error: {String(block.error)}</div>}
					{block.result != null && !block.screenshot && (
						<div>
							<span className="text-muted-foreground">Result: </span>
							<code className="text-[10px] text-foreground/70 font-mono break-all">
								{typeof block.result === 'string'
									? block.result.slice(0, 300)
									: JSON.stringify(block.result).slice(0, 300)}
							</code>
						</div>
					)}
				</div>
			)}

			{typeof block.screenshot === 'string' && (
				<div className="px-2.5 pb-2">
					<img
						src={`data:image/jpeg;base64,${block.screenshot}`}
						alt="Screenshot"
						className="rounded border border-border/30 max-h-40 w-full object-contain cursor-pointer"
						onClick={() => {
							const img = new Image();
							img.src = `data:image/jpeg;base64,${block.screenshot}`;
							const w = window.open('');
							w?.document.body.appendChild(img);
						}}
					/>
				</div>
			)}

			{block.toolName === 'export_data' && block.status === 'success' && block.result != null && (
				<div className="px-2.5 pb-2">
					<button
						onClick={() => {
							const r = block.result as { content?: string; filename?: string; format?: string };
							if (!r.content) return;
							const mimeType = r.format === 'json' ? 'application/json' : 'text/csv';
							const blob = new Blob([r.content], { type: mimeType });
							const url = URL.createObjectURL(blob);
							const a = document.createElement('a');
							a.href = url;
							a.download = r.filename || 'export.csv';
							a.click();
							URL.revokeObjectURL(url);
						}}
						className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground bg-secondary border border-border rounded hover:bg-secondary/80"
					>
						<Download size={13} />
						<span>Download {(block.result as { filename?: string }).filename || 'export'}</span>
					</button>
				</div>
			)}
		</div>
	);
}

export function SubAgentBlock({
	block,
}: {
	block: Extract<MessageBlock, { type: 'sub_agent' }>;
}) {
	const [expanded, setExpanded] = useState(false);
	const statusColor =
		block.status === 'running'
			? 'border-purple-500/40 bg-purple-500/5'
			: block.status === 'success'
				? 'border-green-500/30 bg-green-500/5'
				: 'border-red-500/30 bg-red-500/5';

	const statusIcon =
		block.status === 'running' ? (
			<Loader2 size={12} className="text-purple-400 animate-spin shrink-0" />
		) : block.status === 'success' ? (
			<Check size={12} className="text-green-400 shrink-0" />
		) : (
			<X size={12} className="text-red-400 shrink-0" />
		);

	let domain = block.targetUrl;
	try {
		domain = new URL(block.targetUrl).hostname;
	} catch {
		/* keep full url */
	}

	return (
		<div className={`border rounded-md text-xs ${statusColor}`}>
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
			>
				<Globe size={13} className="shrink-0 text-purple-400" />
				<span className="flex-1 truncate text-foreground">
					<span className="font-medium text-purple-300">Sub-agent</span>
					<span className="text-muted-foreground ml-1">on {domain}</span>
				</span>
				{block.actions.length > 0 && (
					<span className="text-muted-foreground text-[10px]">
						{block.actions.length} action{block.actions.length !== 1 ? 's' : ''}
					</span>
				)}
				{statusIcon}
			</button>

			{expanded && (
				<div className="px-2.5 pb-2 space-y-1.5 border-t border-border/30 pt-1.5">
					<div>
						<span className="text-muted-foreground">Task: </span>
						<span className="text-foreground/80">{block.task}</span>
					</div>
					{block.actions.length > 0 && (
						<div className="space-y-1">
							{block.actions.map((action, j) => (
								<ToolCallBlock
									key={j}
									block={{
										type: 'tool_call',
										toolName: action.toolName,
										label: action.label,
										status: action.status,
										args: action.args,
										result: action.result,
										error: action.error,
										screenshot: action.screenshot,
									}}
								/>
							))}
						</div>
					)}
					{block.summary && (
						<div>
							<span className="text-muted-foreground">Result: </span>
							<span className="text-foreground/80">{block.summary.slice(0, 300)}</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function BlockedBlock({ toolName, reason }: { toolName: string; reason: string }) {
	return (
		<div className="border border-red-500/30 bg-red-500/5 rounded-md px-2.5 py-1.5 text-xs">
			<span className="text-red-400 font-medium">Blocked: </span>
			<span className="text-foreground">{TOOL_LABELS[toolName] || toolName}</span>
			<span className="text-muted-foreground"> — {reason}</span>
		</div>
	);
}

export function PlanBlock({ plan }: { plan: Plan }) {
	const statuses = plan.stepStatus || plan.steps.map(() => 'pending' as const);
	const doneCount = statuses.filter((s) => s === 'done').length;
	const errorCount = statuses.filter((s) => s === 'error').length;
	const hasStarted = statuses.some((s) => s !== 'pending');
	const allDone = doneCount + errorCount === plan.steps.length && plan.steps.length > 0;
	const pct = plan.steps.length > 0 ? Math.round((doneCount / plan.steps.length) * 100) : 0;

	return (
		<div className="rounded-lg border border-border overflow-hidden">
			{/* Progress bar */}
			<div className="h-[2px] bg-secondary">
				<div
					className={`h-full transition-all duration-500 ease-out ${
						allDone
							? errorCount > 0
								? 'bg-red-500'
								: 'bg-green-500'
							: 'bg-blue-500'
					}`}
					style={{ width: `${pct}%` }}
				/>
			</div>

			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2 bg-secondary/30">
				<ListChecks size={13} className="text-muted-foreground flex-shrink-0" />
				<span className="text-[11px] font-medium text-foreground flex-1 truncate">
					{plan.description || 'Execution Plan'}
				</span>
				<span className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full ${
					allDone && !errorCount
						? 'bg-green-500/15 text-green-400'
						: allDone && errorCount > 0
							? 'bg-red-500/15 text-red-400'
							: 'bg-blue-500/15 text-blue-400'
				}`}>
					{doneCount}/{plan.steps.length}
				</span>
			</div>

			{/* Steps */}
			<div className="px-3 py-2 space-y-0.5">
				{plan.steps.map((step, i) => {
					const status = statuses[i] || 'pending';
					const isCompleted = status === 'done';
					const isRunning = status === 'running';
					const isFailed = status === 'error';
					const isPending = status === 'pending';

					return (
						<div
							key={i}
							className={`flex items-center gap-2 px-2 py-1 rounded-md text-[11px] transition-all ${
								isRunning
									? 'bg-blue-500/8'
									: isFailed
										? 'bg-red-500/8'
										: ''
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
												: isPending && hasStarted
													? 'text-muted-foreground'
													: 'text-foreground'
								}`}
							>
								{step}
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
				<div className={`flex items-center gap-1.5 px-3 py-2 border-t border-border/50 text-[10px] font-medium ${
					errorCount > 0 ? 'text-red-400' : 'text-green-400'
				}`}>
					{errorCount > 0 ? (
						<>
							<AlertCircle size={11} />
							<span>{doneCount} completed, {errorCount} failed</span>
						</>
					) : (
						<>
							<CheckCircle2 size={11} />
							<span>All {plan.steps.length} steps completed</span>
						</>
					)}
				</div>
			)}
		</div>
	);
}

// --- Views ---

export function OnboardingView({
	domain,
	pathScope,
	onIndexPage,
	onIndexSite,
}: {
	domain: string;
	pathScope: string;
	onIndexPage: () => void;
	onIndexSite: () => void;
}) {
	const scopeLabel = pathScope === '/' ? domain : `${domain}${pathScope}`;

	return (
		<div className="p-4 space-y-4">
			<div>
				<h3 className="text-sm font-semibold text-foreground">Teach the agent about this app</h3>
				<p className="text-xs text-muted-foreground mt-1">
					Index <span className="font-medium text-foreground">{scopeLabel}</span> so the agent can
					understand its pages, buttons, forms, and navigation.
				</p>
			</div>

			<div className="space-y-2">
				<button
					onClick={onIndexSite}
					className="w-full py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:opacity-90"
				>
					Index Section
				</button>
				<p className="text-xs text-muted-foreground text-center">
					Crawls pages under <span className="font-mono">{pathScope}</span> in the background
				</p>
			</div>

			<div className="relative">
				<div className="absolute inset-0 flex items-center">
					<div className="w-full border-t border-border" />
				</div>
				<div className="relative flex justify-center text-xs">
					<span className="bg-background px-2 text-muted-foreground">or</span>
				</div>
			</div>

			<div className="space-y-2">
				<button
					onClick={onIndexPage}
					className="w-full py-2 text-sm font-medium text-foreground border border-border rounded-md hover:bg-secondary"
				>
					Index This Page Only
				</button>
				<p className="text-xs text-muted-foreground text-center">
					Quick — indexes just the current page (instant)
				</p>
			</div>
		</div>
	);
}

export function CrawlingView({
	progress,
	domain,
	onStop,
}: {
	progress: CrawlProgress | null;
	domain: string;
	onStop: () => void;
}) {
	const indexed = progress?.pagesIndexed ?? 0;
	const discovered = progress?.pagesDiscovered ?? 0;
	const pct = discovered > 0 ? Math.round((indexed / discovered) * 100) : 0;

	return (
		<div className="p-4 space-y-4">
			<div>
				<h3 className="text-sm font-semibold text-foreground">Indexing {domain}</h3>
				<p className="text-xs text-muted-foreground mt-1">
					Crawling pages in the background. You can keep working.
				</p>
			</div>

			<div className="space-y-2">
				<div className="flex justify-between text-xs text-muted-foreground">
					<span>{indexed} pages indexed</span>
					<span>{discovered} discovered</span>
				</div>
				<div className="h-2 bg-secondary rounded-full overflow-hidden">
					<div
						className="h-full bg-foreground rounded-full transition-all duration-500"
						style={{ width: `${pct}%` }}
					/>
				</div>
				{progress?.currentUrl && (
					<p className="text-xs text-muted-foreground truncate">
						{new URL(progress.currentUrl).pathname}
					</p>
				)}
			</div>

			<button
				onClick={onStop}
				className="w-full py-2 text-sm text-muted-foreground border border-border rounded-md hover:bg-secondary"
			>
				Stop Crawl
			</button>
		</div>
	);
}
