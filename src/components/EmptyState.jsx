export default function EmptyState({ title, hint }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
    </div>
  )
}
