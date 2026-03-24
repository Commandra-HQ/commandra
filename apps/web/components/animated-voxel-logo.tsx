import { useEffect, useState } from 'react';

/**
 * Animated voxel logo for empty states.
 * Starts with the Commandra logo, then morphs through shapes in an endless loop.
 * Uses a 6x5 grid (30 cells) matching the logo's actual proportions.
 *
 * Grid: cols 0-5, rows 0-4
 * Logo maps to: col = (x - 71) / 62, row = (y - 102) / 62
 */

// Each shape: array of [col, row] pairs that are "on"
const SHAPES: { cells: [number, number][] }[] = [
	{
		// Logo (actual Commandra voxel positions)
		cells: [
			[4, 0], [1, 0],                           // row 0 — two top blocks
			[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], // row 1 — full bar
			[0, 2], [1, 2], [4, 2], [5, 2],           // row 2 — sides
			[0, 3], [5, 3],                             // row 3 — corners
			[0, 4], [5, 4],                             // row 4 — corners
		],
	},
	{
		// C shape
		cells: [
			[1, 0], [2, 0], [3, 0], [4, 0],
			[0, 1], [1, 1],
			[0, 2],
			[0, 3], [1, 3],
			[1, 4], [2, 4], [3, 4], [4, 4],
		],
	},
	{
		// Scatter / constellation
		cells: [
			[0, 0], [3, 0], [5, 0],
			[1, 1], [4, 1],
			[0, 2], [2, 2], [5, 2],
			[1, 3], [3, 3],
			[0, 4], [4, 4], [5, 4],
		],
	},
	{
		// Diamond
		cells: [
			[2, 0], [3, 0],
			[1, 1], [4, 1],
			[0, 2], [5, 2],
			[1, 3], [4, 3],
			[2, 4], [3, 4],
		],
	},
	{
		// Columns / bars
		cells: [
			[0, 2], [0, 3], [0, 4],
			[1, 1], [1, 2], [1, 3], [1, 4],
			[2, 0], [2, 1], [2, 2], [2, 3], [2, 4],
			[3, 1], [3, 2], [3, 3],
			[4, 0], [4, 1],
			[5, 0],
		],
	},
	{
		// Frame / border
		cells: [
			[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
			[0, 1], [5, 1],
			[0, 2], [5, 2],
			[0, 3], [5, 3],
			[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4],
		],
	},
];

const COLS = 6;
const ROWS = 5;
const CELL = 10;
const GAP = 2.5;
const TOTAL_W = COLS * CELL + (COLS - 1) * GAP;
const TOTAL_H = ROWS * CELL + (ROWS - 1) * GAP;
const CYCLE_MS = 2000; // faster cycling

function cellKey(col: number, row: number) {
	return `${col},${row}`;
}

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

	const activeSet = new Set(SHAPES[shapeIndex].cells.map(([c, r]) => cellKey(c, r)));
	const scale = size / Math.max(TOTAL_W, TOTAL_H);

	return (
		<div className={className}>
			<svg
				width={TOTAL_W * scale}
				height={TOTAL_H * scale}
				viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
			>
				{Array.from({ length: ROWS }, (_, row) =>
					Array.from({ length: COLS }, (_, col) => {
						const x = col * (CELL + GAP);
						const y = row * (CELL + GAP);
						const on = activeSet.has(cellKey(col, row));

						return (
							<rect
								key={cellKey(col, row)}
								x={x}
								y={y}
								width={CELL}
								height={CELL}
								fill="currentColor"
								style={{
									opacity: on ? 1 : 0.04,
									transform: on ? 'scale(1)' : 'scale(0.6)',
									transformOrigin: `${x + CELL / 2}px ${y + CELL / 2}px`,
									transition: `opacity 0.35s ease ${(col + row) * 0.02}s, transform 0.35s ease ${(col + row) * 0.02}s`,
								}}
							/>
						);
					}),
				)}
			</svg>
		</div>
	);
}
