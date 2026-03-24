/**
 * Shared text similarity utilities — used by self-improvement, knowledge merging,
 * and memory deduplication to avoid storing near-duplicate entries.
 */

/**
 * Strip date prefix, list marker, lowercase, normalize whitespace for comparison.
 */
export function normalizeEntry(line: string): string {
	return line
		.replace(/^- \[\d{4}-\d{2}-\d{2}\]\s*/, '')
		.replace(/^- /, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	const matrix: number[][] = [];
	for (let i = 0; i <= a.length; i++) matrix[i] = [i];
	for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1,
				matrix[i][j - 1] + 1,
				matrix[i - 1][j - 1] + cost,
			);
		}
	}
	return matrix[a.length][b.length];
}

/**
 * Normalized similarity (0-1) between two strings.
 */
export function similarity(a: string, b: string): number {
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Deduplicate incoming lines against existing lines using similarity matching.
 * Returns only the genuinely new lines from `incoming`.
 */
export function deduplicateLines(
	existing: string[],
	incoming: string[],
	threshold = 0.8,
): string[] {
	const normalizedExisting = existing.map(normalizeEntry);
	const accepted: string[] = [];

	for (const line of incoming) {
		const norm = normalizeEntry(line);
		if (!norm) continue;

		// Skip exact normalized match
		if (normalizedExisting.includes(norm)) continue;

		// Skip if too similar to any existing entry
		if (normalizedExisting.some((ex) => similarity(norm, ex) > threshold)) continue;

		// Skip if too similar to already-accepted new lines
		if (accepted.some((nl) => similarity(norm, normalizeEntry(nl)) > threshold)) continue;

		accepted.push(line);
	}

	return accepted;
}
