export type ElementType =
	| 'button'
	| 'link'
	| 'input'
	| 'select'
	| 'textarea'
	| 'checkbox'
	| 'radio'
	| 'table'
	| 'form'
	| 'other';

export interface IndexedElement {
	id: string;
	type: ElementType;
	label: string;
	selector: string;
	fallbackSelectors: string[];
	attributes: Record<string, string>;
	position: { x: number; y: number; width: number; height: number };
	visible: boolean;
	pageUrl: string;
}

export interface PageIndex {
	url: string;
	urlPattern: string;
	title: string;
	pageType: 'dashboard' | 'form' | 'table' | 'detail' | 'settings' | 'other';
	elements: IndexedElement[];
	navigationLinks: { label: string; href: string }[];
	timestamp: number;
}

export interface SiteIndex {
	domain: string;
	pages: PageIndex[];
	totalElements: number;
	lastUpdated: number;
}
