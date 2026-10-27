import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ApiError } from "./errorHandler";

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; role: "moderator" | "admin" };
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new ApiError(401, "UNAUTHENTICATED", "Missing or invalid Authorization header"));
  }
  try {
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret") as AuthedRequest["user"];
    req.user = payload;
    next();
  } catch {
    next(new ApiError(401, "UNAUTHENTICATED", "Invalid or expired token"));
  }
}

export function requireRole(...roles: Array<"moderator" | "admin">) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, "FORBIDDEN", "You do not have permission to do this"));
    }
    next();
  };
}
