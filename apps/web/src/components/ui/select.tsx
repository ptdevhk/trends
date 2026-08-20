import * as React from "react"
import { cn } from "@/lib/utils"

export interface SelectOption {
  value: string
  label: string
  group?: string
}

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[]
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, ...props }, ref) => {
    // Group consecutive options with the same `group` property into <optgroup> runs
    const runs = options.reduce<{ group?: string; options: SelectOption[] }[]>((runs, option) => {
      const last = runs[runs.length - 1]
      if (last && last.group === option.group) {
        last.options.push(option)
      } else {
        runs.push({ group: option.group, options: [option] })
      }
      return runs
    }, [])

    return (
      <select
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      >
        {runs.map((run, runIndex) =>
          run.group ? (
            <optgroup key={`optgroup-${runIndex}`} label={run.group}>
              {run.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ) : (
            run.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))
          )
        )}
      </select>
    )
  }
)
Select.displayName = "Select"

export { Select }
