import Link from "next/link";
import { loginAction } from "../actions/auth";
import { Notice } from "@/components/ui";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      <h1 className="h1">Sign in</h1>
      {error && <Notice tone="red">{error}</Notice>}
      <form action={loginAction} className="card space-y-3">
        <div><label className="label">Email</label><input name="email" type="email" required className="input" /></div>
        <div><label className="label">Password</label><input name="password" type="password" required className="input" /></div>
        <button className="btn w-full">Sign in</button>
      </form>
      <p className="muted">No account? <Link className="text-emerald-700 underline" href="/register">Create one</Link></p>
      {process.env.NODE_ENV !== "production" && (
        <div className="card text-xs text-stone-600">
          <div className="mb-1 font-semibold">Local demo accounts (password <code>demo1234</code>)</div>
          sme@ · admin@ · analyst@ · agent@ · broker@ · owner@ <code>siteiq.dev</code>
        </div>
      )}
    </div>
  );
}
