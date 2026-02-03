import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface SearchBarProps {
  onSearch: (keyword: string) => void
  onClear: () => void
  loading?: boolean
  placeholder?: string
  buttonLabel?: string
}

export function SearchBar({ onSearch, onClear, loading, placeholder, buttonLabel }: SearchBarProps) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (keyword.trim()) {
        onSearch(keyword.trim())
      }
    },
    [keyword, onSearch]
  )

  const handleClear = useCallback(() => {
    setKeyword('')
    onClear()
  }, [onClear])

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder={placeholder ?? t('search.placeholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="pl-9 pr-9"
        />
        {keyword && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Button type="submit" disabled={loading || !keyword.trim()}>
        {buttonLabel ?? t('search.button')}
      </Button>
    </form>
  )
}
