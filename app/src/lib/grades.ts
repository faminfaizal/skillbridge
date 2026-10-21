// Grade codes and labels (same as the data generator's LEVELS). Safe to import from client components.
export const GRADES: { code: string; label: string }[] = [
  { code: "GM", label: "General Manager" },
  { code: "SM", label: "Senior Manager" },
  { code: "M", label: "Manager" },
  { code: "AM", label: "Assistant Manager / Lead" },
  { code: "SE", label: "Senior Executive / Engineer" },
  { code: "E", label: "Executive / Engineer" },
  { code: "A", label: "Associate / Technician" },
];

export const gradeLabel = (code: string | null | undefined) => GRADES.find((g) => g.code === code)?.label ?? (code === "C" ? "C-suite" : code ?? "");
