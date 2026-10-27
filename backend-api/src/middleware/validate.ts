import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
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
