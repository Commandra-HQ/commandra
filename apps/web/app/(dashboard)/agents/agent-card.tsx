'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
	Bot,
	ChevronDown,
	ChevronRight,
	Clock,
	FileText,
	Save,
	Trash2,
	Upload,
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

const KNOWN_FILES = ['SOUL.md', 'SKILLS.md', 'LEARNINGS.md', 'ERRORS.md'];

function getPlaceholder(filename: string): string {
	switch (filename) {
		case 'SOUL.md':
			return 'You are a GitHub specialist. You help users navigate repositories, review PRs, and manage issues efficiently...';
		case 'SKILLS.md':
			return '## Learned Skills\n\n- Navigate to PR review page using the "Pull requests" tab\n- Filter issues by label using the sidebar...';
		case 'LEARNINGS.md':
			return '## Corrections & Discoveries\n\n- User prefers squash merges over regular merges\n- The "Files changed" tab loads slowly on large PRs...';
		case 'ERRORS.md':
			return '## Failure Patterns\n\n- Clicking "Merge" too quickly after approval causes a race condition...';
		default:
			return '';
	}
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
}: {
	agent: Agent;
	isExpanded: boolean;
	files: AgentFile[];
	editingFile: { agentId: string; filename: string } | null;
	editContent: string;
	saving: boolean;
	onToggleExpand: () => void;
	onDelete: () => void;
	onToggleSchedule: () => void;
	onStartEdit: (filename: string) => void;
	onCreateNewFile: () => void;
	onEditContentChange: (content: string) => void;
	onSaveFile: () => void;
	onCancelEdit: () => void;
}) {
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
						<Badge variant="outline" className="text-[10px] ml-1">
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
				{(agent.domains?.length || agent.tools?.length) && (
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
				)}

				{/* Expanded: Files */}
				{isExpanded && (
					<div className="mt-4 ml-8 space-y-3">
						{agent.trigger?.cron && (
							<div className="flex items-center justify-between p-2 rounded border border-border bg-muted/30">
								<div className="flex items-center gap-2 text-xs">
									<Clock size={14} className="text-muted-foreground" />
									<span>Schedule: <code className="bg-muted px-1 rounded">{agent.trigger.cron}</code></span>
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
						<div className="flex items-center justify-between">
							<h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Agent Files
							</h4>
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs"
								onClick={onCreateNewFile}
							>
								<Upload size={12} className="mr-1" />
								New File
							</Button>
						</div>

						{/* Quick-create buttons for known files that don't exist yet */}
						{KNOWN_FILES.filter((f) => !files.some((af) => af.name === f)).length > 0 && (
							<div className="flex gap-1.5 flex-wrap">
								{KNOWN_FILES.filter((f) => !files.some((af) => af.name === f)).map((f) => (
									<button
										key={f}
										onClick={() => onStartEdit(f)}
										className="px-2 py-1 text-[10px] rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
									>
										+ {f}
									</button>
								))}
							</div>
						)}

						{files.length === 0 && !editingFile && (
							<p className="text-xs text-muted-foreground">
								No files yet. Create SOUL.md to give this agent a personality.
							</p>
						)}

						{files.map((file) => (
							<div
								key={file.name}
								className="flex items-center justify-between p-2 rounded border border-border hover:bg-muted/50"
							>
								<div className="flex items-center gap-2">
									<FileText size={14} className="text-muted-foreground" />
									<span className="text-sm">{file.name}</span>
									<span className="text-[10px] text-muted-foreground">
										{file.size > 0 ? `${(file.size / 1024).toFixed(1)} KB` : ''}
									</span>
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
									<span className="text-sm font-medium">
										{editingFile.filename}
									</span>
									<div className="flex items-center gap-1">
										<Button
											size="sm"
											className="h-7 text-xs"
											onClick={onSaveFile}
											disabled={saving}
										>
											<Save size={12} className="mr-1" />
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
								<textarea
									value={editContent}
									onChange={(e) => onEditContentChange(e.target.value)}
									className="w-full min-h-[200px] rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y"
									placeholder={getPlaceholder(editingFile.filename)}
								/>
							</div>
						)}

						{/* Soul preview if loaded */}
						{agent.soul && !editingFile && (
							<div className="p-3 rounded bg-muted/50 border border-border">
								<p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
									SOUL.md Preview
								</p>
								<p className="text-xs text-foreground whitespace-pre-wrap line-clamp-4">
									{agent.soul}
								</p>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
