// @ts-nocheck - Example documentation file, not meant to be compiled
// Exemple d'utilisation du système de traduction dans un nouveau composant

/*
import { useTranslations } from '@/i18n/use-translations'

export function MyNewComponent() {
  const { t, language } = useTranslations()

  return (
    <div>
      {/* Utilisation basique *\/}
      <h1>{t('settings.appearance.theme')}</h1>

      {/* La langue courante est aussi disponible *\/}
      <p>Current language: {language}</p>

      {/* Tous les textes affichés doivent utiliser t() *\/}
      <button>{t('some.button.label')}</button>
    </div>
  )
}

// Étapes pour ajouter une nouvelle traduction :

// 1. Ajouter la clé dans packages/web/src/i18n/translations.ts
export const translations = {
  // ... autres traductions
  'my.new.key': {
    en: 'My new text in English',
    fr: 'Mon nouveau texte en français',
  },
} as const

// 2. TypeScript vous protège : t('my.new.key') est typé ✅
//    t('wrong.key') → Erreur de compilation ❌

// 3. Le texte change automatiquement quand l'utilisateur change de langue
*/
