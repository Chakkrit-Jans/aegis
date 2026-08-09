import type { Request, Response, NextFunction } from "express";
import { verify, type TokenPayload } from "./service.js";

export interface AuthedRequest extends Request {
  user?: TokenPayload;
}

/** Express guard: requires a valid Bearer token; attaches the payload to req.user. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = token ? verify(token) : null;
  if (!payload) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.user = payload;
  next();
}

/** Express guard: requires the authenticated user to hold one of the given roles. */
export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "forbidden: requires role " + roles.join("/") });
      return;
    }
    next();
  };
}
