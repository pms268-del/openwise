"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, registerAccount } from "@/lib/auth/provider";
import { createSession, destroySession, getUser, homeFor } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export async function loginAction(fd: FormData) {
  const id = await authenticate(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
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
  const r = await registerAccount(p.data);
  if (r.error || !r.userId) redirect(`/register?error=${encodeURIComponent(r.error ?? "Registration failed")}`);
  await createSession(r.userId);
  await audit(await getUser(), "auth.register", "user", r.userId, { role: p.data.role });
  redirect(p.data.role === "sme_owner" ? "/app/new" : "/owner/new");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
