import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string };
    authenticatedAt: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    authenticatedAt?: number;
  }
}
