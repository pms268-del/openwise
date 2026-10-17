"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, registerAccount } from "@/lib/auth/provider";
import { createSession, destroySession, getUser, homeFor } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

// Surface infrastructure failures (e.g. database unreachable) on the form instead of a blank error page.
async function attempt<T>(fn: () => Promise<T>, back: string): Promise<T> {
  try { return await fn(); }
  catch (e) {
    console.error(`[auth] ${back} failed`, e);
    const m = (e as Error).message ?? "unknown error";
    const hint = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|CONNECT_TIMEOUT/i.test(m) ? " — check DATABASE_URL (use the Supabase Transaction pooler, port 6543)"
      : /password authentication/i.test(m) ? " — the database password in DATABASE_URL is wrong"
      : /does not exist/i.test(m) ? " — run db/supabase_setup.sql in the Supabase SQL editor" : "";
    redirect(`${back}?error=${encodeURIComponent(`Server error: ${m.slice(0, 160)}${hint}`)}`);
  }
}

export async function loginAction(fd: FormData) {
  const id = await attempt(() => authenticate(String(fd.get("email") ?? ""), String(fd.get("password") ?? "")), "/login");
  if (!id) redirect("/login?error=Invalid+email+or+password");
  await createSession(id);
  const u = await getUser();
  await audit(u, "auth.login", "user", id);
  redirect(u ? homeFor(u.role) : "/");
}

const Reg = z.object({
  name: z.string().min(2), email: z.string().email(), password: z.string().min(8),
  orgName: z.string().min(2), role: z.enum(["sme_owner", "property_owner"]),
});

export async function registerAction(fd: FormData) {
  const p = Reg.safeParse(Object.fromEntries(fd));
  if (!p.success) redirect(`/register?error=${encodeURIComponent(p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))}`);
  const r = await attempt(() => registerAccount(p.data), "/register");
  if (r.error || !r.userId) redirect(`/register?error=${encodeURIComponent(r.error ?? "Registration failed")}`);
  await createSession(r.userId);
  await audit(await getUser(), "auth.register", "user", r.userId, { role: p.data.role });
  redirect(p.data.role === "sme_owner" ? "/app/new" : "/owner/new");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
