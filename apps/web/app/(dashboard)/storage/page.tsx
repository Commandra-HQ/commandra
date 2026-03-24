'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { Download, Eye, HardDrive, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
	const [activeCategory, setActiveCategory] = useState<string>('screenshots');
	const [files, setFiles] = useState<FileInfo[]>([]);
	const [stats, setStats] = useState<StorageStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	useEffect(() => { fetchStats(); }, []);
	useEffect(() => { fetchFiles(activeCategory); }, [activeCategory]);

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
			const res = await apiFetch(`/api/storage/${file.category}/${file.domain}/${file.name}`, { method: 'DELETE' });
			if (res.ok) {
				setFiles((prev) => prev.filter((f) => f.path !== file.path));
				fetchStats();
				if (previewFile?.path === file.path) {
					setPreviewFile(null);
					setPreviewUrl(null);
				}
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

	async function handlePreview(file: FileInfo) {
		if (previewFile?.path === file.path) {
			setPreviewFile(null);
			setPreviewUrl(null);
			return;
		}
		try {
			const res = await apiFetch(`/api/storage/${file.category}/${file.domain}/${file.name}`);
			if (res.ok) {
				const blob = await res.blob();
				if (previewUrl) URL.revokeObjectURL(previewUrl);
				const url = URL.createObjectURL(blob);
				setPreviewUrl(url);
				setPreviewFile(file);
			}
		} catch (err) {
			console.error('Failed to preview file:', err);
		}
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}

	const isScreenshot = activeCategory === 'screenshots';

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
				<p className="text-sm text-muted-foreground font-mono mt-1">
					{stats ? `${stats.totalFiles} files · ${formatSize(stats.totalSizeBytes)} / ${formatSize(stats.maxSizeBytes)}` : 'Loading...'}
				</p>
			</div>

			{/* Category tabs */}
			<div className="flex gap-0 border-b border-border">
				{CATEGORIES.map((cat) => (
					<button
						key={cat}
						onClick={() => { setActiveCategory(cat); setPreviewFile(null); setPreviewUrl(null); }}
						className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
							activeCategory === cat
								? 'border-foreground text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground'
						}`}
					>
						{cat.charAt(0).toUpperCase() + cat.slice(1)}
						{stats?.categories[cat] && (
							<Badge variant="outline" className="ml-2 text-[9px] py-0">
								{stats.categories[cat].files}
							</Badge>
						)}
					</button>
				))}
			</div>

			{/* File list */}
			{loading ? (
				<div className="flex items-center gap-2 py-8">
					<span className="status-pixel bg-muted-foreground animate-pulse" />
					<p className="text-sm font-mono text-muted-foreground">Loading...</p>
				</div>
			) : files.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<HardDrive size={24} strokeWidth={1.5} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground">No {activeCategory} files yet.</p>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-6">
					{Object.entries(grouped).map(([domain, domainFiles]) => (
						<div key={domain}>
							<h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">{domain}</h3>

							{/* Table header */}
							<div className="grid grid-cols-[1fr_80px_100px_80px] gap-2 px-3 py-1.5 border-b border-border text-[10px] font-mono uppercase tracking-wider text-dim">
								<span>Name</span>
								<span>Size</span>
								<span>Date</span>
								<span className="text-right">Actions</span>
							</div>

							{/* File rows */}
							{domainFiles.map((file) => (
								<div key={file.path}>
									<div
										className={`grid grid-cols-[1fr_80px_100px_80px] gap-2 items-center px-3 py-2 border-b border-border/50 hover:bg-elevated/50 transition-colors cursor-pointer ${
											previewFile?.path === file.path ? 'bg-elevated' : ''
										}`}
										onClick={() => isScreenshot && handlePreview(file)}
									>
										<div className="flex items-center gap-2 min-w-0">
											{isScreenshot && (
												<div className="w-8 h-6 bg-surface border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
													<Eye size={10} strokeWidth={1.5} className="text-dim" />
												</div>
											)}
											<span className="text-sm font-mono truncate">{file.name}</span>
										</div>
										<span className="text-xs font-mono text-muted-foreground">{formatSize(file.sizeBytes)}</span>
										<span className="text-xs font-mono text-muted-foreground">
											{new Date(file.createdAt).toLocaleDateString()}
										</span>
										<div className="flex items-center justify-end gap-0.5">
											<button
												onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
												className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
												title="Download"
											>
												<Download size={13} strokeWidth={1.5} />
											</button>
											<button
												onClick={(e) => { e.stopPropagation(); handleDelete(file); }}
												className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
												title="Delete"
											>
												<Trash2 size={13} strokeWidth={1.5} />
											</button>
										</div>
									</div>

									{/* Preview panel */}
									{previewFile?.path === file.path && previewUrl && (
										<div className="border border-border bg-surface p-4">
											<div className="flex items-center justify-between mb-3">
												<span className="text-xs font-mono text-muted-foreground">{file.name}</span>
												<button onClick={() => { setPreviewFile(null); setPreviewUrl(null); }} className="p-1 text-muted-foreground hover:text-foreground">
													<X size={14} strokeWidth={1.5} />
												</button>
											</div>
											<img
												src={previewUrl}
												alt={file.name}
												className="w-full border border-border"
											/>
											<div className="flex items-center gap-2 mt-3">
												<Button variant="outline" size="sm" onClick={() => handleDownload(file)} className="gap-1.5 text-xs">
													<Download size={12} strokeWidth={1.5} /> Download
												</Button>
												<Button variant="ghost" size="sm" onClick={() => handleDelete(file)} className="gap-1.5 text-xs text-destructive hover:text-destructive">
													<Trash2 size={12} strokeWidth={1.5} /> Delete
												</Button>
											</div>
										</div>
									)}
								</div>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
