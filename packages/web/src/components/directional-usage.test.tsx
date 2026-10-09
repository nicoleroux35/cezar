import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DirectionalUsage, directionalUsageText } from './directional-usage'

describe('DirectionalUsage', () => {
  it('uses the same compact direction order and an expanded accessible label', () => {
    render(<DirectionalUsage inputTokens={184_700} outputTokens={2_400} />)
    // The accessible name is formatted by `Intl.NumberFormat()`, so assert it the same way rather
    // than pinning `184,700` — that spelling is a property of the test machine's locale (fr_FR
    // groups with a narrow no-break space), not of this component. Same precedent as
    // `app-shell.test.tsx`'s star-count label.
    expect(screen.getByText('IN 184.7k · OUT 2.4k').getAttribute('aria-label')).toBe(
      `Input tokens: ${new Intl.NumberFormat().format(184_700)}; output tokens: ${new Intl.NumberFormat().format(2_400)}`,
    )
  })

  it('shows one known side honestly and omits an entirely unknown compact value', () => {
    expect(directionalUsageText(184_700, undefined)).toBe('IN 184.7k · OUT —')
    const { container } = render(<DirectionalUsage />)
    expect(container.innerHTML).toBe('')
  })

  it('keeps both table placeholders when requested', () => {
    render(<DirectionalUsage variant="table" omitWhenUnknown={false} />)
    expect(screen.getByText('— / —').getAttribute('aria-label')).toBe(
      'Input tokens: unknown; output tokens: unknown',
    )
  })
})
