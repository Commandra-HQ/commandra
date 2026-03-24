/**
 * Inline SVG voxel logo for Commandra.
 * Renders the 16 voxel blocks using currentColor so it adapts to light/dark.
 */

// Actual voxel positions from the logo SVG (after rotation transform)
const VOXELS = [
	[319, 102], [133, 102],                                           // row 0
	[71, 164], [133, 164], [195, 164], [257, 164], [319, 164], [381, 164], // row 1
	[71, 226], [133, 226], [319, 226], [381, 226],                   // row 2
	[71, 288], [381, 288],                                           // row 3
	[71, 350], [381, 350],                                           // row 4
];

export function VoxelLogo({ size = 20, className = '' }: { size?: number; className?: string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="50 80 420 360"
			fill="none"
			className={className}
		>
			{VOXELS.map(([x, y], i) => (
				<rect key={i} x={x} y={y} width={56} height={56} fill="currentColor" />
			))}
		</svg>
	);
}
