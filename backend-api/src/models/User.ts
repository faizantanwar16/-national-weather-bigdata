import { Schema, model, Document } from "mongoose";

export type UserRole = "moderator" | "admin";

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  lastLoginAt?: Date;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["moderator", "admin"], required: true },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: Date,
});

export const User = model<IUser>("User", UserSchema);
