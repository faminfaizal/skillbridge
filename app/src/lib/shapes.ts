// One visual vocabulary for both renderers: each entity type has a colour, a 2D silhouette and a 3D solid.
export type EntityType = "person" | "project" | "system" | "skill" | "org" | "opportunity" | "problem" | "incident" | "knowledge" | "department" | "division";

export const DIVISION_COLOR: Record<string, string> = {
  "DIV-NI": "#38bdf8", "DIV-EG": "#fbbf24", "DIV-CR": "#f472b6", "DIV-CSO": "#fb923c",
  "DIV-ITD": "#a78bfa", "DIV-ADL": "#34d399", "DIV-CF": "#94a3b8",
};

export const DIVISION_LABEL: Record<string, string> = {
  "DIV-NI": "Network", "DIV-EG": "Enterprise", "DIV-CR": "Consumer", "DIV-CSO": "Service",
  "DIV-ITD": "IT", "DIV-ADL": "AI & Data", "DIV-CF": "Corporate",
};

interface Shape {
  label: string;
  color: string;
  /** SVG path in a 0..100 box, filled; used for the 2D silhouette and the legend */
  path: string;
  /** 3D solid name, interpreted by the 3D renderer */
  solid: "sphere" | "box" | "cylinder" | "tetrahedron" | "dodecahedron" | "cone" | "octahedron" | "icosahedron" | "slab" | "torus";
}

export const SHAPES: Record<EntityType, Shape> = {
  person: { label: "Person", color: "#e2e8f0", path: "M50 4a46 46 0 1 0 0.01 0z", solid: "sphere" },
  project: { label: "Project", color: "#818cf8", path: "M8 8h84v84H8z", solid: "box" },
  system: { label: "System", color: "#fcd34d", path: "M50 3l41 23.5v47L50 97 9 73.5v-47z", solid: "cylinder" },
  skill: { label: "Skill", color: "#64748b", path: "M50 6l45 82H5z", solid: "tetrahedron" },
  org: { label: "Customer / partner", color: "#f9a8d4", path: "M50 4l44 32-17 54H23L6 36z", solid: "dodecahedron" },
  opportunity: { label: "Opportunity", color: "#f472b6", path: "M50 3l13.5 30.5 33 3-25 22 7.5 32.5L50 74 21 91l7.5-32.5-25-22 33-3z", solid: "cone" },
  problem: { label: "Problem type", color: "#64748b", path: "M50 4l46 46-46 46L4 50z", solid: "octahedron" },
  incident: { label: "Incident", color: "#f87171", path: "M30 4h40l26 26v40L70 96H30L4 70V30z", solid: "icosahedron" },
  knowledge: { label: "Knowledge", color: "#2dd4bf", path: "M18 4h44l22 22v70H18z", solid: "slab" },
  department: { label: "Department", color: "#cbd5e1", path: "M50 4a46 46 0 1 0 0.01 0zM50 26a24 24 0 1 1-0.01 0z", solid: "torus" },
  division: { label: "Division", color: "#f8fafc", path: "M50 4a46 46 0 1 0 0.01 0zM50 22a28 28 0 1 1-0.01 0z", solid: "torus" },
};

export function nodeColor(type: string, attrs: Record<string, unknown>): string {
  if (type === "person") return DIVISION_COLOR[String(attrs.division)] ?? SHAPES.person.color;
  return SHAPES[type as EntityType]?.color ?? "#94a3b8";
}

/** White silhouette as an SVG data URI; the 2D pictogram program tints it with the node colour. */
export function silhouette(type: string): string {
  const s = SHAPES[type as EntityType] ?? SHAPES.person;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 100 100"><path fill="#ffffff" fill-rule="evenodd" d="${s.path}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Sigma program per type: crisp built-ins for the common ones, tinted silhouettes for the rest. */
export function program2d(type: string): "circle" | "square" | "shape" {
  if (type === "person") return "circle";
  if (type === "project") return "square";
  return "shape";
}

/** Vertical layer in the 3D "strata" view: organisation on top, infrastructure and customers at the base. */
export const STRATA: Record<EntityType, number> = {
  division: 210, department: 160, opportunity: 130, skill: 95, person: 55, project: 0, knowledge: -20,
  problem: -45, system: -80, incident: -100, org: -140,
};

export const LEGEND_TYPES: EntityType[] = ["person", "project", "system", "skill", "org", "opportunity", "incident", "knowledge"];
/** Types the legend can switch off on the graph (people always stay). */
export const TOGGLE_TYPES: EntityType[] = ["project", "system", "skill", "org", "opportunity", "incident", "knowledge"];
