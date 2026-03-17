'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { Download, HardDrive, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface FileInfo {
	name: string;
	path: string;
	domain: string;
	category: string;
	sizeBytes: number;
	createdAt: number;
}

interface StorageStats {
	totalSizeBytes: number;
	totalFiles: number;
	maxSizeBytes: number;
	categories: Record<string, { files: number; sizeBytes: number }>;
}

const CATEGORIES = ['screenshots', 'exports', 'context'] as const;

export default function StoragePage() {
	const [activeCategory, setActiveCategory] = useState<string>('exports');
	const [files, setFiles] = useState<FileInfo[]>([]);
	const [stats, setStats] = useState<StorageStats | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetchStats();
	}, []);

	useEffect(() => {
		fetchFiles(activeCategory);
	}, [activeCategory]);

	async function fetchStats() {
		try {
			const res = await apiFetch('/api/storage/stats');
			if (res.ok) setStats(await res.json());
		} catch (err) {
			console.error('Failed to fetch storage stats:', err);
		}
	}

	async function fetchFiles(category: string) {
		setLoading(true);
		try {
			const res = await apiFetch(`/api/storage/${category}`);
			if (res.ok) {
				const data = await res.json();
				setFiles(data.files || []);
			}
		} catch (err) {
			console.error('Failed to fetch files:', err);
		} finally {
			setLoading(false);
		}
	}

	async function handleDelete(file: FileInfo) {
		try {
			const res = await apiFetch(`/api/storage/${file.category}/${file.domain}/${file.name}`, {
				method: 'DELETE',
			});
			if (res.ok) {
				setFiles((prev) => prev.filter((f) => f.path !== file.path));
				fetchStats();
			}
		} catch (err) {
			console.error('Failed to delete file:', err);
		}
	}

	async function handleDownload(file: FileInfo) {
		try {
			const res = await apiFetch(`/api/storage/${file.category}/${file.domain}/${file.name}`);
			if (res.ok) {
				const blob = await res.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = file.name;
				a.click();
				URL.revokeObjectURL(url);
			}
		} catch (err) {
			console.error('Failed to download file:', err);
		}
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}

	// Group files by domain
	const grouped = files.reduce<Record<string, FileInfo[]>>((acc, file) => {
		if (!acc[file.domain]) acc[file.domain] = [];
		acc[file.domain].push(file);
		return acc;
	}, {});

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Storage</h1>
				<p className="text-muted-foreground mt-1">
					Files saved to your local machine by the agent.
				</p>
			</div>

			{/* Stats */}
			{stats && (
				<div className="flex gap-4 text-sm">
					<span className="text-muted-foreground">
						{stats.totalFiles} files · {formatSize(stats.totalSizeBytes)} /{' '}
						{formatSize(stats.maxSizeBytes)}
					</span>
				</div>
			)}

			{/* Category tabs */}
			<div className="flex gap-1 border-b border-border">
				{CATEGORIES.map((cat) => (
					<button
						key={cat}
						onClick={() => setActiveCategory(cat)}
						className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
							activeCategory === cat
								? 'border-primary text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground'
						}`}
					>
						{cat.charAt(0).toUpperCase() + cat.slice(1)}
						{stats?.categories[cat] && (
							<Badge variant="secondary" className="ml-2 text-[10px]">
								{stats.categories[cat].files}
							</Badge>
						)}
					</button>
				))}
			</div>

			{/* File list */}
			{loading ? (
				<p className="text-sm text-muted-foreground">Loading files...</p>
			) : files.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<HardDrive size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground">No {activeCategory} files yet.</p>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-6">
					{Object.entries(grouped).map(([domain, domainFiles]) => (
						<div key={domain}>
							<h3 className="text-sm font-medium text-muted-foreground mb-2">{domain}</h3>
							<div className="space-y-1">
								{domainFiles.map((file) => (
									<div
										key={file.path}
										className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
									>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium truncate">{file.name}</p>
											<p className="text-xs text-muted-foreground">
												{formatSize(file.sizeBytes)} ·{' '}
												{new Date(file.createdAt).toLocaleDateString()}
											</p>
										</div>
										<div className="flex items-center gap-1 ml-2">
											<button
												onClick={() => handleDownload(file)}
												className="p-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-secondary"
												title="Download"
											>
												<Download size={14} />
											</button>
											<button
												onClick={() => handleDelete(file)}
												className="p-1.5 text-muted-foreground hover:text-red-500 rounded hover:bg-red-500/10"
												title="Delete"
											>
												<Trash2 size={14} />
											</button>
										</div>
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
