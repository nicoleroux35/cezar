# Implémentation du support multilingue (i18n)

## Vue d'ensemble

Cette implémentation ajoute un paramètre de sélection de langue dans les paramètres d'apparence de l'application cezar, avec le support de l'anglais (par défaut) et du français.

## Modifications apportées

### 1. Schéma de contrat (`packages/contract/src/workspace.ts`)
- Ajout du champ `language` au schéma `appearanceSchema` avec les valeurs `'en' | 'fr'`
- Le champ est optionnel pour assurer la compatibilité ascendante

### 2. Logique d'apparence (`packages/web/src/lib/appearance.ts`)
- Ajout du type `Language = 'en' | 'fr'`
- Ajout de la constante `DEFAULT_LANGUAGE = 'en'`
- Ajout de la clé de stockage `LANGUAGE_STORAGE_KEY = 'cez-language'`
- Extension de l'interface `Appearance` pour inclure le champ `language`
- Ajout de la fonction `normalizeLanguage()` pour valider et normaliser les valeurs de langue
- Mise à jour de toutes les fonctions pour gérer le champ `language`:
  - `normalizeAppearance()`
  - `readStoredAppearance()`
  - `writeStoredAppearance()`
  - `applyAppearance()` — stampe `data-language` sur l'élément racine

### 3. Système de traduction (`packages/web/src/i18n/`)

#### `translations.ts`
Dictionnaire centralisé de toutes les traductions avec:
- Structure typée : `translations[key][language]`
- Clés actuellement traduites pour la section Apparence des paramètres
- Fonction helper `translate(key, language)`

#### `use-translations.tsx`
Provider React pour les traductions avec:
- `TranslationProvider` qui wrap l'application
- Hook `useTranslations()` qui expose `{ language, t }`
- `t(key)` fonction pour traduire dans la langue active

### 4. Provider d'apparence (`packages/web/src/components/appearance-provider.tsx`)
- Extension de `AppearanceContextValue` pour inclure `language` et `setLanguage()`
- Ajout du callback `setLanguage()` qui sauvegarde la préférence
- Mise à jour du contexte pour exposer la langue active

### 5. Interface utilisateur (`packages/web/src/routes/settings/appearance.tsx`)
- Ajout de la constante `LANGUAGE_OPTIONS` avec Anglais et Français
- Intégration du hook `useTranslations()` pour afficher les labels traduits
- Ajout du contrôle segmenté pour la sélection de langue
- Mise à jour de tous les champs existants pour utiliser les traductions dynamiques
- Le `ProjectOrderField` utilise également les traductions

### 6. Application principale (`packages/web/src/app.tsx`)
- Création du composant `TranslatedApp` qui wrap les routes avec `TranslationProvider`
- Le provider lit la langue depuis `useAppearance()` et la propage dans l'arbre
- Positionnement stratégique : après `AppearanceProvider`, avant `BrowserRouter`

### 7. Script de pré-paint (`packages/web/index.html`)
- Ajout de la logique pour stamper `data-language="fr"` avant le premier paint
- Lecture depuis `localStorage.getItem('cez-language')`
- Seule la valeur non-par-défaut ('fr') est stampée pour optimisation

### 8. Tests
- `packages/web/src/i18n/translations.test.ts` — validation du dictionnaire de traductions
- `packages/web/src/lib/appearance-language.test.ts` — tests de normalisation et gestion de la langue

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ index.html (pre-paint script)                               │
│ - Lit cez-language depuis localStorage                      │
│ - Stampe data-language="fr" si nécessaire                   │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ AppearanceProvider                                           │
│ - Charge language depuis ~/.cezar/ui-state.json             │
│ - Synchronise avec localStorage pour le pre-paint           │
│ - Expose { language, setLanguage }                          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ TranslationProvider                                          │
│ - Reçoit language depuis AppearanceProvider                 │
│ - Expose { t, language } via useTranslations()              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Composants UI                                                │
│ - Appellent const { t } = useTranslations()                 │
│ - Utilisent t('key') pour afficher le texte traduit         │
└─────────────────────────────────────────────────────────────┘
```

## Flux de données

1. **Démarrage à froid** :
   - Le script pré-paint lit `cez-language` depuis localStorage
   - Stampe `data-language` avant le premier paint (pas de flash)
   - `AppearanceProvider` se seed depuis le même localStorage
   - Quand `/api/v1/workspace/ui-state` répond, la valeur serveur est authoritative

2. **Changement de langue** :
   - L'utilisateur clique sur un bouton de langue
   - `setLanguage('fr')` est appelé
   - `AppearanceProvider` met à jour l'état local
   - Sauvegarde dans localStorage (pour le prochain pre-paint)
   - Appelle `PUT /api/v1/workspace/ui-state` avec `{ appearance: { language: 'fr', ... } }`
   - `TranslationProvider` réagit au changement et re-render les composants
   - Les composants utilisent `t()` qui retourne maintenant les traductions françaises

3. **Persistance** :
   - Stockage autoritaire : `~/.cezar/ui-state.json` (`appearance.language`)
   - Miroir localStorage : `cez-language` (pour le pre-paint uniquement)
   - Valeur par défaut : `'en'` (anglais)

## Extensibilité

Pour ajouter une nouvelle langue :

1. Mettre à jour le type `Language` dans `packages/web/src/lib/appearance.ts` :
   ```ts
   export type Language = 'en' | 'fr' | 'de' // ajouter 'de' par exemple
   ```

2. Mettre à jour le schéma dans `packages/contract/src/workspace.ts` :
   ```ts
   language: z.enum(['en', 'fr', 'de']).optional(),
   ```

3. Ajouter les traductions dans `packages/web/src/i18n/translations.ts` :
   ```ts
   'settings.appearance.theme': {
     en: 'Theme',
     fr: 'Thème',
     de: 'Thema', // ajouter la traduction allemande
   },
   ```

4. Ajouter l'option dans `packages/web/src/routes/settings/appearance.tsx` :
   ```ts
   const LANGUAGE_OPTIONS = [
     { value: 'en', label: 'English' },
     { value: 'fr', label: 'Français' },
     { value: 'de', label: 'Deutsch' }, // ajouter l'option
   ]
   ```

5. Mettre à jour le script pre-paint dans `packages/web/index.html` :
   ```js
   var language = localStorage.getItem('cez-language')
   if (language === 'fr' || language === 'de')
     document.documentElement.dataset.language = language
   ```

## Tests

Tous les tests passent :
```bash
npm test -- packages/web/src/i18n/translations.test.ts
npm test -- packages/web/src/lib/appearance-language.test.ts
```

## Compatibilité

- ✅ Compatibilité ascendante complète : le champ `language` est optionnel
- ✅ Les anciennes versions de cezar ignorent simplement le champ
- ✅ La valeur par défaut ('en') assure que rien ne casse sans configuration
- ✅ Le pre-paint fonctionne même si localStorage est indisponible
- ✅ Fonctionne en mode privé du navigateur (dégrade gracieusement)

## Prochaines étapes

1. Traduire plus de sections de l'application (au-delà de la page Apparence)
2. Ajouter plus de langues (allemand, espagnol, etc.)
3. Envisager un système de traduction lazy-loading pour de grandes quantités de texte
4. Ajouter des tests E2E pour le changement de langue dans le navigateur
