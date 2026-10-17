// Identity provider adapter: Supabase Auth when configured, otherwise local scrypt passwords.
// Either way the app issues its own short-lived signed session cookie mapped to `users.id`.
import { createClient } from "@supabase/supabase-js";
import { env, integrations } from "../env";
import { sql } from "../db";
import { hashPassword, verifyPassword } from "./password";
import type { Role } from "./session";

function supabase() {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false } });
}

export async function authenticate(email: string, password: string): Promise<string | null> {
  email = email.trim().toLowerCase();
  if (integrations.supabaseAuth()) {
    const { data, error } = await supabase().auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      // Fall through to local accounts (e.g. seeded staff users) only if no Supabase identity exists.
      const local = await sql`select id, password_hash from users where email = ${email} and supabase_user_id is null`;
      return local[0] && verifyPassword(password, local[0].password_hash) ? local[0].id : null;
    }
    const rows = await sql`update users set supabase_user_id = ${data.user.id} where email = ${email} returning id`;
    return rows[0]?.id ?? null;
  }
  const rows = await sql`select id, password_hash from users where email = ${email}`;
  return rows[0] && verifyPassword(password, rows[0].password_hash) ? rows[0].id : null;
}

export async function registerAccount(input: {
  email: string; password: string; name: string; orgName: string; role: Extract<Role, "sme_owner" | "property_owner">;
}): Promise<{ userId?: string; error?: string }> {
  const email = input.email.trim().toLowerCase();
  const exists = await sql`select 1 from users where email = ${email}`;
  if (exists.length) return { error: "An account with this email already exists." };
  let supabaseId: string | null = null;
  if (integrations.supabaseAuth()) {
    const { data, error } = await supabase().auth.signUp({ email, password: input.password });
    if (error) return { error: error.message };
    supabaseId = data.user?.id ?? null;
  }
  const orgKind = input.role === "sme_owner" ? "sme" : "owner";
  const userId = await sql.begin(async (tx) => {
    const [org] = await tx`insert into organizations (name, kind) values (${input.orgName}, ${orgKind}) returning id`;
    const [u] = await tx`
      insert into users (org_id, email, name, role, password_hash, supabase_user_id)
      values (${org.id}, ${email}, ${input.name}, ${input.role},
              ${supabaseId ? null : hashPassword(input.password)}, ${supabaseId})
      returning id`;
    return u.id as string;
  });
  return { userId };
}
