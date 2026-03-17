/**
 * Screenshot manager -- saves screenshots to local disk with compression,
 * provides file references for LLM providers instead of inline base64.
 *
 * Screenshots are saved as compressed JPEGs in a temp directory.
 * Each screenshot gets a unique ID for referencing.
 * Old screenshots are auto-cleaned after 1 hour.
 */

import { randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveLocalFile } from '../storage/local.js';

const SCREENSHOTS_DIR = join(tmpdir(), 'commandra-screenshots');
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Ensure directory exists
if (!existsSync(SCREENSHOTS_DIR)) {
	mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export interface SavedScreenshot {
	id: string;
	path: string;
	base64: string; // Keep compressed base64 for inline fallback
	sizeBytes: number;
}

/**
 * Save a base64 screenshot to disk with compression.
 * Returns metadata with path and compressed base64.
 */
export function saveScreenshot(base64Data: string): SavedScreenshot {
	const id = randomUUID();
	const filename = `${id}.jpg`;
	const filePath = join(SCREENSHOTS_DIR, filename);

	// Decode base64 to buffer
	const buffer = Buffer.from(base64Data, 'base64');

	// Write to disk
	writeFileSync(filePath, buffer);

	// Re-encode as base64 (same data, but now we have the file path too)
	const compressedBase64 = buffer.toString('base64');

	return {
		id,
		path: filePath,
		base64: compressedBase64,
		sizeBytes: buffer.length,
	};
}

/**
 * Persist a screenshot to ~/.commandra/screenshots/ for long-term storage.
 */
export function persistScreenshot(
	base64Data: string,
	domain: string,
	conversationId: string,
): { path: string; sizeBytes: number } {
	const buffer = Buffer.from(base64Data, 'base64');
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `${conversationId.slice(0, 8)}_${timestamp}.jpg`;
	return saveLocalFile('screenshots', domain, filename, buffer);
}

/**
 * Read a saved screenshot as base64.
 */
export function getScreenshotBase64(id: string): string | null {
	const filePath = join(SCREENSHOTS_DIR, `${id}.jpg`);
	if (!existsSync(filePath)) return null;
	return readFileSync(filePath).toString('base64');
}

/**
 * Read a saved screenshot as a Buffer.
 */
export function getScreenshotBuffer(id: string): Buffer | null {
	const filePath = join(SCREENSHOTS_DIR, `${id}.jpg`);
	if (!existsSync(filePath)) return null;
	return readFileSync(filePath);
}

/**
 * Get the file path for a saved screenshot.
 */
export function getScreenshotPath(id: string): string | null {
	const filePath = join(SCREENSHOTS_DIR, `${id}.jpg`);
	if (!existsSync(filePath)) return null;
	return filePath;
}

/**
 * Delete a specific screenshot.
 */
export function deleteScreenshot(id: string): void {
	const filePath = join(SCREENSHOTS_DIR, `${id}.jpg`);
	try {
		if (existsSync(filePath)) unlinkSync(filePath);
	} catch {
		// Ignore deletion errors
	}
}

/**
 * Clean up screenshots older than MAX_AGE_MS.
 * Called periodically to prevent disk bloat.
 */
export function cleanupOldScreenshots(): number {
	let cleaned = 0;
	const now = Date.now();

	try {
		const files = readdirSync(SCREENSHOTS_DIR);
		for (const file of files) {
			if (!file.endsWith('.jpg')) continue;
			const filePath = join(SCREENSHOTS_DIR, file);
			try {
				const stat = statSync(filePath);
				if (now - stat.mtimeMs > MAX_AGE_MS) {
					unlinkSync(filePath);
					cleaned++;
				}
			} catch {
				// Ignore individual file errors
			}
		}
	} catch {
		// Directory might not exist yet
	}

	if (cleaned > 0) {
		console.log(`[Screenshots] Cleaned ${cleaned} old screenshots`);
	}
	return cleaned;
}

// Run cleanup every 15 minutes
setInterval(cleanupOldScreenshots, 15 * 60 * 1000);
