import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AiFeedbackButtons } from '@/components/AiFeedbackButtons'

describe('AiFeedbackButtons', () => {
  const defaultProps = {
    label: 'resume summary',
    onSelect: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders like and unlike buttons', () => {
    render(<AiFeedbackButtons {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Like resume summary' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlike resume summary' })).toBeInTheDocument()
  })

  it('calls onSelect with like when like button is clicked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<AiFeedbackButtons {...defaultProps} onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Like resume summary' }))
    expect(onSelect).toHaveBeenCalledWith('like')
  })

  it('calls onSelect with unlike when unlike button is clicked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<AiFeedbackButtons {...defaultProps} onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Unlike resume summary' }))
    expect(onSelect).toHaveBeenCalledWith('unlike')
  })

  it('shows like button as active when feedback is like', () => {
    const { rerender } = render(<AiFeedbackButtons {...defaultProps} feedback="like" />)
    const likeBtn = screen.getByRole('button', { name: 'Like resume summary' })
    expect(likeBtn.className).toContain('text-emerald-600')
    expect(likeBtn).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Unlike resume summary' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    rerender(<AiFeedbackButtons {...defaultProps} feedback="unlike" />)
    const unlikeBtn = screen.getByRole('button', { name: 'Unlike resume summary' })
    expect(unlikeBtn.className).toContain('text-red-600')
    expect(unlikeBtn).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Like resume summary' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('stops propagation when stopPropagation is true', async () => {
    const onSelect = vi.fn()
    const parentClick = vi.fn()
    const user = userEvent.setup()

    render(
      <div onClick={parentClick}>
        <AiFeedbackButtons {...defaultProps} onSelect={onSelect} stopPropagation={true} />
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Like resume summary' }))
    expect(onSelect).toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('does not stop propagation when stopPropagation is false', async () => {
    const onSelect = vi.fn()
    const parentClick = vi.fn()
    const user = userEvent.setup()

    render(
      <div onClick={parentClick}>
        <AiFeedbackButtons {...defaultProps} onSelect={onSelect} stopPropagation={false} />
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Like resume summary' }))
    expect(onSelect).toHaveBeenCalled()
    expect(parentClick).toHaveBeenCalled()
  })

  it('renders with custom testId', () => {
    render(<AiFeedbackButtons {...defaultProps} testId="feedback-btns" />)
    expect(screen.getByTestId('feedback-btns')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<AiFeedbackButtons {...defaultProps} className="my-custom-class" testId="feedback-btns" />)
    const container = screen.getByTestId('feedback-btns')
    expect(container.className).toContain('my-custom-class')
  })
})
