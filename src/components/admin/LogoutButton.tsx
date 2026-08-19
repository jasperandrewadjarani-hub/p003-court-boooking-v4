"use client";

/** Wraps the server-action logout form with a confirm prompt — logging out
 *  ended a staff member's session instantly with no "are you sure", which
 *  could lose an in-progress action (e.g. mid-way through Record Payment). */
export function LogoutButton({ onLogout }: { onLogout: () => Promise<void> }) {
  return (
    <button
      type="button"
      style={{ all: "unset", cursor: "pointer" }}
      onClick={() => {
        if (window.confirm("Log out of the admin panel?")) onLogout();
      }}
    >
      Log Out
    </button>
  );
}
