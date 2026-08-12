export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="admin-view">
      <div className="admin-topbar">
        <h2>{title}</h2>
      </div>
      <div className="panel">
        <p className="dim mono" style={{ fontSize: 13 }}>
          {title} management is coming in {phase} — not built yet.
        </p>
      </div>
    </div>
  );
}
