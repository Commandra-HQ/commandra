'use client';

import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import {
  Activity,
  Bot,
  Brain,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Globe,
  HardDrive,
  History,
  Home,
  LogOut,
  Moon,
  Shield,
  Sun,
  X,
} from 'lucide-react';
import { VoxelLogo } from '@/components/voxel-logo';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

// Hook so the Topbar can open the mobile sidebar via custom DOM event
export function useSidebarMobile() {
  return { openMobile: () => window.dispatchEvent(new CustomEvent('sidebar-open-mobile')) };
}



const baseNavItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/history', label: 'History', icon: History },
  { href: '/audit', label: 'Audit Log', icon: Shield },
  { href: '/sites', label: 'Sites', icon: Globe },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/schedules', label: 'Schedules', icon: Clock },
  { href: '/memory', label: 'Memory', icon: Brain },
  { href: '/storage', label: 'Storage', icon: HardDrive },
  { href: '/usage', label: 'Usage', icon: Activity },
];

const MIN_WIDTH = 56;
const COLLAPSE_THRESHOLD = 140;
const MAX_WIDTH = 280;
const DEFAULT_WIDTH = 220;

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [logoHovered, setLogoHovered] = useState(false);

  useEffect(() => setMounted(true), []);

  // Persist state
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    const savedWidth = localStorage.getItem('sidebar-width');
    if (saved === 'true') setCollapsed(true);
    if (savedWidth) {
      const w = Number(savedWidth);
      if (w >= COLLAPSE_THRESHOLD) {
        setWidth(w);
      } else {
        setCollapsed(true);
        localStorage.setItem('sidebar-collapsed', 'true');
      }
    }
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar-collapsed', String(next));
  }

  // Resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    function handleMouseMove(e: MouseEvent) {
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      if (newWidth < COLLAPSE_THRESHOLD) {
        setCollapsed(true);
        localStorage.setItem('sidebar-collapsed', 'true');
      } else {
        setCollapsed(false);
        setWidth(newWidth);
        localStorage.setItem('sidebar-collapsed', 'false');
        localStorage.setItem('sidebar-width', String(newWidth));
      }
    }

    function handleMouseUp() {
      setIsResizing(false);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const navItems = user?.orgId
    ? [
        ...baseNavItems,
        { href: '/org', label: user.orgName || 'Organization', icon: Building2 },
      ]
    : baseNavItems;

  const sidebarW = collapsed ? MIN_WIDTH : width;
  // On mobile, always render expanded (never icon-only mode)
  const isCollapsed = collapsed && !mobileOpen;

  // Listen for mobile open event from Topbar
  useEffect(() => {
    const handler = () => setMobileOpen(true);
    window.addEventListener('sidebar-open-mobile', handler);
    return () => window.removeEventListener('sidebar-open-mobile', handler);
  }, []);

  return (
    <>
      {/* Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
          role="presentation"
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-surface border-r border-border md:translate-x-0 md:static select-none overflow-hidden',
          mobileOpen ? 'translate-x-0 !w-[220px]' : '-translate-x-full',
          isResizing ? '' : 'transition-all duration-200',
        )}
        style={{ width: sidebarW }}
      >
        {/* Header: Logo + Collapse toggle */}
        <div
          className={cn(
            'flex items-center h-12 border-b border-border flex-shrink-0',
            isCollapsed ? 'justify-center px-0' : 'justify-between px-3',
          )}
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
        >
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <VoxelLogo
                size={isCollapsed ? 18 : 20}
                className="text-foreground flex-shrink-0"
                hovered={logoHovered}
              />

              <span className="font-mono text-xs font-medium lowercase tracking-wide text-foreground whitespace-nowrap">
                commandra
              </span>
            </div>
          )}
          {!isCollapsed && !mobileOpen && (
            <button
              onClick={toggleCollapsed}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Collapse"
            >
              <ChevronsLeft size={14} strokeWidth={1.5} />
            </button>
          )}
          {mobileOpen && (
            <button
              onClick={() => setMobileOpen(false)}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Close menu"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          )}
          {isCollapsed && (
            <button
              onClick={toggleCollapsed}
              className="w-full flex items-center justify-center p-3 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
              title="Expand sidebar"
            >
              <ChevronsRight size={16} strokeWidth={1.5} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav
          className={cn(
            'flex-1 py-2 space-y-0.5 overflow-y-auto',
            isCollapsed ? 'px-1' : 'px-2',
          )}
        >
          {navItems.map(item => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  'flex items-center text-sm font-medium transition-colors',
                  isCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-1.5',
                  isActive
                    ? 'bg-elevated text-foreground'
                    : 'text-muted-foreground hover:bg-elevated/50 hover:text-foreground',
                )}
              >
                <item.icon
                  size={16}
                  strokeWidth={1.5}
                  className="flex-shrink-0"
                />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: theme + user */}
        <div className="flex-shrink-0">
          <div className={cn('h-px bg-border', isCollapsed ? 'mx-1' : 'mx-2')} />

          <div
            className={cn(
              'flex items-center',
              isCollapsed ? 'flex-col gap-1 py-2' : 'gap-2 px-3 py-2',
            )}
          >
            {/* Theme toggle */}
            {mounted && (
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              >
                {theme === 'dark' ? (
                  <Sun size={14} strokeWidth={1.5} />
                ) : (
                  <Moon size={14} strokeWidth={1.5} />
                )}
              </button>
            )}

            {!isCollapsed && (
              <>
                {/* User */}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono text-muted-foreground truncate">
                    {user?.email}
                  </p>
                </div>
              </>
            )}

            {/* Logout */}
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Sign out"
            >
              <LogOut size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </aside>

      {/* Resize handle */}
      {!collapsed && (
        <div
          className="hidden md:block w-1 cursor-col-resize hover:bg-foreground/10 active:bg-foreground/20 transition-colors flex-shrink-0"
          onMouseDown={handleMouseDown}
        />
      )}
    </>
  );
}
