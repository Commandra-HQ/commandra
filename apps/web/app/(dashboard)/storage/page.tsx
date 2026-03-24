'use client';

import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { MarkdownPreview } from '@/components/markdown-editor';
import { apiFetch } from '@/lib/api';
import { type StorageFile, useDeleteStorageFileMutation, useStorageFilesQuery, useStorageStatsQuery } from '@/lib/queries/use-storage';
import { Download, Eye, FileText, HardDrive, Trash2, X } from 'lucide-react';
import { useState } from 'react';

const CATEGORIES = ['screenshots', 'exports', 'context'] as const;
type FileInfo = StorageFile;

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function isImageFile(name: string): boolean {
	return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name);
}

function isMarkdownFile(name: string): boolean {
	return /\.md$/i.test(name);
}

export default function StoragePage() {
	const [activeCategory, setActiveCategory] = useState<string>('screenshots');
	const [offset, setOffset] = useState(0);
	const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [previewMarkdown, setPreviewMarkdown] = useState<string | null>(null);
	const limit = 50;

	const { data: stats } = useStorageStatsQuery();
	const { data: filesData, isLoading } = useStorageFilesQuery({
		category: activeCategory,
		limit,
		offset,
	});
	const deleteMutation = useDeleteStorageFileMutation();

	const files = filesData?.files ?? [];
	const total = filesData?.total ?? 0;

	function closePreview() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		setPreviewFile(null);
		setPreviewUrl(null);
		setPreviewMarkdown(null);
	}

	function handleCategoryChange(cat: string) {
		setActiveCategory(cat);
		setOffset(0);
		closePreview();
	}

	async function handleDelete(file: FileInfo) {
		await deleteMutation.mutateAsync({
			category: file.category,
			domain: file.domain,
			filename: file.name,
		});
		if (previewFile?.path === file.path) closePreview();
	}

	async function handleDownload(file: FileInfo) {
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
	}

	async function handlePreview(file: FileInfo) {
		if (previewFile?.path === file.path) {
			closePreview();
			return;
		}
		const res = await apiFetch(`/api/storage/${file.category}/${file.domain}/${file.name}`);
		if (res.ok) {
			if (isMarkdownFile(file.name)) {
				const text = await res.text();
				if (previewUrl) URL.revokeObjectURL(previewUrl);
				setPreviewUrl(null);
				setPreviewMarkdown(text);
				setPreviewFile(file);
			} else if (isImageFile(file.name)) {
				const blob = await res.blob();
				if (previewUrl) URL.revokeObjectURL(previewUrl);
				const url = URL.createObjectURL(blob);
				setPreviewUrl(url);
				setPreviewMarkdown(null);
				setPreviewFile(file);
			}
		}
	}

	const canPreview = (file: FileInfo) => isImageFile(file.name) || isMarkdownFile(file.name);

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
					{stats
						? `${stats.totalFiles} files · ${formatSize(stats.totalSizeBytes)} / ${formatSize(stats.maxSizeBytes)}`
						: 'Loading...'}
				</p>
			</div>

			{/* Category tabs */}
			<div className="flex gap-0 border-b border-border">
				{CATEGORIES.map((cat) => (
					<button
						key={cat}
						onClick={() => handleCategoryChange(cat)}
						className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
							activeCategory === cat
								? 'border-foreground text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground'
						}`}
					>
						{cat.charAt(0).toUpperCase() + cat.slice(1)}
						{stats?.categories?.[cat] && (
							<span className="ml-2 text-[10px] text-muted-foreground font-mono">
								{stats.categories[cat].files}
							</span>
						)}
					</button>
				))}
			</div>

			{/* File list */}
			{isLoading ? (
				<div className="flex items-center gap-2 py-8">
					<span className="status-pixel bg-muted-foreground animate-pulse" />
					<p className="text-sm font-mono text-muted-foreground">Loading...</p>
				</div>
			) : files.length === 0 ? (
				<div className="border border-border py-16 text-center">
					<HardDrive size={24} strokeWidth={1.5} className="mx-auto text-muted-foreground mb-3" />
					<p className="text-sm text-muted-foreground">No {activeCategory} files yet.</p>
				</div>
			) : (
				<div className="space-y-6">
					{Object.entries(grouped).map(([domain, domainFiles]) => (
						<div key={domain}>
							<h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
								{domain}
							</h3>

							<div className="border border-border">
								<div className="grid grid-cols-[1fr_80px_100px_80px] gap-2 px-3 py-1.5 border-b border-border bg-surface text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
									<span>Name</span>
									<span>Size</span>
									<span>Date</span>
									<span className="text-right">Actions</span>
								</div>

								{domainFiles.map((file) => (
									<div key={file.path}>
										<div
											className={`grid grid-cols-[1fr_80px_100px_80px] gap-2 items-center px-3 py-2 border-b border-border/50 transition-colors ${
												canPreview(file) ? 'cursor-pointer hover:bg-surface' : ''
											} ${previewFile?.path === file.path ? 'bg-surface' : ''}`}
											onClick={() => canPreview(file) && handlePreview(file)}
										>
											<div className="flex items-center gap-2 min-w-0">
												{isImageFile(file.name) ? (
													<Eye size={13} strokeWidth={1.5} className="text-muted-foreground shrink-0" />
												) : (
													<FileText size={13} strokeWidth={1.5} className="text-muted-foreground shrink-0" />
												)}
												<span className="text-sm font-mono truncate">{file.name}</span>
											</div>
											<span className="text-xs font-mono text-muted-foreground">
												{formatSize(file.sizeBytes)}
											</span>
											<span className="text-xs font-mono text-muted-foreground">
												{new Date(file.createdAt).toLocaleDateString()}
											</span>
											<div className="flex items-center justify-end gap-0.5">
												<button
													onClick={(e) => {
														e.stopPropagation();
														handleDownload(file);
													}}
													className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
													title="Download"
												>
													<Download size={13} strokeWidth={1.5} />
												</button>
												<button
													onClick={(e) => {
														e.stopPropagation();
														handleDelete(file);
													}}
													className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
													title="Delete"
												>
													<Trash2 size={13} strokeWidth={1.5} />
												</button>
											</div>
										</div>

										{previewFile?.path === file.path && (previewUrl || previewMarkdown) && (
											<div className="border-b border-border bg-surface p-4">
												<div className="flex items-center justify-between mb-3">
													<span className="text-xs font-mono text-muted-foreground">
														{file.name}
													</span>
													<button
														onClick={closePreview}
														className="p-1 text-muted-foreground hover:text-foreground"
													>
														<X size={14} strokeWidth={1.5} />
													</button>
												</div>

												{previewUrl && (
													<img src={previewUrl} alt={file.name} className="w-full border border-border" />
												)}

												{previewMarkdown !== null && (
													<div className="border border-border p-4 bg-background">
														<MarkdownPreview content={previewMarkdown} />
													</div>
												)}

												<div className="flex items-center gap-2 mt-3">
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleDownload(file)}
														className="gap-1.5 text-xs"
													>
														<Download size={12} strokeWidth={1.5} /> Download
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleDelete(file)}
														className="gap-1.5 text-xs text-destructive hover:text-destructive"
													>
														<Trash2 size={12} strokeWidth={1.5} /> Delete
													</Button>
												</div>
											</div>
										)}
									</div>
								))}
							</div>
						</div>
					))}

					<Pagination offset={offset} limit={limit} total={total} onPageChange={setOffset} />
				</div>
			)}
		</div>
	);
}
