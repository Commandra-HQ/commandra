import { useEffect, useState } from 'react';

/**
 * Animated voxel logo that cycles through shapes:
 * Logo → C → Grid → Diamond → Logo (loops)
 *
 * Uses CSS transitions for smooth morphing. No framer-motion dependency.
 */

// 4x5 grid = 20 cells. Each shape is an array of 20 booleans (which cells are filled).
// Grid coordinates: row 0-4, col 0-3 → index = row * 4 + col
const SHAPES: { name: string; cells: boolean[] }[] = [
	{
		name: 'logo',
		cells: [
			false, true, false, true, // row 0
			true, true, true, true,   // row 1
			true, true, false, true,  // row 2
			true, false, false, true, // row 3
			true, false, false, true, // row 4
		],
	},
	{
		name: 'C',
		cells: [
			false, true, true, true,
			true, true, false, false,
			true, false, false, false,
			true, true, false, false,
			false, true, true, true,
		],
	},
	{
		name: 'grid',
		cells: [
			true, false, true, false,
			false, true, false, true,
			true, false, true, false,
			false, true, false, true,
			true, false, true, false,
		],
	},
	{
		name: 'diamond',
		cells: [
			false, false, true, false,
			false, true, false, true,
			true, false, false, false,
			false, true, false, true,
			false, false, true, false,
		],
	},
	{
		name: 'block',
		cells: [
			true, true, true, true,
			true, false, false, true,
			true, false, false, true,
			true, false, false, true,
			true, true, true, true,
		],
	},
];

const CELL_SIZE = 14;
const GAP = 3;
const COLS = 4;
const ROWS = 5;
const TOTAL_W = COLS * CELL_SIZE + (COLS - 1) * GAP;
const TOTAL_H = ROWS * CELL_SIZE + (ROWS - 1) * GAP;
const CYCLE_MS = 3000;

export function AnimatedVoxelLogo({
	size = 80,
	className = '',
}: {
	size?: number;
	className?: string;
}) {
	const [shapeIndex, setShapeIndex] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setShapeIndex((i) => (i + 1) % SHAPES.length);
		}, CYCLE_MS);
		return () => clearInterval(interval);
	}, []);

	const shape = SHAPES[shapeIndex];
	const scale = size / Math.max(TOTAL_W, TOTAL_H);

	return (
		<div className={`flex flex-col items-center gap-3 ${className}`}>
			<svg
				width={TOTAL_W * scale}
				height={TOTAL_H * scale}
				viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
			>
				{shape.cells.map((on, i) => {
					const row = Math.floor(i / COLS);
					const col = i % COLS;
					const x = col * (CELL_SIZE + GAP);
					const y = row * (CELL_SIZE + GAP);

					return (
						<rect
							key={i}
							x={x}
							y={y}
							width={CELL_SIZE}
							height={CELL_SIZE}
							fill="currentColor"
							style={{
								opacity: on ? 1 : 0,
								transform: on ? 'scale(1)' : 'scale(0.5)',
								transformOrigin: `${x + CELL_SIZE / 2}px ${y + CELL_SIZE / 2}px`,
								transition: `opacity 0.4s ease ${i * 0.02}s, transform 0.4s ease ${i * 0.02}s`,
							}}
						/>
					);
				})}
			</svg>
			<span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
				{SHAPES[shapeIndex].name === 'logo' ? 'Ready' : 'Tell me what to do...'}
			</span>
		</div>
	);
}
