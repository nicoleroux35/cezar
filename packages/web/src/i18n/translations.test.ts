import { describe, it, expect } from 'vitest'
import { translate, translations } from './translations'

describe('translations', () => {
  it('should translate English keys correctly', () => {
    expect(translate('settings.appearance.theme', 'en')).toBe('Theme')
    expect(translate('settings.appearance.language', 'en')).toBe('Language')
    expect(translate('settings.appearance.language.en', 'en')).toBe('English')
    expect(translate('settings.appearance.language.fr', 'en')).toBe('French')
  })

  it('should translate French keys correctly', () => {
    expect(translate('settings.appearance.theme', 'fr')).toBe('Thème')
    expect(translate('settings.appearance.language', 'fr')).toBe('Langue')
    expect(translate('settings.appearance.language.en', 'fr')).toBe('Anglais')
    expect(translate('settings.appearance.language.fr', 'fr')).toBe('Français')
  })

  it('should have all translation keys in both languages', () => {
    const keys = Object.keys(translations)
    keys.forEach(key => {
      const translation = translations[key as keyof typeof translations]
      expect(translation).toHaveProperty('en')
      expect(translation).toHaveProperty('fr')
      expect(typeof translation.en).toBe('string')
      expect(typeof translation.fr).toBe('string')
      expect(translation.en.length).toBeGreaterThan(0)
      expect(translation.fr.length).toBeGreaterThan(0)
    })
  })
})
