import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodTypeAny, z } from "zod";
import { ApiError } from "./errorHandler";

// Usage: router.post("/", validate(schema), handler)
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return next(new ApiError(400, "VALIDATION_ERROR", message));
    }
    req.body = result.data;
    next();
  };
}

// Usage: const q = parseQuery(schema, req.query)  (query strings are validated too, SRS FR-API-07)
export function parseQuery<S extends ZodTypeAny>(schema: S, query: unknown): z.output<S> {
  const result = schema.safeParse(query);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ApiError(400, "VALIDATION_ERROR", message);
  }
  return result.data;
}
