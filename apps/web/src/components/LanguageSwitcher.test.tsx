import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders select element', () => {
    render(<LanguageSwitcher />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('exposes an accessible name for the language selector', () => {
    render(<LanguageSwitcher />)
    expect(screen.getByRole('combobox', { name: /language|語言|语言/i })).toBeInTheDocument()
  })

  it('renders three language options', () => {
    render(<LanguageSwitcher />)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
  })

  it('renders Chinese Traditional option', () => {
    render(<LanguageSwitcher />)
    expect(screen.getByText('繁體中文')).toBeInTheDocument()
  })

  it('renders Chinese Simplified option', () => {
    render(<LanguageSwitcher />)
    expect(screen.getByText('简体中文')).toBeInTheDocument()
  })

  it('renders English option', () => {
    render(<LanguageSwitcher />)
    expect(screen.getByText('English')).toBeInTheDocument()
  })
})
