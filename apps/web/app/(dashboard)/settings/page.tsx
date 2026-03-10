'use client';

import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const PROVIDERS = [
	{ id: 'anthropic', name: 'Anthropic', models: { strong: ['sonnet', 'opus'], fast: ['haiku', 'sonnet'] } },
	{ id: 'openai', name: 'OpenAI', models: { strong: ['gpt-4o', 'gpt-4-turbo'], fast: ['gpt-4o-mini', 'gpt-4o'] } },
	{ id: 'google', name: 'Google', models: { strong: ['gemini-pro'], fast: ['gemini-flash'] } },
];

interface Settings {
	llmProvider: string;
	llmApiKey: string;
	llmModelStrong: string;
	llmModelFast: string;
}

export default function SettingsPage() {
	const [settings, setSettings] = useState<Settings>({
		llmProvider: 'anthropic',
		llmApiKey: '',
		llmModelStrong: 'sonnet',
		llmModelFast: 'haiku',
	});
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetchSettings();
	}, []);

	async function fetchSettings() {
		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/settings`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				if (data.settings) {
					setSettings({
						llmProvider: data.settings.llmProvider || 'anthropic',
						llmApiKey: data.settings.llmApiKey || '',
						llmModelStrong: data.settings.llmModelStrong || 'sonnet',
						llmModelFast: data.settings.llmModelFast || 'haiku',
					});
				}
			}
		} catch (err) {
			console.error('Failed to fetch settings:', err);
		} finally {
			setLoading(false);
		}
	}

	async function saveSettings() {
		setSaving(true);
		try {
			const token = await getToken();
			const res = await fetch(`${API_URL}/api/settings`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(settings),
			});
			if (res.ok) {
				setSaved(true);
				setTimeout(() => setSaved(false), 2000);
			}
		} catch (err) {
			console.error('Failed to save settings:', err);
		} finally {
			setSaving(false);
		}
	}

	const currentProvider = PROVIDERS.find((p) => p.id === settings.llmProvider) || PROVIDERS[0];

	if (loading) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">Settings</h1>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Settings</h1>
				<p className="text-muted-foreground mt-1">Configure your LLM provider and API keys.</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>LLM Provider</CardTitle>
					<CardDescription>Choose which AI provider to use. You bring your own API key.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					{/* Provider selection */}
					<div className="flex gap-3">
						{PROVIDERS.map((provider) => (
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
								className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-colors ${
									settings.llmProvider === provider.id
										? 'border-primary bg-primary/5 text-foreground'
										: 'border-border text-muted-foreground hover:bg-muted/50'
								}`}
							>
								{provider.name}
							</button>
						))}
					</div>

					{/* API Key */}
					<div className="space-y-2">
						<label className="text-sm font-medium">API Key</label>
						<Input
							type="password"
							placeholder={`Enter your ${currentProvider.name} API key`}
							value={settings.llmApiKey}
							onChange={(e) => setSettings({ ...settings, llmApiKey: e.target.value })}
						/>
						<p className="text-xs text-muted-foreground">
							Stored encrypted. Only used for your agent&apos;s LLM calls.
						</p>
					</div>

					{/* Model selection */}
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<label className="text-sm font-medium">Strong Model (planning)</label>
							<div className="flex gap-2">
								{currentProvider.models.strong.map((m) => (
									<button
										key={m}
										onClick={() => setSettings({ ...settings, llmModelStrong: m })}
										className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
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
								{currentProvider.models.fast.map((m) => (
									<button
										key={m}
										onClick={() => setSettings({ ...settings, llmModelFast: m })}
										className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
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

					{/* Save */}
					<Button onClick={saveSettings} disabled={saving}>
						{saving ? (
							<Loader2 size={16} className="mr-2 animate-spin" />
						) : saved ? (
							<Check size={16} className="mr-2" />
						) : null}
						{saved ? 'Saved' : saving ? 'Saving...' : 'Save Settings'}
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}

async function getToken(): Promise<string> {
	const res = await fetch('/api/extension/token');
	const data = await res.json();
	return data.token;
}
