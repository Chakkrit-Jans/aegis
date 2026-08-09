import { nanoid } from "nanoid";
import { Setting } from "../db/mongo.js";

const KEY = "customTemplates";

export interface TemplateLevels {
  basic: string;
  medium: string;
  advanced: string;
}

/** A user-created objective template with up to 3 levels. Built-ins live in the frontend (read-only). */
export interface CustomTemplate {
  id: string;
  name: string;
  levels: TemplateLevels;
}

function normLevels(l?: Partial<TemplateLevels>): TemplateLevels {
  return { basic: l?.basic ?? "", medium: l?.medium ?? "", advanced: l?.advanced ?? "" };
}
function hasAnyLevel(l: TemplateLevels): boolean {
  return Boolean(l.basic.trim() || l.medium.trim() || l.advanced.trim());
}

/** Migrate legacy single-objective templates to the levels shape. */
function migrate(t: { id?: string; name?: string; levels?: Partial<TemplateLevels>; objective?: string }): CustomTemplate {
  return {
    id: t.id ?? nanoid(8),
    name: t.name ?? "Untitled template",
    levels: t.levels ? normLevels(t.levels) : normLevels({ basic: t.objective ?? "" }),
  };
}

async function load(): Promise<CustomTemplate[]> {
  const doc = await Setting.findOne({ key: KEY }).lean();
  const raw = (doc?.value as { templates?: unknown[] } | undefined)?.templates ?? [];
  return (raw as Parameters<typeof migrate>[0][]).map(migrate);
}
async function save(templates: CustomTemplate[]): Promise<void> {
  await Setting.updateOne({ key: KEY }, { $set: { value: { templates } } }, { upsert: true });
}

export async function listTemplates(): Promise<CustomTemplate[]> {
  return load();
}

export async function createTemplate(name: string, levels: Partial<TemplateLevels>): Promise<CustomTemplate> {
  const t: CustomTemplate = { id: nanoid(8), name: name.trim() || "Untitled template", levels: normLevels(levels) };
  const all = await load();
  all.push(t);
  await save(all);
  return t;
}

export async function updateTemplate(id: string, name?: string, levels?: Partial<TemplateLevels>): Promise<boolean> {
  const all = await load();
  const t = all.find((x) => x.id === id);
  if (!t) return false;
  if (name !== undefined) t.name = name.trim() || t.name;
  if (levels !== undefined) t.levels = normLevels(levels);
  await save(all);
  return true;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const all = await load();
  const next = all.filter((x) => x.id !== id);
  if (next.length === all.length) return false;
  await save(next);
  return true;
}

/** Bulk import (for sharing). Accepts the levels shape or legacy {objective}. Returns count added. */
export async function importTemplates(
  items: { name?: unknown; levels?: Partial<TemplateLevels>; objective?: unknown }[],
  replace = false
): Promise<number> {
  const existing = replace ? [] : await load();
  let count = 0;
  for (const it of items) {
    const levels = it?.levels
      ? normLevels(it.levels)
      : normLevels({ basic: typeof it?.objective === "string" ? it.objective : "" });
    if (hasAnyLevel(levels)) {
      existing.push({
        id: nanoid(8),
        name: (typeof it?.name === "string" && it.name.trim()) || "Imported template",
        levels,
      });
      count++;
    }
  }
  await save(existing);
  return count;
}

export { hasAnyLevel };
