"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchStaffNotificationsAction, markStaffNotificationsReadAction } from "@/app/admin/actions";
import { fetchMyNotificationsAction, markMyNotificationsReadAction, logoutCustomerAction } from "@/app/actions";

interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  bookingGroupId: string | null;
  customerName?: string | null;
  read: boolean;
  createdAt: string;
}

const POLL_MS = 20_000;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** In-app notification bell for staff (audience="staff") or the logged-in
 *  customer (audience="customer" — self-hides when not logged in). Polls every
 *  20s; fires a native browser notification for new items while the tab is open
 *  once the user has granted permission. Admin items link to the booking. */
export function NotificationBell({ audience }: { audience: "staff" | "customer" }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(audience === "staff");
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  async function load() {
    try {
      const r = audience === "staff" ? await fetchStaffNotificationsAction() : await fetchMyNotificationsAction();
      if (audience === "customer") {
        if (!("loggedIn" in r) || !r.loggedIn) { setVisible(false); return; }
        setVisible(true);
      }
      const list = r.items as Item[];
      setItems(list);
      setUnread(r.unreadCount);
      // Native browser notification for newly-arrived unread items (tab open).
      if (primed.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const n of list) {
          if (!seen.current.has(n.id) && !n.read) {
            try { new Notification(n.title, { body: n.body }); } catch { /* ignore */ }
          }
        }
      }
      list.forEach((n) => seen.current.add(n.id));
      primed.current = true;
    } catch { /* transient — try again next poll */ }
  }

  useEffect(() => {
    if (typeof Notification === "undefined") setPerm("unsupported");
    else setPerm(Notification.permission);
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      if (audience === "staff") await markStaffNotificationsReadAction();
      else await markMyNotificationsReadAction();
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }

  async function enableDesktop() {
    if (typeof Notification === "undefined") return;
    try { setPerm(await Notification.requestPermission()); } catch { /* ignore */ }
  }

  function clickItem(n: Item) {
    if (audience === "staff" && n.bookingGroupId) {
      setOpen(false);
      router.push(`/admin/bookings?booking=${n.bookingGroupId}`);
    }
  }

  async function logout() {
    try { await logoutCustomerAction(); } catch { /* ignore */ }
    window.location.reload();
  }

  if (!visible) return null;

  return (
    <div className="notif-bell-wrap">
      <button className="notif-bell-btn" onClick={toggleOpen} aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
        <span aria-hidden>🔔</span>
        {unread > 0 && <span className="notif-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-dropdown" role="dialog" aria-label="Notifications">
            <div className="notif-head">
              <strong>Notifications</strong>
              <div style={{ display: "flex", gap: 8 }}>
                {perm !== "granted" && perm !== "unsupported" && (
                  <button className="notif-enable" onClick={enableDesktop}>Enable desktop alerts</button>
                )}
                {audience === "customer" && (
                  <button className="notif-enable notif-logout" onClick={logout}>Log out</button>
                )}
              </div>
            </div>
            <div className="notif-list">
              {items.length === 0 ? (
                <div className="notif-empty">No notifications yet.</div>
              ) : (
                items.map((n) => (
                  <div
                    key={n.id}
                    className={`notif-item${n.read ? "" : " unread"}${audience === "staff" && n.bookingGroupId ? " clickable" : ""}`}
                    onClick={() => clickItem(n)}
                  >
                    <div className="notif-item-head">
                      <span className="notif-item-title">{n.title}</span>
                      {n.customerName && <span className="notif-item-customer">{n.customerName}</span>}
                    </div>
                    <div className="notif-item-body">{n.body}</div>
                    <div className="notif-item-time">{timeAgo(n.createdAt)}{audience === "staff" && n.bookingGroupId ? " · view booking →" : ""}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
