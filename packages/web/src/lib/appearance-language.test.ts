import { describe, it, expect } from 'vitest'
import {
  normalizeLanguage,
  normalizeAppearance,
  DEFAULT_LANGUAGE,
  type Language,
} from './appearance'

describe('appearance language support', () => {
  it('should normalize valid language values', () => {
    expect(normalizeLanguage('en')).toBe('en')
    expect(normalizeLanguage('fr')).toBe('fr')
  })

  it('should default to English for invalid language values', () => {
    expect(normalizeLanguage('de')).toBe(DEFAULT_LANGUAGE)
    expect(normalizeLanguage('es')).toBe(DEFAULT_LANGUAGE)
    expect(normalizeLanguage(null)).toBe(DEFAULT_LANGUAGE)
    expect(normalizeLanguage(undefined)).toBe(DEFAULT_LANGUAGE)
    expect(normalizeLanguage(123)).toBe(DEFAULT_LANGUAGE)
  })

  it('should normalize appearance with language field', () => {
    const result = normalizeAppearance({
      accent: 'violet',
      density: 'compact',
      width: 'wide',
      language: 'fr',
    })

    expect(result).toEqual({
      accent: 'violet',
      density: 'compact',
      width: 'wide',
      language: 'fr',
    })
  })

  it('should use default language when not provided', () => {
    const result = normalizeAppearance({
      accent: 'lime',
      density: 'comfortable',
      width: 'narrow',
    })

    expect(result.language).toBe(DEFAULT_LANGUAGE)
  })

  it('should handle empty object gracefully', () => {
    const result = normalizeAppearance({})

    expect(result.language).toBe(DEFAULT_LANGUAGE)
    expect(result.accent).toBe('lime')
    expect(result.density).toBe('comfortable')
    expect(result.width).toBe('narrow')
  })
})
