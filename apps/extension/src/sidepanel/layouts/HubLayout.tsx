/**
 * HubLayout — top-level layout with header, tab bar, and router outlet.
 * Tab bar extracted to TabBar component for maintainability.
 */

import {
	Copy,
	ExternalLink,
	Globe,
	History,
	Plus,
	RefreshCw,
	Settings,
	X,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { HistoryDrawer } from '../components/HistoryDrawer.js';
import { VoxelLogo } from '../components/VoxelLogo.js';
import { TabBar, type Tab } from '../components/TabBar.js';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

export function HubLayout() {
	const navigate = useNavigate();
	const params = useParams();
	const convId = params.conversationId;

	const [historyOpen, setHistoryOpen] = useState(false);
	const [globalMenuOpen, setGlobalMenuOpen] = useState(false);
	const [tabMenuOpen, setTabMenuOpen] = useState<string | null>(null);
	const [tabs, setTabs] = useState<Tab[]>([]);
	const [currentDomain, setCurrentDomain] = useState('');

	// Track browser tab domain
	const updateDomain = useCallback(() => {
		chrome.tabs.query({ active: true, currentWindow: true }, (t) => {
			if (t[0]?.url) {
				try {
					setCurrentDomain(new URL(t[0].url).hostname);
				} catch {}
			}
		});
	}, []);

	useEffect(() => {
		updateDomain();
		const h = () => updateDomain();
		chrome.tabs.onActivated.addListener(h);
		chrome.tabs.onUpdated.addListener(h);
		return () => {
			chrome.tabs.onActivated.removeListener(h);
			chrome.tabs.onUpdated.removeListener(h);
		};
	}, [updateDomain]);

	// Sync tabs with current conversation
	useEffect(() => {
		if (convId && !tabs.find((t) => t.id === convId)) {
			setTabs((prev) => [
				...prev,
				{ id: convId, label: currentDomain || 'Chat' },
			]);
		}
	}, [convId, currentDomain, tabs]);

	const isNewChat = !convId;

	function openConversation(id: string) {
		navigate(`/chat/${id}`);
	}

	function startNewChat() {
		navigate('/');
	}

	function closeTab(id: string) {
		setTabs((prev) => {
			const remaining = prev.filter((t) => t.id !== id);
			// If closing the active tab, switch to another tab or new chat
			if (convId === id) {
				if (remaining.length > 0) {
					// Find the tab that was adjacent
					const closedIndex = prev.findIndex((t) => t.id === id);
					const nextTab = remaining[Math.min(closedIndex, remaining.length - 1)];
					navigate(`/chat/${nextTab.id}`);
				} else {
					navigate('/');
				}
			}
			return remaining;
		});
		setTabMenuOpen(null);
	}

	function dispatchAction(action: string) {
		window.dispatchEvent(
			new CustomEvent('commandra-tab-action', { detail: { action } }),
		);
		setTabMenuOpen(null);
	}

	return (
		<>
			<div className="flex flex-col border-b border-border bg-surface flex-shrink-0">
				{/* Top bar */}
				<div className="h-11 px-3 flex items-center justify-between">
					<div className="flex items-center gap-1.5">
						<button
							onClick={() => setHistoryOpen(true)}
							className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
							title="History"
						>
							<History size={15} strokeWidth={1.5} />
						</button>
						<button
							onClick={startNewChat}
							className="py-1 flex items-center gap-2"
						>
							<VoxelLogo size={18} className="text-foreground" />
							<span className="font-mono text-sm font-medium tracking-wide text-foreground">
								Commandra
							</span>
						</button>
					</div>
					<div className="flex items-center gap-0.5">
						<div className="relative">
							<button
								onClick={() => setGlobalMenuOpen(!globalMenuOpen)}
								className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
							>
								<Settings size={15} strokeWidth={1.5} />
							</button>
							{globalMenuOpen && (
								<>
									<div
										className="fixed inset-0 z-40"
										onClick={() => setGlobalMenuOpen(false)}
										role="presentation"
									/>
									<div className="absolute right-0 top-full mt-1 z-50 w-44 border border-border bg-card py-1 shadow-lg">
										<button
											onClick={() => {
												setGlobalMenuOpen(false);
												chrome.tabs.create({ url: DASHBOARD_URL });
											}}
											className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-elevated"
										>
											<ExternalLink size={12} strokeWidth={1.5} /> Dashboard
										</button>
										<button
											onClick={() => {
												setGlobalMenuOpen(false);
												navigate('/settings');
											}}
											className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-elevated"
										>
											<Settings size={12} strokeWidth={1.5} /> Settings
										</button>
										<div className="my-1 h-px bg-border" />
										<button
											onClick={() => {
												setGlobalMenuOpen(false);
												window.close();
											}}
											className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-elevated"
										>
											<X size={12} strokeWidth={1.5} /> Close
										</button>
									</div>
								</>
							)}
						</div>
					</div>
				</div>

				{/* Tab bar */}
				<TabBar
					tabs={tabs}
					activeTabId={convId}
					isNewChat={isNewChat}
					onNewChat={startNewChat}
					onSelectTab={openConversation}
					onCloseTab={closeTab}
					onTabMenuOpen={setTabMenuOpen}
					tabMenuOpen={tabMenuOpen}
				/>
			</div>

			{/* Tab context menu — rendered outside tab bar to avoid clipping */}
			{tabMenuOpen && (
				<>
					<div
						className="fixed inset-0 z-40"
						onClick={() => setTabMenuOpen(null)}
						role="presentation"
					/>
					<div
						className="absolute left-4 z-50 w-40 border border-border bg-card py-1 shadow-lg"
						style={{ top: '84px' }}
					>
						<button
							onClick={() => dispatchAction('copy-chat')}
							className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-elevated"
						>
							<Copy size={11} strokeWidth={1.5} /> Copy chat
						</button>
						<button
							onClick={() => {
								setTabMenuOpen(null);
								startNewChat();
							}}
							className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-foreground hover:bg-elevated"
						>
							<Plus size={11} strokeWidth={1.5} /> New chat
						</button>
						<div className="my-1 h-px bg-border" />
						<button
							onClick={() => dispatchAction('reindex')}
							className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-elevated"
						>
							<RefreshCw size={11} strokeWidth={1.5} /> Re-index page
						</button>
						<button
							onClick={() => dispatchAction('deep-index')}
							className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-elevated"
						>
							<Globe size={11} strokeWidth={1.5} /> Deep index site
						</button>
						<div className="my-1 h-px bg-border" />
						<button
							onClick={() => closeTab(tabMenuOpen)}
							className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-destructive hover:bg-elevated"
						>
							<X size={11} strokeWidth={1.5} /> Close tab
						</button>
					</div>
				</>
			)}

			<div className="flex-1 overflow-hidden">
				<Outlet />
			</div>

			<HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
		</>
	);
}
