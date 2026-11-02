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

import { textTranslations, translateText } from './text'

describe('text translations (gettext-style)', () => {
  it('renders the English source string unchanged', () => {
    expect(translateText('New task', 'en')).toBe('New task')
    expect(translateText('Open menu', 'en')).toBe('Open menu')
  })

  it('translates known source strings to French', () => {
    expect(translateText('New task', 'fr')).toBe('Nouvelle tâche')
    expect(translateText('Open menu', 'fr')).toBe('Ouvrir le menu')
    expect(translateText('No tasks yet', 'fr')).toBe("Aucune tâche pour l'instant")
  })

  it('has a non-empty French string for every entry', () => {
    for (const [source, french] of Object.entries(textTranslations)) {
      expect(source.length).toBeGreaterThan(0)
      expect(french.length).toBeGreaterThan(0)
    }
  })
})
