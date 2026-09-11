import { Router } from "express";
import { nanoid } from "nanoid";
import { store, DEFAULT_ROLE_TITLE } from "../data/store.js";

export const rolesRouter = Router();

rolesRouter.get("/", (req, res) => {
  res.json({ roles: store.listRoles(), activeRoleId: store.getActiveRoleId() });
});

// Creates a new role (a self-contained hiring round: its own job description, custom questions,
// and candidates) and switches to it immediately, so HR can start filling it in right away.
// No title needed — the role is named automatically off its job description the moment one is
// set (see store.setJobDescription), so there's nothing for HR to type here.
rolesRouter.post("/", (req, res) => {
  const title = req.body?.title?.trim() || DEFAULT_ROLE_TITLE;

  const role = store.createRole({
    id: nanoid(),
    title,
    jobDescription: "",
    customQuestions: "",
    createdAt: new Date().toISOString(),
  });
  store.setActiveRoleId(role.id);
  res.status(201).json({ role, activeRoleId: role.id });
});

rolesRouter.put("/active", (req, res) => {
  const { roleId } = req.body;
  if (!store.getRole(roleId)) return res.status(404).json({ error: "Role not found" });
  store.setActiveRoleId(roleId);
  res.json({ ok: true });
});

rolesRouter.patch("/:id", (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  const updated = store.updateRole(req.params.id, { title: title.trim() });
  if (!updated) return res.status(404).json({ error: "Role not found" });
  res.json({ role: updated });
});

rolesRouter.delete("/:id", (req, res) => {
  if (!store.getRole(req.params.id)) return res.status(404).json({ error: "Role not found" });
  if (store.listRoles().length <= 1) {
    return res.status(400).json({ error: "Can't delete your only role — create another one first" });
  }

  const wasActive = store.getActiveRoleId() === req.params.id;
  store.deleteRole(req.params.id);
  if (wasActive) {
    // Deleted the role you were working on — fall back to whatever role is left, so the app
    // never ends up with no active role.
    store.setActiveRoleId(store.listRoles()[0].id);
  }
  res.json({ ok: true, activeRoleId: store.getActiveRoleId() });
});
