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
  Moon,
  Settings,
  Shield,
  Sun,
  X,
} from 'lucide-react';
import { VoxelLogo } from '@/components/voxel-logo';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';



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

const MIN_WIDTH = 56;
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
    if (savedWidth) setWidth(Number(savedWidth));
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
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH + 1, e.clientX));
      if (newWidth <= MIN_WIDTH + 10) {
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
        { href: '/org', label: 'Organization', icon: Building2 },
      ]
    : baseNavItems;

  const sidebarW = collapsed ? MIN_WIDTH : width;

  return (
    <>
      {/* Mobile toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-3 left-3 z-50 md:hidden"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? (
          <X size={18} strokeWidth={1.5} />
        ) : (
          <Menu size={18} strokeWidth={1.5} />
        )}
      </Button>

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
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-surface border-r border-border md:translate-x-0 md:static select-none',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          isResizing ? '' : 'transition-all duration-200',
        )}
        style={{ width: sidebarW }}
      >
        {/* Header: Logo + Collapse toggle */}
        <div
          className={cn(
            'flex items-center h-12 border-b border-border flex-shrink-0',
            collapsed ? 'justify-center px-0' : 'justify-between px-3',
          )}
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
        >
          {!collapsed && (
            <div className="flex items-center gap-2">
              <VoxelLogo
                size={collapsed ? 18 : 20}
                className="text-foreground flex-shrink-0"
                hovered={logoHovered}
              />

              <span className="font-mono text-xs font-medium lowercase tracking-wide text-foreground">
                commandra
              </span>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={toggleCollapsed}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Collapse"
            >
              <ChevronsLeft size={14} strokeWidth={1.5} />
            </button>
          )}
          {collapsed && (
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
            collapsed ? 'px-1' : 'px-2',
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
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center text-sm font-medium transition-colors',
                  collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-1.5',
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
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: theme + user */}
        <div className="flex-shrink-0">
          <div className={cn('h-px bg-border', collapsed ? 'mx-1' : 'mx-2')} />

          <div
            className={cn(
              'flex items-center',
              collapsed ? 'flex-col gap-1 py-2' : 'gap-2 px-3 py-2',
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

            {!collapsed && (
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
              onClick={logout}
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
