'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSettingsQuery, useUpdateSettingsMutation } from '@/lib/queries/use-settings';
import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

const LLM_PROVIDERS = [
	{
		id: 'anthropic',
		name: 'Anthropic',
		models: { strong: ['sonnet', 'opus'], fast: ['haiku', 'sonnet'] },
	},
	{
		id: 'openai',
		name: 'OpenAI',
		models: { strong: ['gpt-4o', 'gpt-4-turbo'], fast: ['gpt-4o-mini', 'gpt-4o'] },
	},
	{ id: 'google', name: 'Google', models: { strong: ['gemini-pro'], fast: ['gemini-flash'] } },
];

export default function SettingsPage() {
	const { data, isLoading } = useSettingsQuery();
	const updateMutation = useUpdateSettingsMutation();
	const [saved, setSaved] = useState(false);

	const [settings, setSettings] = useState({
		llmProvider: 'anthropic',
		llmApiKey: '',
		llmModelStrong: 'sonnet',
		llmModelFast: 'haiku',
	});

	// Sync from query to local state
	useEffect(() => {
		if (data?.settings) {
			setSettings({
				llmProvider: data.settings.llmProvider || 'anthropic',
				llmApiKey: data.settings.llmApiKey || '',
				llmModelStrong: data.settings.llmModelStrong || 'sonnet',
				llmModelFast: data.settings.llmModelFast || 'haiku',
			});
		}
	}, [data]);

	async function saveSettings() {
		await updateMutation.mutateAsync(settings);
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	}

	const currentLlmProvider =
		LLM_PROVIDERS.find((p) => p.id === settings.llmProvider) || LLM_PROVIDERS[0];

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 py-8">
				<div className="status-pixel bg-muted-foreground animate-pulse" />
				<p className="text-sm font-mono text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>LLM Provider</CardTitle>
					<CardDescription>
						Choose which AI provider to use for agent reasoning. You bring your own API key.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="flex gap-3">
						{LLM_PROVIDERS.map((provider) => (
							<button
								key={provider.id}
								onClick={() =>
									setSettings({
										...settings,
										llmProvider: provider.id,
										llmModelStrong: provider.models.strong[0],
										llmModelFast: provider.models.fast[0],
									})
								}
								className={`flex-1 p-3 border text-sm font-medium transition-colors ${
									settings.llmProvider === provider.id
										? 'border-primary bg-primary/5 text-foreground'
										: 'border-border text-muted-foreground hover:bg-muted/50'
								}`}
							>
								{provider.name}
							</button>
						))}
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium">API Key</label>
						<Input
							type="password"
							placeholder={`Enter your ${currentLlmProvider.name} API key`}
							value={settings.llmApiKey}
							onChange={(e) => setSettings({ ...settings, llmApiKey: e.target.value })}
						/>
						<p className="text-xs text-muted-foreground font-mono">
							Stored encrypted. Only used for your agent&apos;s LLM calls.
						</p>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<label className="text-sm font-medium">Strong Model (planning)</label>
							<div className="flex gap-2">
								{currentLlmProvider.models.strong.map((m) => (
									<button
										key={m}
										onClick={() => setSettings({ ...settings, llmModelStrong: m })}
										className={`px-3 py-1.5 text-xs border transition-colors ${
											settings.llmModelStrong === m
												? 'border-primary bg-primary/5'
												: 'border-border hover:bg-muted/50'
										}`}
									>
										{m}
									</button>
								))}
							</div>
						</div>
						<div className="space-y-2">
							<label className="text-sm font-medium">Fast Model (reads)</label>
							<div className="flex gap-2">
								{currentLlmProvider.models.fast.map((m) => (
									<button
										key={m}
										onClick={() => setSettings({ ...settings, llmModelFast: m })}
										className={`px-3 py-1.5 text-xs border transition-colors ${
											settings.llmModelFast === m
												? 'border-primary bg-primary/5'
												: 'border-border hover:bg-muted/50'
										}`}
									>
										{m}
									</button>
								))}
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			<Button onClick={saveSettings} disabled={updateMutation.isPending}>
				{updateMutation.isPending ? (
					<Loader2 size={16} className="mr-2 animate-spin" />
				) : saved ? (
					<Check size={16} className="mr-2" />
				) : null}
				{saved ? 'Saved' : updateMutation.isPending ? 'Saving...' : 'Save Settings'}
			</Button>
		</div>
	);
}
