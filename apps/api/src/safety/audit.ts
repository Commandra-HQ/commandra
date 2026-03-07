import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

interface AuditEntry {
	userId: string;
	action: string;
	safetyLevel: string;
	approved: boolean;
	metadata?: Record<string, unknown>;
}

export async function logAction(entry: AuditEntry): Promise<void> {
	try {
		await db.insert(auditLogs).values({
			userId: entry.userId,
			action: entry.action,
			safetyLevel: entry.safetyLevel,
			approved: entry.approved,
			metadata: entry.metadata ?? {},
		});
	} catch (err) {
		// Audit logging should never crash the main flow
		console.error('[Audit] Failed to log action:', err);
	}
}
