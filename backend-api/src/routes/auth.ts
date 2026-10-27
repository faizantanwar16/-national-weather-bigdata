import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { User } from "../models/User";
import { validate } from "../middleware/validate";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", validate(loginSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase(), active: true });
  if (!user) throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");

  user.lastLoginAt = new Date();
  await user.save();

  const expiresIn = (process.env.JWT_EXPIRES_IN || "1h") as jwt.SignOptions["expiresIn"];
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn }
  );

  res.json({ token, role: user.role, email: user.email });
});

router.get("/me", requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});

export default router;
