# Sélection de langue implémentée ✅

## Ce qui a été fait

J'ai ajouté un paramètre de sélection de langue dans **Settings → Global → Appearance** avec le support de l'anglais (par défaut) et du français.

## Fichiers modifiés

### Backend / Contrat
- ✅ `packages/contract/src/workspace.ts` — Ajout du champ `language` au schéma d'apparence

### Frontend / Logique
- ✅ `packages/web/src/lib/appearance.ts` — Support de la langue dans le système d'apparence
- ✅ `packages/web/src/i18n/translations.ts` — Dictionnaire de traductions EN/FR (nouveau)
- ✅ `packages/web/src/i18n/use-translations.tsx` — Hook et provider de traductions (nouveau)

### Frontend / UI
- ✅ `packages/web/src/components/appearance-provider.tsx` — Gestion de la langue
- ✅ `packages/web/src/routes/settings/appearance.tsx` — Interface de sélection + traductions dynamiques
- ✅ `packages/web/src/app.tsx` — Intégration du TranslationProvider
- ✅ `packages/web/index.html` — Pre-paint de la langue (pas de flash)

### Tests
- ✅ `packages/web/src/i18n/translations.test.ts` — Tests du dictionnaire
- ✅ `packages/web/src/lib/appearance-language.test.ts` — Tests de normalisation

## Comment ça marche

1. **Page de paramètres** : Un nouveau contrôle segmenté "Language" avec "English" et "Français"
2. **Stockage** : La préférence est sauvegardée dans `~/.cezar/ui-state.json` (globale)
3. **Pre-paint** : Le choix est appliqué avant le premier rendu (pas de flash de contenu)
4. **Traductions** : Actuellement, la page Apparence est entièrement traduite

## Démo

```
http://localhost:4322/settings/global/appearance
```

Vous verrez maintenant 5 sections :
- Theme (Thème)
- Accent (Accent)
- Density (Densité)
- Reading width (Largeur de lecture)
- **Language (Langue)** ← NOUVEAU
- Project order (Ordre des projets)

Sélectionnez "Français" et tous les labels de cette page passent en français immédiatement.

## État des traductions

### ✅ Complètement traduit
- Settings → Global → Appearance (tous les champs, labels et descriptions)

### 🚧 Pas encore traduit
- Reste de l'application (sidebar, tasks, etc.)
- Ces sections continueront d'afficher en anglais jusqu'à ce que leurs clés soient ajoutées au dictionnaire

## Extension future

Pour traduire d'autres sections, il suffit d'ajouter les clés dans `translations.ts` et d'utiliser le hook `useTranslations()` dans les composants.

## Tests

Tous les tests passent :
```bash
✓ packages/web/src/i18n/translations.test.ts (3 tests)
✓ packages/web/src/lib/appearance-language.test.ts (5 tests)
```

---

**Résultat** : Vous avez maintenant un système i18n fonctionnel avec anglais par défaut et français implémenté pour la page Apparence. Le système est extensible pour ajouter plus de langues et traduire plus de sections de l'app.
