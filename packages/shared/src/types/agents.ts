export interface AgentConfig {
	id: string;
	slug: string;
	userId: string;
	name: string;
	description: string;
	model?: 'strong' | 'fast' | string;
	maxIterations?: number;
	tools?: string[];
	domains?: string[];
	soul?: string;
	skills?: string;
}
