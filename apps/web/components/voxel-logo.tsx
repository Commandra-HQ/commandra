'use client';

import { useState } from 'react';

/**
 * Inline SVG voxel logo that morphs to a "C" on hover.
 * CSS transitions only — no framer-motion needed.
 */

const LOGO: [number, number][] = [
	[319, 102], [133, 102],
	[71, 164], [133, 164], [195, 164], [257, 164], [319, 164], [381, 164],
	[71, 226], [133, 226], [319, 226], [381, 226],
	[71, 288], [381, 288],
	[71, 350], [381, 350],
];

const C_SHAPE: [number, number][] = [
	[195, 102], [257, 102],
	[319, 102], [381, 102], [133, 164], [195, 164], [257, 164], [133, 226],
	[195, 226], [133, 288], [195, 288], [257, 288],
	[195, 350], [257, 350],
	[319, 350], [381, 350],
];

export function VoxelLogo({ size = 20, className = '' }: { size?: number; className?: string }) {
	const [hovered, setHovered] = useState(false);
	const positions = hovered ? C_SHAPE : LOGO;

	return (
		<div
			className={className}
			style={{ width: size, height: size, cursor: 'pointer' }}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<svg width={size} height={size} viewBox="50 80 420 350" fill="none">
				{positions.map(([x, y], i) => (
					<rect
						key={i}
						width={56}
						height={56}
						fill="currentColor"
						style={{
							transform: `translate(${x}px, ${y}px)`,
							transition: `transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.02}s`,
						}}
					/>
				))}
			</svg>
		</div>
	);
}
