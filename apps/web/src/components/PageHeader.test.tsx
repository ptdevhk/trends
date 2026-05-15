import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from '@/components/PageHeader'

describe('PageHeader', () => {
  it('renders title', () => {
    render(<PageHeader title="My Page" />)
    expect(screen.getByRole('heading', { level: 1, name: 'My Page' })).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(<PageHeader title="My Page" description="A description of this page" />)
    expect(screen.getByText('A description of this page')).toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    const { container } = render(<PageHeader title="My Page" />)
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs.length).toBe(0)
  })

  it('renders actions when provided', () => {
    render(
      <PageHeader
        title="My Page"
        actions={<button type="button">Action</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
  })

  it('does not render actions when not provided', () => {
    const { container } = render(<PageHeader title="My Page" />)
    expect(container.querySelectorAll('button').length).toBe(0)
  })

  it('renders with ReactNode title', () => {
    render(
      <PageHeader
        title={<span data-testid="custom-title">Custom Title</span>}
      />
    )
    expect(screen.getByTestId('custom-title')).toHaveTextContent('Custom Title')
  })

  it('renders with ReactNode description', () => {
    render(
      <PageHeader
        title="Test"
        description={<em>Emphasized desc</em>}
      />
    )
    expect(screen.getByText('Emphasized desc')).toBeInTheDocument()
  })

  it('renders multiple actions', () => {
    render(
      <PageHeader
        title="My Page"
        actions={
          <>
            <button type="button">Save</button>
            <button type="button">Cancel</button>
          </>
        }
      />
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
