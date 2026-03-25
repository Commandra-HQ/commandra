/**
 * Lightweight tooltip — no radix dependency.
 * Shows on hover with a short delay. Portal-rendered to avoid clipping.
 */

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Tooltip({
  content,
  children,
  side = 'bottom',
  align = 'center',
  delay = 150,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  align?: 'center' | 'start' | 'end';
  delay?: number;
}) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  function show() {
    timeout.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const top = side === 'top' ? rect.top - 6 : rect.bottom + 6;
        const left = align === 'start' ? rect.left
          : align === 'end' ? rect.right
          : rect.left + rect.width / 2;
        setPos({ top, left });
      }
      setVisible(true);
    }, delay);
  }

  function hide() {
    clearTimeout(timeout.current);
    setVisible(false);
  }

  useEffect(() => () => clearTimeout(timeout.current), []);

  const alignClass = align === 'start' ? 'translate-x-0'
    : align === 'end' ? '-translate-x-full'
    : '-translate-x-1/2';

  const originClass = side === 'top' ? '-translate-y-full' : '';

  return (
    <>
      <div ref={triggerRef} className="inline-flex" onMouseEnter={show} onMouseLeave={hide}>
        {children}
      </div>
      {visible && createPortal(
        <div
          className={`fixed z-[9999] px-2.5 py-2 text-[10px] leading-relaxed rounded-md border border-border bg-popover text-popover-foreground shadow-lg pointer-events-none ${alignClass} ${originClass}`}
          style={{ top: pos.top, left: pos.left, minWidth: 140, maxWidth: 220 }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
