/**
 * TabBar — conversation tab strip with running indicators.
 * Extracted from HubLayout for maintainability.
 */

import { MoreVertical, Plus, X } from 'lucide-react';
import { useActiveChats } from '../contexts/active-chats.js';

export interface Tab {
	id: string;
	label: string;
}

interface TabBarProps {
	tabs: Tab[];
	activeTabId: string | undefined;
	isNewChat: boolean;
	onNewChat: () => void;
	onSelectTab: (id: string) => void;
	onCloseTab: (id: string) => void;
	onTabMenuOpen: (id: string | null) => void;
	tabMenuOpen: string | null;
}

export function TabBar({
	tabs,
	activeTabId,
	isNewChat,
	onNewChat,
	onSelectTab,
	onCloseTab,
	onTabMenuOpen,
	tabMenuOpen,
}: TabBarProps) {
	const { activeChats } = useActiveChats();

	return (
		<div className="flex items-center border-t border-border">
			{/* New chat tab */}
			<div
				className={`flex items-center gap-1.5 border-r border-border px-3 py-2 cursor-pointer transition-colors flex-shrink-0 ${
					isNewChat
						? 'bg-background text-foreground'
						: 'bg-surface text-muted-foreground hover:text-foreground hover:bg-elevated'
				}`}
				onClick={onNewChat}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => e.key === 'Enter' && onNewChat()}
			>
				<Plus size={11} strokeWidth={2} className="flex-shrink-0" />
				<span className="font-mono text-[11px]">New</span>
			</div>

			{/* Conversation tabs */}
			<div className="flex items-center flex-1 overflow-x-auto min-w-0">
				{tabs.map((tab) => {
					const isSelected = activeTabId === tab.id;
					const isRunning = activeChats.has(tab.id);
					return (
						<div
							key={tab.id}
							className={`group flex items-center gap-1.5 border-r border-border px-2.5 py-2 min-w-0 max-w-[160px] cursor-pointer transition-colors flex-shrink-0 ${
								isSelected
									? 'bg-background text-foreground'
									: 'bg-surface text-muted-foreground hover:text-foreground hover:bg-elevated'
							}`}
							onClick={() => onSelectTab(tab.id)}
							role="button"
							tabIndex={0}
							onKeyDown={(e) => e.key === 'Enter' && onSelectTab(tab.id)}
						>
							<span
								className="status-pixel flex-shrink-0"
								style={{
									backgroundColor: isRunning
										? 'hsl(var(--success))'
										: 'hsl(var(--dim))',
								}}
							/>
							<span className="font-mono text-[11px] truncate flex-1">
								{tab.label}
							</span>

							{/* Tab menu */}
							<div className="relative flex-shrink-0">
								<button
									onClick={(e) => {
										e.stopPropagation();
										onTabMenuOpen(tabMenuOpen === tab.id ? null : tab.id);
									}}
									className="p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
								>
									<MoreVertical size={10} strokeWidth={1.5} />
								</button>
							</div>

							{/* Close button */}
							<button
								onClick={(e) => {
									e.stopPropagation();
									onCloseTab(tab.id);
								}}
								className="p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground flex-shrink-0"
							>
								<X size={10} strokeWidth={2} />
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}
