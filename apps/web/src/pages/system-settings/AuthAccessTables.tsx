import type { ReactNode } from 'react'

function Pill({ children, active = true }: { children: string; active?: boolean }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
      {children}
    </span>
  )
}

function StatusPill({ active }: { active: boolean }) {
  return <Pill active={active}>{active ? 'Active' : 'Revoked'}</Pill>
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-sm text-muted-foreground">
        {label}
      </td>
    </tr>
  )
}

function FieldLabel({ children }: { children: string }) {
  return <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</dt>
}

function PolicyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <FieldLabel>{label}</FieldLabel>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function StackedRecord({
  title,
  fields,
  action,
}: {
  title: ReactNode
  fields: Array<{ label: string; value: ReactNode }>
  action?: ReactNode
}) {
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-medium">{title}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <PolicyField key={field.label} label={field.label}>
            {field.value}
          </PolicyField>
        ))}
      </dl>
    </div>
  )
}

export function ResponsiveTable({
  headers,
  emptyLabel,
  isEmpty,
  minWidthClassName,
  children,
  stacked,
}: {
  headers: string[]
  emptyLabel: string
  isEmpty: boolean
  minWidthClassName: string
  children: ReactNode
  stacked: ReactNode
}) {
  return (
    <>
      <div className="hidden lg:block overflow-x-auto">
        <table className={`w-full ${minWidthClassName} text-sm`}>
          <thead className="border-b text-left text-xs uppercase text-muted-foreground">
            <tr>
              {headers.map((header) => (
                <th key={header || 'actions'} className="px-3 py-2">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isEmpty ? <EmptyRow colSpan={headers.length} label={emptyLabel} /> : children}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden" data-testid="auth-stacked-records">
        {isEmpty ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          stacked
        )}
      </div>
    </>
  )
}

export { Pill, StatusPill }
