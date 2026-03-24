'use client';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import {
	Bot,
	Brain,
	Building2,
	ChevronsLeft,
	ChevronsRight,
	Globe,
	HardDrive,
	History,
	Home,
	LogOut,
	Menu,
	Settings,
	Shield,
	X,
} from 'lucide-react';
import { VoxelLogo } from '@/components/voxel-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const baseNavItems = [
	{ href: '/', label: 'Home', icon: Home },
	{ href: '/history', label: 'History', icon: History },
	{ href: '/audit', label: 'Audit Log', icon: Shield },
	{ href: '/sites', label: 'Sites', icon: Globe },
	{ href: '/agents', label: 'Agents', icon: Bot },
	{ href: '/memory', label: 'Memory', icon: Brain },
	{ href: '/storage', label: 'Storage', icon: HardDrive },
	{ href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
	const pathname = usePathname();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(false);
	const { user, logout } = useAuth();

	// Persist collapsed state
	useEffect(() => {
		const saved = localStorage.getItem('sidebar-collapsed');
		if (saved === 'true') setCollapsed(true);
	}, []);

	function toggleCollapsed() {
		const next = !collapsed;
		setCollapsed(next);
		localStorage.setItem('sidebar-collapsed', String(next));
	}

	const navItems = user?.orgId
		? [...baseNavItems, { href: '/org', label: 'Organization', icon: Building2 }]
		: baseNavItems;

	const sidebarWidth = collapsed ? 'w-14' : 'w-56';

	return (
		<>
			{/* Mobile toggle */}
			<Button
				variant="ghost"
				size="icon"
				className="fixed top-3 left-3 z-50 md:hidden"
				onClick={() => setMobileOpen(!mobileOpen)}
			>
				{mobileOpen ? <X size={18} strokeWidth={1.5} /> : <Menu size={18} strokeWidth={1.5} />}
			</Button>

			{/* Overlay */}
			{mobileOpen && (
				<div
					className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 md:hidden"
					onClick={() => setMobileOpen(false)}
					onKeyDown={() => {}}
					role="presentation"
				/>
			)}

			{/* Sidebar */}
			<aside
				className={cn(
					'fixed inset-y-0 left-0 z-40 flex flex-col bg-surface border-r border-border transition-all duration-200 md:translate-x-0 md:static',
					sidebarWidth,
					mobileOpen ? 'translate-x-0' : '-translate-x-full',
				)}
			>
				{/* Logo */}
				<div className={cn('flex items-center h-14 border-b border-border', collapsed ? 'justify-center px-0' : 'gap-2.5 px-4')}>
					<VoxelLogo size={collapsed ? 18 : 22} className="text-foreground flex-shrink-0" />
					{!collapsed && (
						<span className="font-mono text-sm font-medium lowercase tracking-wide text-foreground">
							commandra
						</span>
					)}
				</div>

				{/* Nav */}
				<nav className={cn('flex-1 py-3 space-y-0.5', collapsed ? 'px-1' : 'px-2')}>
					{navItems.map((item) => {
						const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
						return (
							<Link
								key={item.href}
								href={item.href}
								onClick={() => setMobileOpen(false)}
								title={collapsed ? item.label : undefined}
								className={cn(
									'flex items-center text-sm font-medium transition-colors',
									collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
									isActive
										? 'bg-elevated text-foreground'
										: 'text-muted-foreground hover:bg-elevated/50 hover:text-foreground',
								)}
							>
								<item.icon size={16} strokeWidth={1.5} className="flex-shrink-0" />
								{!collapsed && item.label}
							</Link>
						);
					})}
				</nav>

				{/* Bottom section */}
				<div className="mt-auto">
					{/* Divider */}
					<div className={cn('h-px bg-border', collapsed ? 'mx-1' : 'mx-3')} />

					{/* Theme toggle */}
					<div className={cn('flex items-center', collapsed ? 'justify-center py-2' : 'justify-between px-3 py-1')}>
						{!collapsed && (
							<span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
								Theme
							</span>
						)}
						<ThemeToggle />
					</div>

					{/* Divider */}
					<div className={cn('h-px bg-border', collapsed ? 'mx-1' : 'mx-3')} />

					{/* User */}
					<div className={cn('flex items-center', collapsed ? 'flex-col gap-2 p-2' : 'gap-3 p-3')}>
						<div className={cn('bg-elevated flex items-center justify-center border border-border flex-shrink-0', collapsed ? 'h-7 w-7' : 'h-7 w-7')}>
							<span className="text-[10px] font-mono font-medium text-muted-foreground">
								{user?.email?.charAt(0).toUpperCase() || '?'}
							</span>
						</div>
						{!collapsed && (
							<div className="flex-1 min-w-0">
								<p className="text-xs font-mono text-muted-foreground truncate">{user?.email}</p>
							</div>
						)}
						<button
							onClick={logout}
							className="text-muted-foreground hover:text-foreground transition-colors"
							title="Sign out"
						>
							<LogOut size={14} strokeWidth={1.5} />
						</button>
					</div>

					{/* Collapse toggle */}
					<div className={cn('h-px bg-border', collapsed ? 'mx-1' : 'mx-3')} />
					<button
						onClick={toggleCollapsed}
						className={cn(
							'w-full flex items-center text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors',
							collapsed ? 'justify-center py-2.5' : 'gap-2 px-4 py-2.5',
						)}
						title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
					>
						{collapsed ? (
							<ChevronsRight size={14} strokeWidth={1.5} />
						) : (
							<>
								<ChevronsLeft size={14} strokeWidth={1.5} />
								<span className="text-[10px] font-mono uppercase tracking-wider">Collapse</span>
							</>
						)}
					</button>
				</div>
			</aside>
		</>
	);
}
