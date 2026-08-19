"use client";

import { useState } from "react";
import {
  listStaffAction,
  getSuperAdminStatusAction,
  setSuperAdminPasswordAction,
  beginAddStaffAction,
  completeAddStaffAction,
  setStaffActiveAction,
  setStaffRoleAction,
} from "@/app/admin/actions";

type StaffRole = "owner" | "admin" | "staff";

interface StaffRow {
  id: string;
  name: string;
  position: string | null;
  role: StaffRole;
  active: boolean;
  user: { email: string };
}

const EMPTY_ADD = {
  superAdminPassword: "",
  email: "",
  name: "",
  position: "",
  role: "staff" as StaffRole,
  password: "",
  code: "",
};

/** Staff account management — gated by a separate super-admin password
 *  (distinct from any individual staff login) per client request 2026-08-19.
 *  Adding a new account is a two-step OTP flow: verify super-admin password +
 *  send a code to the new email, then verify the code to actually create it. */
export function StaffManager({ initialStaff, initialSuperAdminSet }: { initialStaff: StaffRow[]; initialSuperAdminSet: boolean }) {
  const [rows, setRows] = useState<StaffRow[]>(initialStaff);
  const [superAdminSet, setSuperAdminSet] = useState<boolean | null>(initialSuperAdminSet);

  const [gateForm, setGateForm] = useState({ current: "", next: "", confirm: "" });
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateNotice, setGateNotice] = useState<string | null>(null);

  const [add, setAdd] = useState(EMPTY_ADD);
  const [addStep, setAddStep] = useState<"form" | "code">("form");
  const [addError, setAddError] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const [rowError, setRowError] = useState<string | null>(null);

  async function refresh() {
    const [staff, status] = await Promise.all([listStaffAction(), getSuperAdminStatusAction()]);
    setRows(staff as StaffRow[]);
    setSuperAdminSet(status.isSet);
  }

  async function saveGate() {
    setGateError(null);
    setGateNotice(null);
    if (gateForm.next !== gateForm.confirm) {
      setGateError("New password and confirmation don't match.");
      return;
    }
    const res = await setSuperAdminPasswordAction(superAdminSet ? gateForm.current : null, gateForm.next);
    if (res.ok) {
      setGateForm({ current: "", next: "", confirm: "" });
      setGateNotice(superAdminSet ? "Super-admin password updated." : "Super-admin password set.");
      refresh();
    } else {
      setGateError(res.error);
    }
  }

  async function sendCode() {
    setAddError(null);
    if (!add.superAdminPassword || !add.email || !add.name || !add.password) {
      setAddError("Super-admin password, email, name, and account password are all required.");
      return;
    }
    const res = await beginAddStaffAction(add.superAdminPassword, add.email);
    if (res.ok) {
      setAddStep("code");
      setDevCode(res.devMode ? res.devCode ?? null : null);
      setAddNotice(res.devMode ? "DEV MODE — code shown below (no real email configured yet)." : `Verification code sent to ${res.email}.`);
    } else {
      setAddError(res.error);
    }
  }

  async function createAccount() {
    setAddError(null);
    if (!add.code.trim()) {
      setAddError("Enter the verification code.");
      return;
    }
    const res = await completeAddStaffAction({
      email: add.email,
      code: add.code,
      password: add.password,
      name: add.name,
      position: add.position || undefined,
      role: add.role,
    });
    if (res.ok) {
      setAdd(EMPTY_ADD);
      setAddStep("form");
      setAddNotice(null);
      setDevCode(null);
      refresh();
    } else {
      setAddError(res.error);
    }
  }

  async function toggleActive(row: StaffRow) {
    setRowError(null);
    const next = !row.active;
    if (!window.confirm(`${next ? "Reactivate" : "Deactivate"} ${row.name}'s staff account?`)) return;
    const res = await setStaffActiveAction(row.id, next);
    if (res.ok) refresh();
    else setRowError(res.error);
  }

  async function changeRole(row: StaffRow, role: StaffRole) {
    setRowError(null);
    const res = await setStaffRoleAction(row.id, role);
    if (res.ok) refresh();
    else setRowError(res.error);
  }

  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>Staff Accounts</h2>
      </div>

      <div className="panel">
        <div className="panel__title">Super-Admin Password</div>
        <p className="dim mono" style={{ fontSize: 11, marginTop: -8 }}>
          {superAdminSet === null
            ? "Loading…"
            : superAdminSet
              ? "This password gates the “Add Staff Account” flow below. Enter it there whenever you add a new staff member."
              : "No super-admin password is set yet — set one now before you can add staff accounts."}
        </p>
        <div className="inline-form">
          {superAdminSet && (
            <div>
              <label>Current Super-Admin Password</label>
              <input type="password" value={gateForm.current} onChange={(e) => setGateForm({ ...gateForm, current: e.target.value })} />
            </div>
          )}
          <div>
            <label>{superAdminSet ? "New" : "Set"} Super-Admin Password</label>
            <input type="password" value={gateForm.next} onChange={(e) => setGateForm({ ...gateForm, next: e.target.value })} />
          </div>
          <div>
            <label>Confirm Password</label>
            <input type="password" value={gateForm.confirm} onChange={(e) => setGateForm({ ...gateForm, confirm: e.target.value })} />
          </div>
        </div>
        {gateError && <div className="field-warning">{gateError}</div>}
        {gateNotice && <div className="receipt-state uploaded" style={{ marginTop: 10 }}>{gateNotice}</div>}
        <button className="btn" style={{ marginTop: 14 }} onClick={saveGate}>
          {superAdminSet ? "Update Password" : "Set Password"}
        </button>
      </div>

      <div className="panel">
        <div className="panel__title">Add Staff Account</div>
        {addStep === "form" ? (
          <>
            <div className="inline-form">
              <div>
                <label>Super-Admin Password</label>
                <input type="password" value={add.superAdminPassword} onChange={(e) => setAdd({ ...add, superAdminPassword: e.target.value })} />
              </div>
              <div>
                <label>New Staff Email</label>
                <input type="email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
              </div>
              <div>
                <label>Name</label>
                <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
              </div>
              <div>
                <label>Position</label>
                <input value={add.position} onChange={(e) => setAdd({ ...add, position: e.target.value })} />
              </div>
              <div>
                <label>Role</label>
                <select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as StaffRole })}>
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              <div>
                <label>Account Password</label>
                <input type="password" value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} />
              </div>
            </div>
            {addError && <div className="field-warning">{addError}</div>}
            <button className="btn" style={{ marginTop: 14 }} onClick={sendCode}>
              Send Verification Code
            </button>
          </>
        ) : (
          <>
            <p className="dim mono" style={{ fontSize: 12 }}>{addNotice}</p>
            {devCode && (
              <div className="receipt-state uploaded" style={{ marginBottom: 10, fontSize: 16, letterSpacing: 2 }}>
                DEV MODE CODE: {devCode}
              </div>
            )}
            <div className="inline-form">
              <div>
                <label>Verification Code</label>
                <input value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value.toUpperCase() })} />
              </div>
            </div>
            {addError && <div className="field-warning">{addError}</div>}
            <button className="btn" style={{ marginTop: 14 }} onClick={createAccount}>
              Verify &amp; Create Account
            </button>
            <button
              className="btn secondary"
              style={{ marginTop: 14, marginLeft: 8 }}
              onClick={() => {
                setAddStep("form");
                setAddError(null);
                setAddNotice(null);
                setDevCode(null);
              }}
            >
              Back
            </button>
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel__title">All Staff</div>
        {rowError && <div className="field-warning">{rowError}</div>}
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Position</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.user.email}</td>
                <td>{r.position ?? "—"}</td>
                <td>
                  <select value={r.role} onChange={(e) => changeRole(r, e.target.value as StaffRole)}>
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                </td>
                <td>
                  <span className={`badge ${r.active ? "on" : "off"}`}>{r.active ? "Active" : "Inactive"}</span>
                </td>
                <td className="action-cell">
                  <button className="btn danger" onClick={() => toggleActive(r)}>
                    {r.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
