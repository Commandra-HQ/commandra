'use client';

import { useAuth } from '@/lib/auth-context';
import {
  Bot,
  Brain,
  Globe,
  HardDrive,
  History,
  Home,
  Settings,
  Shield,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

const NAV_META: Record<
  string,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{
      size?: number;
      className?: string;
      strokeWidth?: number;
    }>;
  }
> = {
  '/': {
    label: 'Dashboard',
    description: 'Overview and quick actions',
    icon: Home,
  },
  '/history': {
    label: 'History',
    description: 'Browse past conversations',
    icon: History,
  },
  '/audit': {
    label: 'Audit Log',
    description: 'Every action the agent has taken',
    icon: Shield,
  },
  '/sites': {
    label: 'Sites',
    description: 'Indexed web applications',
    icon: Globe,
  },
  '/agents': {
    label: 'Agents',
    description: 'Specialized agents with custom identities',
    icon: Bot,
  },
  '/memory': {
    label: 'Memory',
    description: 'Agent learned preferences and corrections',
    icon: Brain,
  },
  '/storage': {
    label: 'Storage',
    description: 'Screenshots, exports, and context files',
    icon: HardDrive,
  },
  '/settings': {
    label: 'Settings',
    description: 'LLM provider configuration',
    icon: Settings,
  },
  '/org': {
    label: 'Organization',
    description: 'Team members and roles',
    icon: Bot,
  },
};

export function Topbar() {
  const pathname = usePathname();
  const { user } = useAuth();

  // Match the current route to nav metadata
  const routeKey =
    Object.keys(NAV_META).find(key =>
      key === '/' ? pathname === '/' : pathname.startsWith(key),
    ) || '/';
  const meta = NAV_META[routeKey];
  const Icon = meta.icon;

  return (
    <header className="h-12 border-b border-border bg-background flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        <Icon size={16} strokeWidth={1.5} className="text-muted-foreground" />
        <div className="flex items-baseline gap-2">
          <h1 className="text-xs font-mono font-medium text-foreground">
            {meta.label}
          </h1>
          <span className="hidden sm:inline text-xs font-mono text-muted-foreground">
            {meta.description}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {user?.email && (
          <span className="text-[10px] font-mono text-muted-foreground">
            {user.email}
          </span>
        )}
      </div>
    </header>
  );
}
