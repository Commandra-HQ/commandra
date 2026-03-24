'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MarkdownEditor, MarkdownPreview } from '@/components/markdown-editor';
import {
	Bot,
	ChevronDown,
	ChevronRight,
	Clock,
	FileText,
	Plus,
	Save,
	Trash2,
} from 'lucide-react';

export interface Agent {
	id: string;
	slug: string;
	name: string;
	description: string;
	model?: string;
	maxIterations?: number;
	tools?: string[];
	domains?: string[];
	soul?: string;
	skills?: string;
	trigger?: { cron?: string; enabled?: boolean };
}

export interface AgentFile {
	name: string;
	size: number;
	updatedAt: string;
}

export interface AgentRun {
	id: string;
	status: string;
	toolCalls: number;
	durationMs: number | null;
	error: string | null;
	createdAt: string;
}

const KNOWN_FILES = ['SOUL.md', 'SKILLS.md', 'LEARNINGS.md', 'ERRORS.md'];

function getPlaceholder(filename: string): string {
	switch (filename) {
		case 'SOUL.md':
			return 'Define this agent\'s personality and identity...';
		case 'SKILLS.md':
			return 'Learned capabilities will appear here...';
		case 'LEARNINGS.md':
			return 'Corrections and discoveries will appear here...';
		case 'ERRORS.md':
			return 'Failure patterns will appear here...';
		default:
			return 'Start writing...';
	}
}

function isMarkdownFile(filename: string): boolean {
	return filename.endsWith('.md');
}

export function AgentCard({
	agent,
	isExpanded,
	files,
	editingFile,
	editContent,
	saving,
	onToggleExpand,
	onDelete,
	onToggleSchedule,
	onStartEdit,
	onCreateNewFile,
	onEditContentChange,
	onSaveFile,
	onCancelEdit,
	runs,
}: {
	agent: Agent;
	isExpanded: boolean;
	files: AgentFile[];
	editingFile: { agentId: string; filename: string } | null;
	editContent: string;
	saving: boolean;
	runs?: AgentRun[];
	onToggleExpand: () => void;
	onDelete: () => void;
	onToggleSchedule: () => void;
	onStartEdit: (filename: string) => void;
	onCreateNewFile: () => void;
	onEditContentChange: (content: string) => void;
	onSaveFile: () => void;
	onCancelEdit: () => void;
}) {
	const missingFiles = KNOWN_FILES.filter((f) => !files.some((af) => af.name === f));

	return (
		<Card>
			<CardContent className="py-3 px-4">
				{/* Header */}
				<div className="flex items-center justify-between">
					<button
						onClick={onToggleExpand}
						className="flex items-center gap-2 flex-1 min-w-0 text-left"
					>
						{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
						<Bot size={16} className="text-primary shrink-0" />
						<span className="font-medium text-sm">{agent.name}</span>
						<Badge variant="outline" className="text-[10px] ml-1 font-mono">
							{agent.slug}
						</Badge>
						{agent.model && (
							<Badge variant="secondary" className="text-[10px]">
								{agent.model}
							</Badge>
						)}
						{agent.trigger?.cron && (
							<Badge
								variant={agent.trigger.enabled !== false ? 'default' : 'outline'}
								className="text-[10px] gap-0.5"
							>
								<Clock size={10} />
								{agent.trigger.cron}
							</Badge>
						)}
					</button>
					<div className="flex items-center gap-1 ml-2">
						<Button
							size="icon"
							variant="ghost"
							className="h-7 w-7 text-destructive hover:text-destructive"
							onClick={onDelete}
						>
							<Trash2 size={13} />
						</Button>
					</div>
				</div>

				{agent.description && (
					<p className="text-xs text-muted-foreground mt-1 ml-8">
						{agent.description}
					</p>
				)}

				{/* Tags */}
				{(agent.domains?.length || agent.tools?.length) ? (
					<div className="flex gap-1.5 flex-wrap mt-2 ml-8">
						{agent.domains?.map((d) => (
							<Badge key={d} variant="default" className="text-[10px]">
								{d}
							</Badge>
						))}
						{agent.tools?.map((t) => (
							<Badge key={t} variant="secondary" className="text-[10px]">
								{t}
							</Badge>
						))}
					</div>
				) : null}

				{/* Expanded content */}
				{isExpanded && (
					<div className="mt-4 ml-8 space-y-4">
						{/* Schedule */}
						{agent.trigger?.cron && (
							<div className="flex items-center justify-between p-2.5 border border-border bg-surface">
								<div className="flex items-center gap-2 text-xs">
									<Clock size={14} className="text-muted-foreground" />
									<span>Schedule: <code className="bg-elevated px-1.5 py-0.5 font-mono text-[11px]">{agent.trigger.cron}</code></span>
								</div>
								<Button
									size="sm"
									variant={agent.trigger.enabled !== false ? 'default' : 'outline'}
									className="h-7 text-xs"
									onClick={onToggleSchedule}
								>
									{agent.trigger.enabled !== false ? 'Enabled' : 'Disabled'}
								</Button>
							</div>
						)}

						{/* Files header */}
						<div className="flex items-center justify-between">
							<h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Agent Files
							</h4>
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs gap-1"
								onClick={onCreateNewFile}
							>
								<Plus size={12} /> New File
							</Button>
						</div>

						{/* Quick-create for missing standard files */}
						{missingFiles.length > 0 && (
							<div className="flex gap-1.5 flex-wrap">
								{missingFiles.map((f) => (
									<button
										key={f}
										onClick={() => onStartEdit(f)}
										className="px-2.5 py-1 text-[11px] border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors font-mono"
									>
										+ {f}
									</button>
								))}
							</div>
						)}

						{files.length === 0 && !editingFile && (
							<p className="text-xs text-muted-foreground py-2">
								No files yet. Create SOUL.md to give this agent a personality.
							</p>
						)}

						{/* File list */}
						{files.map((file) => (
							<div
								key={file.name}
								className="flex items-center justify-between p-2.5 border border-border hover:bg-surface transition-colors"
							>
								<div className="flex items-center gap-2">
									<FileText size={14} className="text-muted-foreground" />
									<span className="text-sm font-mono">{file.name}</span>
									{file.size > 0 && (
										<span className="text-[10px] text-muted-foreground font-mono">
											{(file.size / 1024).toFixed(1)} KB
										</span>
									)}
								</div>
								<Button
									size="sm"
									variant="ghost"
									className="h-7 text-xs"
									onClick={() => onStartEdit(file.name)}
								>
									Edit
								</Button>
							</div>
						))}

						{/* File editor */}
						{editingFile?.agentId === agent.id && (
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium font-mono">
										{editingFile.filename}
									</span>
									<div className="flex items-center gap-1">
										<Button
											size="sm"
											className="h-7 text-xs gap-1"
											onClick={onSaveFile}
											disabled={saving}
										>
											<Save size={12} />
											{saving ? 'Saving...' : 'Save'}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="h-7 text-xs"
											onClick={onCancelEdit}
										>
											Cancel
										</Button>
									</div>
								</div>
								{isMarkdownFile(editingFile.filename) ? (
									<MarkdownEditor
										content={editContent}
										onChange={onEditContentChange}
										placeholder={getPlaceholder(editingFile.filename)}
										minHeight="200px"
									/>
								) : (
									<textarea
										value={editContent}
										onChange={(e) => onEditContentChange(e.target.value)}
										className="w-full min-h-[200px] border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y"
										placeholder={getPlaceholder(editingFile.filename)}
									/>
								)}
							</div>
						)}

						{/* Soul preview */}
						{agent.soul && !editingFile && (
							<div className="border border-border">
								<div className="px-3 py-1.5 border-b border-border bg-surface">
									<span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider font-mono">
										SOUL.md
									</span>
								</div>
								<div className="px-3 py-2">
									<MarkdownPreview content={agent.soul} />
								</div>
							</div>
						)}

						{/* Recent runs */}
						{runs && runs.length > 0 && (
							<div className="space-y-2">
								<h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
									Recent Runs
								</h4>
								<div className="space-y-1">
									{runs.slice(0, 10).map((run) => (
										<div
											key={run.id}
											className={`flex items-center justify-between p-2.5 border text-xs ${
												run.status === 'completed'
													? 'border-green-500/20 bg-green-500/5'
													: run.status === 'failed'
														? 'border-red-500/20 bg-red-500/5'
														: run.status === 'queued'
															? 'border-yellow-500/20 bg-yellow-500/5'
															: 'border-border'
											}`}
										>
											<div className="flex items-center gap-3">
												<span className={`inline-block w-2 h-2 ${
													run.status === 'completed' ? 'bg-green-500' :
													run.status === 'failed' ? 'bg-red-500' :
													run.status === 'queued' ? 'bg-yellow-500' :
													'bg-muted-foreground'
												}`} />
												<span className="text-muted-foreground font-mono">
													{new Date(run.createdAt).toLocaleString(undefined, {
														month: 'short', day: 'numeric',
														hour: '2-digit', minute: '2-digit',
													})}
												</span>
												{run.durationMs != null && (
													<span className="text-muted-foreground font-mono">
														{run.durationMs < 60000
															? `${Math.round(run.durationMs / 1000)}s`
															: `${Math.round(run.durationMs / 60000)}m`}
													</span>
												)}
												<span className="text-muted-foreground">{run.toolCalls} tools</span>
											</div>
											{run.error && (
												<span className="text-red-400 truncate max-w-[200px] font-mono" title={run.error}>
													{run.error.slice(0, 50)}
												</span>
											)}
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
