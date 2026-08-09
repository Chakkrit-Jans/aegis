import { Router } from "express";
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  importTemplates,
  hasAnyLevel,
  type TemplateLevels,
} from "../templates/service.js";

// Custom objective templates — available to any authenticated user (shared library).
export const templatesRouter = Router();

function levelsFrom(body: { levels?: Partial<TemplateLevels> }): TemplateLevels {
  const l = body?.levels ?? {};
  return { basic: String(l.basic ?? ""), medium: String(l.medium ?? ""), advanced: String(l.advanced ?? "") };
}

templatesRouter.get("/", async (_req, res) => {
  res.json(await listTemplates());
});

templatesRouter.post("/", async (req, res) => {
  const { name } = req.body ?? {};
  const levels = levelsFrom(req.body ?? {});
  if (!hasAnyLevel(levels)) return res.status(400).json({ error: "at least one level (command) required" });
  res.status(201).json(await createTemplate(String(name ?? ""), levels));
});

templatesRouter.put("/:id", async (req, res) => {
  const { name, levels } = req.body ?? {};
  const ok = await updateTemplate(
    req.params.id,
    typeof name === "string" ? name : undefined,
    levels !== undefined ? levelsFrom(req.body) : undefined
  );
  if (!ok) return res.status(404).json({ error: "template not found" });
  res.json({ ok: true });
});

templatesRouter.delete("/:id", async (req, res) => {
  const ok = await deleteTemplate(req.params.id);
  if (!ok) return res.status(404).json({ error: "template not found" });
  res.json({ ok: true });
});

templatesRouter.post("/import", async (req, res) => {
  const { templates, replace } = req.body ?? {};
  if (!Array.isArray(templates)) return res.status(400).json({ error: "templates array required" });
  res.json({ imported: await importTemplates(templates, Boolean(replace)) });
});
