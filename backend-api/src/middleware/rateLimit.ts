import rateLimit from "express-rate-limit";

// SRS NFR-SEC-05: submit 5/hour, login 10/15 min, public reads 120/min (per IP).
// Outside production the write limits are relaxed so you can test freely. Override with env vars.
const prod = process.env.NODE_ENV === "production";
const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
const disabled = process.env.RATE_LIMIT_DISABLED === "1";

function make(windowMs: number, max: number, code: string, message: string) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => disabled,
    handler: (_req, res) => res.status(429).json({ error: { code, message } }),
  });
}

export const submitLimiter = make(3600_000, num(process.env.RATE_LIMIT_SUBMIT_PER_HOUR, prod ? 5 : 200), "RATE_LIMITED", "Too many reports from this device. Please try again later.");
export const mediaLimiter = make(3600_000, num(process.env.RATE_LIMIT_MEDIA_PER_HOUR, prod ? 15 : 600), "RATE_LIMITED", "Too many uploads from this device. Please try again later.");
export const loginLimiter = make(15 * 60_000, num(process.env.RATE_LIMIT_LOGIN_PER_15MIN, prod ? 10 : 200), "RATE_LIMITED", "Too many sign-in attempts. Please wait a few minutes.");
export const readLimiter = make(60_000, num(process.env.RATE_LIMIT_READ_PER_MIN, prod ? 120 : 1200), "RATE_LIMITED", "Too many requests. Please slow down.");
