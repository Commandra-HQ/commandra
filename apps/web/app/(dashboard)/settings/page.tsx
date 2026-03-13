'use client';

import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';

const LLM_PROVIDERS = [
	{ id: 'anthropic', name: 'Anthropic', models: { strong: ['sonnet', 'opus'], fast: ['haiku', 'sonnet'] } },
	{ id: 'openai', name: 'OpenAI', models: { strong: ['gpt-4o', 'gpt-4-turbo'], fast: ['gpt-4o-mini', 'gpt-4o'] } },
	{ id: 'google', name: 'Google', models: { strong: ['gemini-pro'], fast: ['gemini-flash'] } },
];

const EMBEDDING_PROVIDERS = [
	{ id: 'voyage', name: 'Voyage AI', models: ['voyage-3.5', 'voyage-3-large', 'voyage-3.5-lite', 'voyage-code-3'] },
	{ id: 'openai', name: 'OpenAI', models: ['text-embedding-3-small', 'text-embedding-3-large'] },
	{ id: 'ollama', name: 'Ollama', models: ['nomic-embed-text', 'mxbai-embed-large'] },
];

interface Settings {
	llmProvider: string;
	llmApiKey: string;
	llmModelStrong: string;
	llmModelFast: string;
	embeddingProvider: string;
	embeddingApiKey: string;
	embeddingModel: string;
}

export default function SettingsPage() {
	const [settings, setSettings] = useState<Settings>({
		llmProvider: 'anthropic',
		llmApiKey: '',
		llmModelStrong: 'sonnet',
		llmModelFast: 'haiku',
		embeddingProvider: 'voyage',
		embeddingApiKey: '',
		embeddingModel: 'voyage-3.5',
	});
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetchSettings();
	}, []);

	async function fetchSettings() {
		try {
			const res = await apiFetch('/api/settings');
			if (res.ok) {
				const data = await res.json();
				if (data.settings) {
					setSettings({
						llmProvider: data.settings.llmProvider || 'anthropic',
						llmApiKey: data.settings.llmApiKey || '',
						llmModelStrong: data.settings.llmModelStrong || 'sonnet',
						llmModelFast: data.settings.llmModelFast || 'haiku',
						embeddingProvider: data.settings.embeddingProvider || 'voyage',
						embeddingApiKey: data.settings.embeddingApiKey || '',
						embeddingModel: data.settings.embeddingModel || 'voyage-3.5',
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
			const res = await apiFetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
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

	const currentLlmProvider = LLM_PROVIDERS.find((p) => p.id === settings.llmProvider) || LLM_PROVIDERS[0];
	const currentEmbeddingProvider = EMBEDDING_PROVIDERS.find((p) => p.id === settings.embeddingProvider) || EMBEDDING_PROVIDERS[0];

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
				<p className="text-muted-foreground mt-1">Configure your LLM and embedding providers.</p>
			</div>

			{/* LLM Provider */}
			<Card>
				<CardHeader>
					<CardTitle>LLM Provider</CardTitle>
					<CardDescription>Choose which AI provider to use for agent reasoning. You bring your own API key.</CardDescription>
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

					<div className="space-y-2">
						<label className="text-sm font-medium">API Key</label>
						<Input
							type="password"
							placeholder={`Enter your ${currentLlmProvider.name} API key`}
							value={settings.llmApiKey}
							onChange={(e) => setSettings({ ...settings, llmApiKey: e.target.value })}
						/>
						<p className="text-xs text-muted-foreground">
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
								{currentLlmProvider.models.fast.map((m) => (
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
				</CardContent>
			</Card>

			{/* Embedding Provider */}
			<Card>
				<CardHeader>
					<CardTitle>Embedding Provider</CardTitle>
					<CardDescription>Used for semantic search over page elements, flows, and memory. Voyage AI is recommended by Anthropic.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="flex gap-3">
						{EMBEDDING_PROVIDERS.map((provider) => (
							<button
								key={provider.id}
								onClick={() =>
									setSettings({
										...settings,
										embeddingProvider: provider.id,
										embeddingModel: provider.models[0],
										// Clear the embedding key when switching — user re-enters
										embeddingApiKey: '',
									})
								}
								className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-colors ${
									settings.embeddingProvider === provider.id
										? 'border-primary bg-primary/5 text-foreground'
										: 'border-border text-muted-foreground hover:bg-muted/50'
								}`}
							>
								{provider.name}
							</button>
						))}
					</div>

					{settings.embeddingProvider !== 'ollama' && (
						<div className="space-y-2">
							<label className="text-sm font-medium">Embedding API Key</label>
							<Input
								type="password"
								placeholder={`Enter your ${currentEmbeddingProvider.name} API key`}
								value={settings.embeddingApiKey}
								onChange={(e) => setSettings({ ...settings, embeddingApiKey: e.target.value })}
							/>
							<p className="text-xs text-muted-foreground">
								{settings.embeddingProvider === 'openai'
									? 'Uses the same key format as your OpenAI LLM key. You can reuse the same key.'
									: 'Get a key at dash.voyageai.com'}
							</p>
						</div>
					)}

					<div className="space-y-2">
						<label className="text-sm font-medium">Embedding Model</label>
						<div className="flex flex-wrap gap-2">
							{currentEmbeddingProvider.models.map((m) => (
								<button
									key={m}
									onClick={() => setSettings({ ...settings, embeddingModel: m })}
									className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
										settings.embeddingModel === m
											? 'border-primary bg-primary/5'
											: 'border-border hover:bg-muted/50'
									}`}
								>
									{m}
								</button>
							))}
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Save */}
			<Button onClick={saveSettings} disabled={saving}>
				{saving ? (
					<Loader2 size={16} className="mr-2 animate-spin" />
				) : saved ? (
					<Check size={16} className="mr-2" />
				) : null}
				{saved ? 'Saved' : saving ? 'Saving...' : 'Save Settings'}
			</Button>
		</div>
	);
}
