"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginStaff } from "@/lib/auth/staffAuth";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setError(null);
    setPending(true);
    const result = await loginStaff(email, password);
    if (result.ok) {
      // Deliberately leave `pending` true — the button should keep reading
      // "Logging in…" through the redirect instead of flashing back to
      // "Sign In" for a frame before the dashboard takes over.
      router.push("/admin");
      router.refresh();
    } else {
      setPending(false);
      setError(result.error);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand">
          VOLT<span style={{ color: "var(--accent-cyan)" }}>://</span>ADMIN
        </div>
        <p className="dim mono" style={{ fontSize: 12, marginBottom: 20 }}>
          STAFF ACCESS ONLY
        </p>

        <label>Staff Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@volt.club" />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {error && <div className="field-warning">{error}</div>}
        <button className="btn block" style={{ marginTop: 16 }} onClick={submit} disabled={pending}>
          {pending ? "Logging in…" : "Sign In"}
        </button>
        <p className="jt-brand-bar" style={{ marginTop: 24, background: "none", border: "none" }}>
          <a href="https://www.facebook.com/profile.php?id=61590234100280" target="_blank" rel="noopener noreferrer">
            Powered by JT Consulting &amp; Analytics
          </a>
        </p>
      </div>
    </div>
  );
}
