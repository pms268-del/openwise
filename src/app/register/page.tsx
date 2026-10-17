import { registerAction } from "../actions/auth";
import { Notice } from "@/components/ui";

export default async function Register({ searchParams }: { searchParams: Promise<{ error?: string; role?: string }> }) {
  const { error, role } = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-4 pt-8">
      <h1 className="h1">Create your account</h1>
      {error && <Notice tone="red">{error}</Notice>}
      <form action={registerAction} className="card space-y-3">
        <div>
          <label className="label">I am a…</label>
          <select name="role" defaultValue={role === "owner" ? "property_owner" : "sme_owner"} className="input">
            <option value="sme_owner">Business owner looking for a location</option>
            <option value="property_owner">Property owner / landlord</option>
          </select>
        </div>
        <div><label className="label">Your name</label><input name="name" required className="input" /></div>
        <div><label className="label">Company / business name</label><input name="orgName" required className="input" /></div>
        <div><label className="label">Email</label><input name="email" type="email" required className="input" /></div>
        <div><label className="label">Password (8+ characters)</label><input name="password" type="password" minLength={8} required className="input" /></div>
        <button className="btn w-full">Create account</button>
      </form>
    </div>
  );
}
