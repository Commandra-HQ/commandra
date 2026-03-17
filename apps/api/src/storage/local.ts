/**
 * Local storage manager — persistent file storage on the host machine.
 *
 * Saves screenshots, exports, and context files to ~/.commandra/
 * Provides CRUD operations and size-based cleanup.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

const COMMANDRA_HOME = process.env.COMMANDRA_HOME || join(homedir(), '.commandra');
const CATEGORIES = ['screenshots', 'exports', 'context'] as const;
export type StorageCategory = (typeof CATEGORIES)[number];

const MAX_STORAGE_MB = Number(process.env.COMMANDRA_MAX_STORAGE_MB) || 1024;

export function initLocalStorage(): void {
	for (const category of CATEGORIES) {
		const dir = join(COMMANDRA_HOME, category);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}
	console.log(`[Storage] Local storage initialized at ${COMMANDRA_HOME}`);
}

export function saveLocalFile(
	category: StorageCategory,
	domain: string,
	filename: string,
	data: Buffer | string,
): { path: string; sizeBytes: number } {
	const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
	const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
	const dir = join(COMMANDRA_HOME, category, safeDomain);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const filePath = join(dir, safeFilename);
	const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
	writeFileSync(filePath, buffer);

	return { path: relative(COMMANDRA_HOME, filePath), sizeBytes: buffer.length };
}

export interface LocalFileInfo {
	name: string;
	path: string;
	domain: string;
	category: StorageCategory;
	sizeBytes: number;
	createdAt: number;
}

export function listLocalFiles(category: StorageCategory, domain?: string): LocalFileInfo[] {
	const categoryDir = join(COMMANDRA_HOME, category);
	if (!existsSync(categoryDir)) return [];

	const files: LocalFileInfo[] = [];

	const domains = domain
		? [domain.replace(/[^a-zA-Z0-9.-]/g, '_')]
		: readdirSync(categoryDir).filter((d) => {
				try {
					return statSync(join(categoryDir, d)).isDirectory();
				} catch {
					return false;
				}
			});

	for (const d of domains) {
		const domainDir = join(categoryDir, d);
		if (!existsSync(domainDir)) continue;
		try {
			const entries = readdirSync(domainDir);
			for (const entry of entries) {
				const filePath = join(domainDir, entry);
				try {
					const stat = statSync(filePath);
					if (stat.isFile()) {
						files.push({
							name: entry,
							path: `${category}/${d}/${entry}`,
							domain: d,
							category,
							sizeBytes: stat.size,
							createdAt: stat.birthtimeMs,
						});
					}
				} catch {
					// skip unreadable files
				}
			}
		} catch {
			// skip unreadable directories
		}
	}

	return files.sort((a, b) => b.createdAt - a.createdAt);
}

export function getLocalFile(filePath: string): Buffer | null {
	const fullPath = join(COMMANDRA_HOME, filePath);
	// Prevent directory traversal
	if (!fullPath.startsWith(COMMANDRA_HOME)) return null;
	if (!existsSync(fullPath)) return null;
	return readFileSync(fullPath);
}

export function deleteLocalFile(filePath: string): boolean {
	const fullPath = join(COMMANDRA_HOME, filePath);
	if (!fullPath.startsWith(COMMANDRA_HOME)) return false;
	try {
		if (existsSync(fullPath)) {
			unlinkSync(fullPath);
			return true;
		}
	} catch {
		// ignore
	}
	return false;
}

export function getStorageStats(): {
	totalSizeBytes: number;
	totalFiles: number;
	maxSizeBytes: number;
	categories: Record<string, { files: number; sizeBytes: number }>;
} {
	const stats: Record<string, { files: number; sizeBytes: number }> = {};
	let totalSize = 0;
	let totalFiles = 0;

	for (const category of CATEGORIES) {
		const files = listLocalFiles(category);
		const size = files.reduce((sum, f) => sum + f.sizeBytes, 0);
		stats[category] = { files: files.length, sizeBytes: size };
		totalSize += size;
		totalFiles += files.length;
	}

	return {
		totalSizeBytes: totalSize,
		totalFiles,
		maxSizeBytes: MAX_STORAGE_MB * 1024 * 1024,
		categories: stats,
	};
}

/**
 * Cleanup oldest files when storage exceeds the configured max.
 */
export function cleanupStorageIfNeeded(): number {
	const maxBytes = MAX_STORAGE_MB * 1024 * 1024;
	let allFiles: LocalFileInfo[] = [];

	for (const category of CATEGORIES) {
		allFiles = allFiles.concat(listLocalFiles(category));
	}

	let totalSize = allFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
	if (totalSize <= maxBytes) return 0;

	// Sort by oldest first
	allFiles.sort((a, b) => a.createdAt - b.createdAt);

	let cleaned = 0;
	for (const file of allFiles) {
		if (totalSize <= maxBytes * 0.9) break; // Clean to 90% of max
		if (deleteLocalFile(file.path)) {
			totalSize -= file.sizeBytes;
			cleaned++;
		}
	}

	if (cleaned > 0) {
		console.log(`[Storage] Cleaned ${cleaned} files to stay within ${MAX_STORAGE_MB}MB limit`);
	}
	return cleaned;
}
