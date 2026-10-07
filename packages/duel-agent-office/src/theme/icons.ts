/** Agent Office pixel glyphs (7 by 7 texels) from the design system StatusBadge, as SVG path data. */
export const ICONS = {
  "idle": "M0 0h5v1h-5zM4 1h1v1h-1zM3 2h1v1h-1zM2 3h1v1h-1zM1 4h1v1h-1zM0 5h5v1h-5z",
  "planning": "M3 0h1v1h-1zM2 1h1v1h-1zM4 1h1v1h-1zM1 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM3 3h1v1h-1zM6 3h1v1h-1zM1 4h1v1h-1zM5 4h1v1h-1zM2 5h1v1h-1zM4 5h1v1h-1zM3 6h1v1h-1z",
  "working": "M0 0h1v1h-1zM2 0h3v1h-3zM6 0h1v1h-1zM1 1h5v1h-5zM0 2h3v1h-3zM4 2h3v1h-3zM0 3h2v1h-2zM5 3h2v1h-2zM0 4h3v1h-3zM4 4h3v1h-3zM1 5h5v1h-5zM0 6h1v1h-1zM2 6h3v1h-3zM6 6h1v1h-1z",
  "waiting": "M0 0h7v1h-7zM1 1h5v1h-5zM2 2h3v1h-3zM3 3h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM0 6h7v1h-7z",
  "reviewing": "M1 0h4v1h-4zM0 1h1v1h-1zM5 1h1v1h-1zM0 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM5 3h1v1h-1zM1 4h4v1h-4zM4 5h2v1h-2zM5 6h2v1h-2z",
  "blocked": "M2 0h3v1h-3zM1 1h1v1h-1zM5 1h1v1h-1zM1 2h1v1h-1zM5 2h1v1h-1zM0 3h7v1h-7zM0 4h3v1h-3zM4 4h3v1h-3zM0 5h3v1h-3zM4 5h3v1h-3zM0 6h7v1h-7z",
  "completed": "M6 1h1v1h-1zM5 2h2v1h-2zM0 3h1v1h-1zM4 3h2v1h-2zM0 4h2v1h-2zM3 4h2v1h-2zM1 5h3v1h-3zM2 6h1v1h-1z",
  "failed": "M0 0h1v1h-1zM6 0h1v1h-1zM1 1h1v1h-1zM5 1h1v1h-1zM2 2h1v1h-1zM4 2h1v1h-1zM3 3h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM0 6h1v1h-1zM6 6h1v1h-1z",
  "offline": "M1 0h5v1h-5zM0 1h1v1h-1zM5 1h2v1h-2zM0 2h1v1h-1zM4 2h1v1h-1zM6 2h1v1h-1zM0 3h1v1h-1zM3 3h1v1h-1zM6 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM6 4h1v1h-1zM0 5h2v1h-2zM6 5h1v1h-1zM1 6h5v1h-5z",
  "demo": "M2 0h3v1h-3zM3 1h1v1h-1zM3 2h1v1h-1zM2 3h1v1h-1zM4 3h1v1h-1zM1 4h1v1h-1zM5 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM0 6h7v1h-7z",
  "live": "M2 1h3v1h-3zM1 2h5v1h-5zM1 3h5v1h-5zM1 4h5v1h-5zM2 5h3v1h-3z",
  "severity-high": "M0 0h1v1h-1zM6 0h1v1h-1zM1 1h1v1h-1zM5 1h1v1h-1zM2 2h1v1h-1zM4 2h1v1h-1zM3 3h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM0 6h1v1h-1zM6 6h1v1h-1z",
  "severity-medium": "M3 0h1v4h-1zM3 5h1v1h-1z",
  "severity-low": "M3 0h1v1h-1zM3 2h1v4h-1z",
} as const;

export type IconName = keyof typeof ICONS;
