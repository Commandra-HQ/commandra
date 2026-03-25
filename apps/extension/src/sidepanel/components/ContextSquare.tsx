/**
 * ContextSquare — square progress indicator for context window usage.
 * Fills clockwise from 12 o'clock (top-center).
 */

export function ContextSquare({
  percent,
}: {
  /** 0–100 */
  percent: number;
}) {
  // Perimeter of the path: 7+14+14+14+7 = 56
  const filled = Math.min(percent, 100) * 0.56;

  return (
    <div className="relative w-[14px] h-[14px] flex-shrink-0">
      <svg viewBox="0 0 16 16" className="w-[14px] h-[14px]">
        {/* Background track */}
        <path
          d="M8,1 L15,1 L15,15 L1,15 L1,1 Z"
          fill="none" stroke="currentColor" strokeWidth="1.5"
          className="text-secondary"
        />
        {/* Progress fill — starts top-center, goes clockwise */}
        <path
          d="M8,1 L15,1 L15,15 L1,15 L1,1 L8,1"
          fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeDasharray={`${filled} 56`}
          strokeDashoffset="0"
          className="text-foreground"
        />
      </svg>
    </div>
  );
}
