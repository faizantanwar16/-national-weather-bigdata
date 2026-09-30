// src/types.ts
export type UserRole = "admin" | "analyst" | "citizen"; // adjust to your real roles


export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface MeResponse {
  user: AuthUser;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;

}
