import type { Flow, FlowParameter, FlowStep, SSEEvent } from '@afe/shared';
import {
	ArrowRight,
	Camera,
	Check,
	ChevronLeft,
	ChevronRight,
	Clock,
	FileDown,
	Keyboard,
	List,
	Loader2,
	MousePointer,
	MoveVertical,
	Pilcrow,
	Play,
	Settings2,
	Square,
	Table2,
	Trash2,
	X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const API_URL = process.env.API_URL || 'http://localhost:3001';

type FlowView = 'list' | 'detail' | 'running';

interface FlowListItem {
	id: string;
	name: string;
	description?: string;
	domain: string;
	status: string;
	stepCount: number;
	steps: FlowStep[];
	parameters: FlowParameter[];
	lastRunAt?: string;
	createdAt: string;
}

interface FlowRunSummary {
	id: string;
	status: string;
	stepsCompleted: number;
	totalSteps: number;
	error?: string;
	startedAt: string;
	completedAt?: string;
}

const TOOL_ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
	click_element: MousePointer,
	type_text: Keyboard,
	select_option: List,
	navigate: ArrowRight,
	screenshot: Camera,
	scroll: MoveVertical,
	read_text: Pilcrow,
	read_table: Table2,
	export_data: FileDown,
	wait_for_element: Clock,
};

function parseSSEBuffer(buffer: string): [SSEEvent[], string] {
	const events: SSEEvent[] = [];
	const frames = buffer.split('\n\n');
	const remaining = frames.pop()!;
	for (const frame of frames) {
		for (const line of frame.split('\n')) {
			if (line.startsWith('data: ')) {
				try {
					events.push(JSON.parse(line.slice(6)) as SSEEvent);
				} catch {}
			}
		}
	}
	return [events, remaining];
}

export function FlowsTab() {
	const [view, setView] = useState<FlowView>('list');
	const [flows, setFlows] = useState<FlowListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedFlow, setSelectedFlow] = useState<FlowListItem | null>(null);
	const [runs, setRuns] = useState<FlowRunSummary[]>([]);
	const [paramValues, setParamValues] = useState<Record<string, string>>({});

	// Execution state
	const [isRunning, setIsRunning] = useState(false);
	const [executionLog, setExecutionLog] = useState<string[]>([]);
	const [stepStatus, setStepStatus] = useState<Record<number, 'pending' | 'running' | 'success' | 'error'>>({});
	const abortRef = useRef<AbortController | null>(null);
	const logEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		loadFlows();
	}, []);

	useEffect(() => {
		logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [executionLog]);

	async function getToken(): Promise<string> {
		const stored = await chrome.storage.local.get(['authToken']);
		return stored.authToken || '';
	}

	async function loadFlows() {
		setLoading(true);
		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/flows`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				setFlows(data.flows || []);
			}
		} catch (err) {
			console.error('Failed to load flows:', err);
		} finally {
			setLoading(false);
		}
	}

	async function openFlow(flow: FlowListItem) {
		setSelectedFlow(flow);
		setView('detail');

		// Initialize parameter values with defaults
		const params = (flow.parameters || []) as FlowParameter[];
		const defaults: Record<string, string> = {};
		for (const p of params) {
			defaults[p.name] = p.defaultValue || '';
		}
		setParamValues(defaults);

		// Load runs
		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/flows/${flow.id}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				setRuns(data.runs || []);
			}
		} catch {}
	}

	async function deleteFlow(flowId: string) {
		try {
			const token = await getToken();
			await fetch(`${API_URL}/api/flows/${flowId}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			});
			setFlows((prev) => prev.filter((f) => f.id !== flowId));
			if (selectedFlow?.id === flowId) {
				setSelectedFlow(null);
				setView('list');
			}
		} catch (err) {
			console.error('Failed to delete flow:', err);
		}
	}

	async function executeFlow() {
		if (!selectedFlow) return;

		setView('running');
		setIsRunning(true);
		setExecutionLog([]);

		// Initialize step statuses
		const steps = selectedFlow.steps || [];
		const initial: Record<number, 'pending'> = {};
		for (const step of steps) {
			initial[step.index] = 'pending';
		}
		setStepStatus(initial);

		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/flows/${selectedFlow.id}/run`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ parameterValues: paramValues }),
				signal: controller.signal,
			});

			if (!res.ok) {
				setExecutionLog((prev) => [...prev, `Error: API returned ${res.status}`]);
				setIsRunning(false);
				return;
			}

			const reader = res.body?.getReader();
			const decoder = new TextDecoder();

			if (reader) {
				let buffer = '';
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const [events, remaining] = parseSSEBuffer(buffer);
					buffer = remaining;

					for (const event of events) {
						switch (event.type) {
							case 'text_delta':
								setExecutionLog((prev) => {
									const last = prev[prev.length - 1];
									if (last !== undefined && !last.startsWith('[')) {
										return [...prev.slice(0, -1), last + event.text];
									}
									return [...prev, event.text];
								});
								break;

							case 'tool_start':
								setExecutionLog((prev) => [
									...prev,
									`[${event.toolName}] ${event.label || ''}`,
								]);
								break;

							case 'tool_end':
								if (!event.success) {
									setExecutionLog((prev) => [
										...prev,
										`[Error] ${event.error || 'Tool failed'}`,
									]);
								}
								break;

							case 'flow_step_end':
								setStepStatus((prev) => ({
									...prev,
									[event.stepIndex]: event.success ? 'success' : 'error',
								}));
								break;

							case 'flow_done':
								setExecutionLog((prev) => [
									...prev,
									event.success ? '[Done] Flow completed successfully' : '[Done] Flow finished with errors',
								]);
								break;

							case 'blocked':
								setExecutionLog((prev) => [
									...prev,
									`[Blocked] ${event.toolName}: ${event.reason}`,
								]);
								break;

							case 'error':
								setExecutionLog((prev) => [...prev, `[Error] ${event.message}`]);
								break;
						}
					}
				}
			}
		} catch (err) {
			if (!controller.signal.aborted) {
				setExecutionLog((prev) => [...prev, '[Error] Connection lost']);
			}
		} finally {
			setIsRunning(false);
			abortRef.current = null;
			// Refresh runs
			if (selectedFlow) {
				try {
					const token = await getToken();
					const res = await fetch(`${API_URL}/api/flows/${selectedFlow.id}`, {
						headers: { Authorization: `Bearer ${token}` },
					});
					if (res.ok) {
						const data = await res.json();
						setRuns(data.runs || []);
					}
				} catch {}
			}
		}
	}

	function handleStop() {
		abortRef.current?.abort();
		setIsRunning(false);
	}

	// --- Views ---

	if (loading) {
		return (
			<div className="p-4 flex items-center gap-2">
				<Loader2 size={14} className="animate-spin text-muted-foreground" />
				<span className="text-sm text-muted-foreground">Loading flows...</span>
			</div>
		);
	}

	if (view === 'running' && selectedFlow) {
		return (
			<div className="flex flex-col h-full">
				{/* Header */}
				<div className="px-4 py-3 border-b border-border">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-foreground truncate">{selectedFlow.name}</h2>
						{isRunning ? (
							<button
								onClick={handleStop}
								className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-400 border border-red-500/50 rounded hover:bg-red-500/10"
							>
								<Square size={10} />
								Stop
							</button>
						) : (
							<button
								onClick={() => setView('detail')}
								className="text-xs text-muted-foreground hover:text-foreground"
							>
								Back
							</button>
						)}
					</div>
				</div>

				{/* Step progress */}
				<div className="px-4 py-2 border-b border-border space-y-1">
					{selectedFlow.steps.map((step) => {
						const status = stepStatus[step.index] || 'pending';
						return (
							<div key={step.index} className="flex items-center gap-2 text-xs">
								{status === 'success' ? (
									<Check size={12} className="text-green-500 shrink-0" />
								) : status === 'error' ? (
									<X size={12} className="text-red-500 shrink-0" />
								) : status === 'running' ? (
									<Loader2 size={12} className="animate-spin text-blue-400 shrink-0" />
								) : (
									<div className="w-3 h-3 rounded-full border border-border shrink-0" />
								)}
								<span
									className={
										status === 'success'
											? 'text-foreground'
											: status === 'error'
												? 'text-red-400'
												: 'text-muted-foreground'
									}
								>
									{step.intent}
								</span>
							</div>
						);
					})}
				</div>

				{/* Execution log */}
				<div className="flex-1 overflow-y-auto p-4 space-y-1">
					{executionLog.map((line, i) => (
						<p
							key={i}
							className={`text-xs whitespace-pre-wrap ${
								line.startsWith('[Error]') || line.startsWith('[Blocked]')
									? 'text-red-400'
									: line.startsWith('[Done]')
										? 'text-green-400 font-medium'
										: line.startsWith('[')
											? 'text-muted-foreground'
											: 'text-foreground'
							}`}
						>
							{line}
						</p>
					))}
					<div ref={logEndRef} />
				</div>
			</div>
		);
	}

	if (view === 'detail' && selectedFlow) {
		const params = (selectedFlow.parameters || []) as FlowParameter[];

		return (
			<div className="flex flex-col h-full">
				{/* Header */}
				<div className="px-4 py-3 border-b border-border">
					<div className="flex items-center gap-2 mb-1">
						<button
							onClick={() => {
								setView('list');
								setSelectedFlow(null);
							}}
							className="text-muted-foreground hover:text-foreground"
						>
							<ChevronLeft size={16} />
						</button>
						<h2 className="text-sm font-semibold text-foreground truncate flex-1">
							{selectedFlow.name}
						</h2>
						<button
							onClick={() => deleteFlow(selectedFlow.id)}
							className="text-muted-foreground hover:text-red-400"
							title="Delete flow"
						>
							<Trash2 size={14} />
						</button>
					</div>
					{selectedFlow.description && (
						<p className="text-xs text-muted-foreground ml-6">{selectedFlow.description}</p>
					)}
					<p className="text-xs text-muted-foreground ml-6 mt-0.5">
						{selectedFlow.domain} · {selectedFlow.steps.length} steps
					</p>
				</div>

				<div className="flex-1 overflow-y-auto">
					{/* Steps */}
					<div className="px-4 py-3 space-y-2">
						<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Steps
						</h3>
						{selectedFlow.steps.map((step) => {
							const Icon = TOOL_ICON_MAP[step.toolName] || Settings2;
							return (
								<div key={step.index} className="flex items-start gap-2 text-xs">
									<div className="mt-0.5 p-1 rounded bg-secondary">
										<Icon size={10} className="text-muted-foreground" />
									</div>
									<div>
										<p className="text-foreground">{step.intent}</p>
										{step.args?.selector && (
											<p className="text-muted-foreground font-mono text-[10px] truncate max-w-[200px]">
												{step.args.selector as string}
											</p>
										)}
									</div>
								</div>
							);
						})}
					</div>

					{/* Parameters */}
					{params.length > 0 && (
						<div className="px-4 py-3 border-t border-border space-y-2">
							<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Parameters
							</h3>
							{params.map((param) => (
								<div key={param.name}>
									<label className="text-xs text-foreground block mb-1">
										{param.name}
										{param.description && (
											<span className="text-muted-foreground ml-1">— {param.description}</span>
										)}
									</label>
									<input
										type="text"
										value={paramValues[param.name] || ''}
										onChange={(e) =>
											setParamValues((prev) => ({ ...prev, [param.name]: e.target.value }))
										}
										placeholder={param.defaultValue || ''}
										className="w-full text-xs px-2 py-1.5 border border-input rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
									/>
								</div>
							))}
						</div>
					)}

					{/* Run button */}
					<div className="px-4 py-3 border-t border-border">
						<button
							onClick={executeFlow}
							className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:opacity-90"
						>
							<Play size={14} />
							Run Flow
						</button>
					</div>

					{/* Run history */}
					{runs.length > 0 && (
						<div className="px-4 py-3 border-t border-border space-y-2">
							<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Recent Runs
							</h3>
							{runs.map((run) => (
								<div
									key={run.id}
									className="flex items-center justify-between text-xs py-1"
								>
									<div className="flex items-center gap-2">
										{run.status === 'completed' ? (
											<Check size={12} className="text-green-500" />
										) : run.status === 'failed' ? (
											<X size={12} className="text-red-500" />
										) : (
											<Loader2 size={12} className="text-muted-foreground" />
										)}
										<span className="text-foreground">
											{run.stepsCompleted}/{run.totalSteps} steps
										</span>
									</div>
									<span className="text-muted-foreground">
										{formatRelativeTime(run.startedAt)}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		);
	}

	// List view
	const grouped = groupByDomain(flows);

	return (
		<div className="flex flex-col h-full">
			<div className="px-4 py-3 border-b border-border flex items-center justify-between">
				<h2 className="text-sm font-semibold text-foreground">Flows</h2>
				<button
					onClick={loadFlows}
					className="text-xs text-muted-foreground hover:text-foreground"
				>
					Refresh
				</button>
			</div>

			<div className="flex-1 overflow-y-auto">
				{flows.length === 0 ? (
					<div className="p-4 text-center">
						<p className="text-sm text-muted-foreground">No flows yet.</p>
						<p className="text-xs text-muted-foreground mt-1">
							Record a flow in the Chat tab by saying "teach you how to..."
						</p>
					</div>
				) : (
					Object.entries(grouped).map(([domain, domainFlows]) => (
						<div key={domain}>
							<div className="px-4 py-2 bg-secondary/30">
								<p className="text-xs font-medium text-muted-foreground">{domain}</p>
							</div>
							{domainFlows.map((flow) => (
								<button
									key={flow.id}
									onClick={() => openFlow(flow)}
									className="w-full px-4 py-3 border-b border-border hover:bg-secondary/20 text-left flex items-center justify-between"
								>
									<div className="min-w-0">
										<p className="text-sm text-foreground truncate">{flow.name}</p>
										<p className="text-xs text-muted-foreground">
											{flow.stepCount} steps
											{flow.lastRunAt && ` · last run ${formatRelativeTime(flow.lastRunAt)}`}
										</p>
									</div>
									<ChevronRight size={14} className="text-muted-foreground shrink-0" />
								</button>
							))}
						</div>
					))
				)}
			</div>
		</div>
	);
}

function groupByDomain(flows: FlowListItem[]): Record<string, FlowListItem[]> {
	const groups: Record<string, FlowListItem[]> = {};
	for (const flow of flows) {
		const domain = flow.domain || 'Unknown';
		if (!groups[domain]) groups[domain] = [];
		groups[domain].push(flow);
	}
	return groups;
}

function formatRelativeTime(dateStr: string): string {
	const date = new Date(dateStr);
	const now = Date.now();
	const diff = now - date.getTime();

	if (diff < 60000) return 'just now';
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	return `${Math.floor(diff / 86400000)}d ago`;
}
