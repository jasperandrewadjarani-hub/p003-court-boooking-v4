"use client";

import { useState } from "react";
import { registerCustomerAccount, loginCustomer, requestPasswordReset, resetCustomerPassword } from "@/lib/auth/customerAuth";

interface Props {
  email: string;
  mode: "login" | "register";
  devCode?: string;
  profile: { firstName: string; lastName: string; phone: string };
  onAuthenticated: () => void;
  onClose: () => void;
}

/**
 * Matches v2's #otpModal — server decides register-vs-login by email
 * (BookingPage's beginCustomerBookingAuth call, before this opens). New
 * emails get an OTP + must set a password; returning emails just enter
 * their password. A forgot-password sub-flow is available from login mode.
 */
export function AccountModal({ email, mode, devCode, profile, onAuthenticated, onClose }: Props) {
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [resetMode, setResetMode] = useState<"idle" | "requested">("idle");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPasswordValue] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetDevCode, setResetDevCode] = useState<string | undefined>(undefined);

  async function submit() {
    setError(null);
    if (mode === "register") {
      if (password !== confirmPassword) {
        setError("Passwords don't match.");
        return;
      }
    }
    setPending(true);
    try {
      if (mode === "register") {
        await registerCustomerAccount({ email, code: otp, password, firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone });
      } else {
        await loginCustomer(email, password);
      }
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  async function beginReset() {
    setError(null);
    setPending(true);
    try {
      const res = await requestPasswordReset(email);
      setResetDevCode("devCode" in res ? res.devCode : undefined);
      setResetMode("requested");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  async function completeReset() {
    setError(null);
    if (resetPassword !== resetConfirm) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    try {
      await resetCustomerPassword(email, resetCode, resetPassword);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (resetMode === "requested") {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <form
          className="modal"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); completeReset(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
              e.preventDefault();
              completeReset();
            }
          }}
        >
          <span className="close" onClick={onClose}>[ ESC ]</span>
          <h3>Reset Password</h3>
          {resetDevCode && (
            <p className="field-warning" style={{ borderColor: "var(--accent-cyan)" }}>
              DEV MODE — no email was sent. Your code is <strong>{resetDevCode}</strong>.
            </p>
          )}
          <label>One-Time Email Code</label>
          <input value={resetCode} onChange={(e) => setResetCode(e.target.value)} maxLength={8} placeholder="XXXXXXXX" />
          <label>New Password</label>
          <input type="password" value={resetPassword} onChange={(e) => setResetPasswordValue(e.target.value)} />
          <label>Confirm New Password</label>
          <input type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} />
          {error && <div className="field-warning">{error}</div>}
          <button type="submit" className="btn block" style={{ marginTop: 18 }} disabled={pending}>
            {pending ? "Working…" : "Set New Password"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            submit();
          }
        }}
      >
        <span className="close" onClick={onClose}>[ ESC ]</span>
        <h3>{mode === "register" ? "Create Your Account" : "Customer Sign In"}</h3>
        <p className="dim mono" style={{ fontSize: 13 }}>
          {mode === "register" ? `Verifying ${email} — check your email for a one-time code.` : `Welcome back, ${email}.`}
        </p>

        {devCode && (
          <p className="field-warning" style={{ borderColor: "var(--accent-cyan)" }}>
            DEV MODE — no email was sent. Your code is <strong>{devCode}</strong>.
          </p>
        )}

        {mode === "register" && (
          <>
            <label>One-Time Email Code</label>
            <input value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={8} autoComplete="one-time-code" placeholder="XXXXXXXX" />
          </>
        )}

        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} />

        {mode === "register" && (
          <>
            <label>Confirm Password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </>
        )}

        {mode === "login" && (
          <button className="link-btn" type="button" onClick={beginReset}>
            Forgot password?
          </button>
        )}

        {error && <div className="field-warning">{error}</div>}

        <button type="submit" className="btn block" style={{ marginTop: 18 }} disabled={pending}>
          {pending ? "Working…" : mode === "register" ? "Register & Confirm Booking" : "Sign In & Confirm Booking"}
        </button>
      </form>
    </div>
  );
}
