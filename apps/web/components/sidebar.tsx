'use client';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
				{mobileOpen ? <X size={20} /> : <Menu size={20} />}
			</Button>

			{/* Overlay */}
			{mobileOpen && (
				<div
					className="fixed inset-0 bg-black/50 z-40 md:hidden"
					onClick={() => setMobileOpen(false)}
					onKeyDown={() => {}}
					role="presentation"
				/>
			)}

			{/* Sidebar */}
			<aside
				className={cn(
					'fixed inset-y-0 left-0 z-40 w-56 flex flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-200 md:translate-x-0 md:static',
					mobileOpen ? 'translate-x-0' : '-translate-x-full',
				)}
			>
				{/* Logo */}
				<div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border">
					<div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
						<span className="text-primary-foreground text-xs font-bold">C</span>
					</div>
					<span className="font-semibold text-sm text-sidebar-foreground">Commandra</span>
				</div>

				{/* Nav */}
				<nav className="flex-1 px-2 py-3 space-y-1">
					{navItems.map((item) => {
						const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
						return (
							<Link
								key={item.href}
								href={item.href}
								onClick={() => setMobileOpen(false)}
								className={cn(
									'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
									isActive
										? 'bg-sidebar-accent text-sidebar-accent-foreground'
										: 'text-sidebar-foreground hover:bg-sidebar-accent/50',
								)}
							>
								<item.icon size={18} />
								{item.label}
							</Link>
						);
					})}
				</nav>

				<Separator />

				{/* User */}
				<div className="p-3 flex items-center gap-3">
					<div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
						<span className="text-xs font-medium text-primary">
							{user?.email?.charAt(0).toUpperCase() || '?'}
						</span>
					</div>
					<div className="flex-1 min-w-0">
						<p className="text-xs text-muted-foreground truncate">{user?.email}</p>
					</div>
					<button
						onClick={logout}
						className="text-muted-foreground hover:text-foreground transition-colors"
						title="Sign out"
					>
						<LogOut size={14} />
					</button>
				</div>
			</aside>
		</>
	);
}
