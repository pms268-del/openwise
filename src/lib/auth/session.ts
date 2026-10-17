import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "../env";
import { sql } from "../db";

const COOKIE = "siq_session";
const key = new TextEncoder().encode(env.sessionSecret);

export type Role = "sme_owner" | "sme_member" | "admin" | "analyst" | "field_agent" | "broker" | "property_owner";
export type SessionUser = { id: string; orgId: string; role: Role; name: string; email: string; orgKind: string };

export const STAFF_ROLES: Role[] = ["admin", "analyst"];
export const SME_ROLES: Role[] = ["sme_owner", "sme_member"];
export const FIELD_ROLES: Role[] = ["field_agent", "broker"];

export async function createSession(userId: string) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    const rows = await sql`
      select u.id, u.org_id, u.role, u.name, u.email, o.kind as org_kind
      from users u join organizations o on o.id = u.org_id where u.id = ${String(payload.uid)}`;
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, orgId: r.org_id, role: r.role, name: r.name, email: r.email, orgKind: r.org_kind };
  } catch {
    return null;
  }
});

export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) redirect(homeFor(u.role));
  return u;
}

export function homeFor(role: Role): string {
  if (SME_ROLES.includes(role)) return "/app";
  if (STAFF_ROLES.includes(role)) return "/admin";
  if (FIELD_ROLES.includes(role)) return "/field";
  return "/owner";
}
