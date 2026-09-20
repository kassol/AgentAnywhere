import type { ReactNode } from 'react'
import { BriefcaseBusiness } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './craft/components/Empty'

export function EmptyStateCard({ title, description, icon = <BriefcaseBusiness /> }: { title: string; description: string; icon?: ReactNode }) {
  return <Empty className="empty-state min-h-40 border border-border bg-background p-6 pb-6">
    <EmptyMedia variant="icon">{icon}</EmptyMedia>
    <EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>
  </Empty>
}
