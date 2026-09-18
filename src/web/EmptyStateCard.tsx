// Adapted from Craft packages/ui/src/components/ui/BrowserEmptyStateCard.tsx.
// The browser-specific examples and i18n dependency are not needed here.
export function EmptyStateCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-heading"><h2>{title}</h2></div>
      <p>{description}</p>
    </div>
  )
}
