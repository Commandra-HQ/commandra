'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export interface NewAgentData {
	slug: string;
	name: string;
	description: string;
	model: string;
	maxIterations: string;
	domains: string;
	tools: string;
	cron: string;
}

export const EMPTY_AGENT: NewAgentData = {
	slug: '',
	name: '',
	description: '',
	model: '',
	maxIterations: '',
	domains: '',
	tools: '',
	cron: '',
};

export function AgentCreateForm({
	data,
	onChange,
	onCreate,
}: {
	data: NewAgentData;
	onChange: (data: NewAgentData) => void;
	onCreate: () => void;
}) {
	return (
		<Card>
			<CardContent className="pt-5 space-y-3">
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className="text-xs font-medium text-muted-foreground mb-1 block">
							Slug
						</label>
						<Input
							placeholder="github-helper"
							value={data.slug}
							onChange={(e) =>
								onChange({ ...data, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })
							}
						/>
						<p className="text-[10px] text-muted-foreground mt-0.5">
							Lowercase, hyphens, underscores only
						</p>
					</div>
					<div>
						<label className="text-xs font-medium text-muted-foreground mb-1 block">
							Name
						</label>
						<Input
							placeholder="GitHub Helper"
							value={data.name}
							onChange={(e) => onChange({ ...data, name: e.target.value })}
						/>
					</div>
				</div>
				<div>
					<label className="text-xs font-medium text-muted-foreground mb-1 block">
						Description
					</label>
					<Input
						placeholder="What does this agent do?"
						value={data.description}
						onChange={(e) => onChange({ ...data, description: e.target.value })}
					/>
				</div>
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className="text-xs font-medium text-muted-foreground mb-1 block">
							Model
						</label>
						<select
							value={data.model}
							onChange={(e) => onChange({ ...data, model: e.target.value })}
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
						>
							<option value="">Default (strong)</option>
							<option value="strong">Strong</option>
							<option value="fast">Fast</option>
						</select>
					</div>
					<div>
						<label className="text-xs font-medium text-muted-foreground mb-1 block">
							Max Iterations
						</label>
						<Input
							type="number"
							placeholder="15"
							value={data.maxIterations}
							onChange={(e) => onChange({ ...data, maxIterations: e.target.value })}
						/>
					</div>
				</div>
				<div>
					<label className="text-xs font-medium text-muted-foreground mb-1 block">
						Domains (comma-separated)
					</label>
					<Input
						placeholder="github.com, *.github.com"
						value={data.domains}
						onChange={(e) => onChange({ ...data, domains: e.target.value })}
					/>
				</div>
				<div>
					<label className="text-xs font-medium text-muted-foreground mb-1 block">
						Tool Allowlist (comma-separated, leave empty for all)
					</label>
					<Input
						placeholder="navigate, read_text, click_element"
						value={data.tools}
						onChange={(e) => onChange({ ...data, tools: e.target.value })}
					/>
				</div>
				<div>
					<label className="text-xs font-medium text-muted-foreground mb-1 block">
						Schedule (cron expression, optional)
					</label>
					<Input
						placeholder="0 9 * * 1-5 (weekdays at 9am)"
						value={data.cron}
						onChange={(e) => onChange({ ...data, cron: e.target.value })}
					/>
					<p className="text-[10px] text-muted-foreground mt-0.5">
						5-field cron: minute hour day month weekday. Requires active browser connection.
					</p>
				</div>
				<Button size="sm" onClick={onCreate}>
					Create Agent
				</Button>
			</CardContent>
		</Card>
	);
}
