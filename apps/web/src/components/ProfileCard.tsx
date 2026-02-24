import { formatDistanceToNow } from 'date-fns'
import { Play, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export type SearchProfileSummary = {
  id: string
  name: string
  filename: string
  updatedAt: string
  status: 'active' | 'paused' | 'archived'
  location: string
  keywords: string[]
}

export type SearchProfileRunStatus = {
  profileId: string
  taskId: string
  taskStatus: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  startedAt: string
  updatedAt: string
  completedAt?: string
  resultCount?: number
  extracted?: number
  submitted?: number
  error?: string
}

interface ProfileCardProps {
  profile: SearchProfileSummary
  scheduleLabel: string
  runStatus?: SearchProfileRunStatus
  running: boolean
  onRunNow: (profileId: string) => void
  onEdit: (profileId: string) => void
  onDelete: (profileId: string) => void
}

function statusBadgeVariant(status: SearchProfileSummary['status']): 'default' | 'secondary' | 'outline' {
  if (status === 'active') {
    return 'default'
  }
  if (status === 'paused') {
    return 'secondary'
  }
  return 'outline'
}

function runStatusLabel(status: SearchProfileRunStatus['taskStatus']): string {
  if (status === 'pending') return 'pending'
  if (status === 'processing') return 'running'
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'unknown'
}

export function ProfileCard({
  profile,
  scheduleLabel,
  runStatus,
  running,
  onRunNow,
  onEdit,
  onDelete,
}: ProfileCardProps) {
  const lastRunText = runStatus
    ? `${formatDistanceToNow(new Date(runStatus.updatedAt), { addSuffix: true })} | ${runStatus.resultCount ?? runStatus.submitted ?? 0} resumes`
    : 'never'

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base leading-tight">{profile.name}</CardTitle>
          <Badge variant={statusBadgeVariant(profile.status)}>{profile.status}</Badge>
        </div>
        <div className="text-sm text-muted-foreground">
          {profile.location} · {profile.keywords.join(', ') || '--'}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <span className="font-medium">Schedule:</span> {scheduleLabel}
        </div>
        <div>
          <span className="font-medium">Last run:</span> {lastRunText}
        </div>
        {runStatus ? (
          <div>
            <span className="font-medium">Run status:</span> {runStatusLabel(runStatus.taskStatus)}
            {runStatus.error ? ` (${runStatus.error})` : ''}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="gap-2 justify-end">
        <Button size="sm" onClick={() => onRunNow(profile.id)} disabled={running}>
          <Play className="h-3.5 w-3.5 mr-1" />
          Run Now
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(profile.id)}>
          <Pencil className="h-3.5 w-3.5 mr-1" />
          Edit
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDelete(profile.id)}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </CardFooter>
    </Card>
  )
}
