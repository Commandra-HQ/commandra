/** Flow types shared between API and extension */

export interface FlowStep {
	index: number;
	intent: string;
	toolName: string;
	args: Record<string, unknown>;
	urlPattern: string;
	pageType: string;
	result?: {
		success: boolean;
		data?: unknown;
	};
}

export interface FlowParameter {
	name: string;
	stepIndex: number;
	argField: string;
	defaultValue?: string;
	description?: string;
}

export type FlowStatus = 'draft' | 'ready' | 'archived';
export type FlowRunStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface Flow {
	id: string;
	name: string;
	description?: string;
	domain: string;
	steps: FlowStep[];
	parameters: FlowParameter[];
	status: FlowStatus;
	lastRunAt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface FlowRun {
	id: string;
	flowId: string;
	parameterValues: Record<string, string>;
	stepResults: StepResult[];
	status: FlowRunStatus;
	stepsCompleted: number;
	totalSteps: number;
	error?: string;
	startedAt: string;
	completedAt?: string;
}

export interface StepResult {
	stepIndex: number;
	success: boolean;
	toolName: string;
	result?: unknown;
	error?: string;
	duration: number;
}
