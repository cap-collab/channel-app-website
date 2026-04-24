// Monochrome SVG glyphs for each scene. Rendered with `currentColor` so the
// parent's text color controls the tint (default white when used standalone).
// Strokes intentionally extend past the 24x24 viewBox so lines bleed past the
// glyph's bounding box; overflow-visible lets that bleed render outside the box.
export function SceneGlyph({ slug, className }: { slug: string; className?: string }) {
  const common = {
    width: '0.7em',
    height: '0.7em',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: `inline-block align-[-0.05em] overflow-visible ${className ?? ''}`,
  };
  if (slug === 'grid') {
    return (
      <svg {...common} aria-hidden>
        <line x1="-2" y1="8" x2="26" y2="8" />
        <line x1="-2" y1="16" x2="26" y2="16" />
        <line x1="8" y1="-2" x2="8" y2="26" />
        <line x1="16" y1="-2" x2="16" y2="26" />
      </svg>
    );
  }
  // Diamond + spiral live inside 24×24, whereas the grid's strokes bleed out to
  // -2…26. Scale them up around the center so they read the same visual size as
  // the grid glyph.
  if (slug === 'diamond') {
    return (
      <svg {...common} aria-hidden>
        <g transform="translate(12 12) scale(1.2) translate(-12 -12)">
          <path d="M6 2 L18 2 L22 8 L2 8 Z" />
          <path d="M2 8 L12 22 L22 8" />
          <line x1="12" y1="8" x2="12" y2="22" strokeOpacity="0.5" />
        </g>
      </svg>
    );
  }
  if (slug === 'spiral') {
    // Spiral bbox is x∈[4,24], y∈[4,22] — geometric center is (14,13), but the
    // spiral's outermost arc sweeps down harder than up, so visual balance needs
    // a slight additional upward shift.
    return (
      <svg {...common} aria-hidden>
        <g transform="translate(12 12) scale(1.3) translate(-14 -12)">
          <path d="M12 12 m0 0 a2 2 0 1 1 4 0 a4 4 0 1 1 -8 0 a6 6 0 1 1 12 0 a8 8 0 1 1 -16 0 a10 10 0 1 1 20 0" />
        </g>
      </svg>
    );
  }
  return null;
}
