'use client';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import {
	Bot,
	Brain,
	Building2,
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
import { useState } from 'react';

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
	const { user, logout } = useAuth();

	const navItems = user?.orgId
		? [...baseNavItems, { href: '/org', label: 'Organization', icon: Building2 }]
		: baseNavItems;

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
					'fixed inset-y-0 left-0 z-40 w-56 flex flex-col bg-surface border-r border-border transition-transform duration-200 md:translate-x-0 md:static',
					mobileOpen ? 'translate-x-0' : '-translate-x-full',
				)}
			>
				{/* Logo */}
				<div className="flex items-center gap-2.5 px-4 h-14 border-b border-border">
					<VoxelLogo size={22} className="text-foreground" />
					<span className="font-mono text-sm font-medium lowercase tracking-wide text-foreground">
						commandra
					</span>
				</div>

				{/* Nav */}
				<nav className="flex-1 px-2 py-3 space-y-0.5">
					{navItems.map((item) => {
						const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
						return (
							<Link
								key={item.href}
								href={item.href}
								onClick={() => setMobileOpen(false)}
								className={cn(
									'flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors',
									isActive
										? 'bg-elevated text-foreground'
										: 'text-muted-foreground hover:bg-elevated/50 hover:text-foreground',
								)}
							>
								<item.icon size={16} strokeWidth={1.5} />
								{item.label}
							</Link>
						);
					})}
				</nav>

				{/* Divider */}
				<div className="mx-3 h-px bg-border" />

				{/* User */}
				{/* Theme toggle */}
				<div className="px-3 py-1 flex items-center justify-between">
					<span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Theme</span>
					<ThemeToggle />
				</div>

				<div className="mx-3 h-px bg-border" />

				<div className="p-3 flex items-center gap-3">
					<div className="h-7 w-7 bg-elevated flex items-center justify-center border border-border">
						<span className="text-[10px] font-mono font-medium text-muted-foreground">
							{user?.email?.charAt(0).toUpperCase() || '?'}
						</span>
					</div>
					<div className="flex-1 min-w-0">
						<p className="text-xs font-mono text-muted-foreground truncate">{user?.email}</p>
					</div>
					<button
						onClick={logout}
						className="text-muted-foreground hover:text-foreground transition-colors"
						title="Sign out"
					>
						<LogOut size={14} strokeWidth={1.5} />
					</button>
				</div>
			</aside>
		</>
	);
}
