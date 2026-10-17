// Small inline silhouette of an entity type (same shapes as the 2D graph); decorative, always paired with text.
import { SHAPES, type EntityType } from "../lib/shapes";

export function ShapeGlyph({ type, color, size = 14 }: { type: EntityType; color?: string; size?: number }) {
  const s = SHAPES[type] ?? SHAPES.person;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: "none" }}>
      <path d={s.path} fill={color ?? s.color} fillRule="evenodd" />
    </svg>
  );
}
