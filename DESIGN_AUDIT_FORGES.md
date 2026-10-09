# ✅ Design Audit & Corrections - ForgesSection

## 🎨 Alignement avec le Design System

J'ai audité et corrigé le composant ForgesSection pour respecter exactement les patterns de design de Settings.

---

## 📝 Changements appliqués

### 1. **Structure de la section**
**Avant :** Wrapper générique `<section className="space-y-4">`
**Après :** Pattern standard Settings
```tsx
<section id="forges" data-slot="forge-settings" className="scroll-mt-20">
```
✅ Maintenant cohérent avec provider-settings.tsx

### 2. **Header (titre + description)**
**Avant :**
- `text-lg font-semibold` (trop gros)
- `mt-1 text-sm` (espacement incorrect)

**Après :**
```tsx
<h2 className="text-sm font-semibold text-foreground">Forges</h2>
<p className="text-[13px] text-muted-foreground">Configure git forge integrations...</p>
```
✅ `text-sm` pour titre, `text-[13px]` pour description (comme Providers)

### 3. **Espacement entre header et contenu**
**Avant :** Wrapper avec `space-y-4`
**Après :** `mb-2` sur le header, `space-y-2` sur les cartes
✅ Espacement cohérent avec Providers

### 4. **Cartes (ForgeCard)**
**Avant :**
```tsx
className="rounded-lg border border-border bg-card p-4"
```

**Après :**
```tsx
className="rounded-md border border-border px-3 py-2.5"
// Note: pas de bg-card, c'est transparent par défaut
```
✅ `rounded-md` (pas `lg`), padding `px-3 py-2.5` (comme Providers)

### 5. **Layout interne des cartes**
**Avant :** Flex column avec header séparé
**Après :** Pattern horizontal compact
```tsx
<div className="flex items-start justify-between gap-4">
  <div className="flex min-w-0 flex-1 items-start gap-3">
    <StatusDot tone={...} className="mt-1" />
    <div className="min-w-0 flex-1">
      {/* contenu */}
    </div>
  </div>
  <div className="flex shrink-0 items-center gap-1.5">
    {/* boutons */}
  </div>
</div>
```
✅ StatusDot à gauche, contenu au centre, actions à droite (pattern Provider)

### 6. **Typographie dans les cartes**
**Avant :**
- Titre : `font-semibold text-base` (trop gros)
- Description : `text-sm`
- Username : `text-sm`

**Après :**
```tsx
<h3 className="text-sm font-medium text-foreground">GitHub</h3>
<span className="text-[13px] text-muted-foreground">username</span>
<p className="mt-0.5 text-[13px] text-muted-foreground">Description</p>
```
✅ Titre `text-sm font-medium`, description `text-[13px]`, version `text-xs`

### 7. **Hints / Messages d'avertissement**
**Avant :**
```tsx
<div className="mt-2 flex items-start gap-2 rounded-md bg-yellow-500/10 px-3 py-2">
  <AlertCircleIcon className="h-4 w-4 shrink-0 text-yellow-600" />
  <p className="text-sm text-yellow-900">...</p>
</div>
```

**Après :**
```tsx
<div className="mt-2 rounded-sm bg-pending/10 px-2 py-1.5">
  <p className="text-[13px] text-pending-foreground">{status.hint}</p>
</div>
```
✅ Utilise les couleurs sémantiques (`pending` au lieu de `yellow`)
✅ `rounded-sm` (pas `md`), padding plus compact `px-2 py-1.5`

### 8. **Boutons**
**Avant :**
- Taille par défaut (`size="sm"`)
- Plusieurs variantes

**Après :**
```tsx
<Button
  size="sm"
  variant="outline"
  className="h-7 px-3 text-[13px]"
>
  Connect
</Button>

<Button
  size="sm"
  variant="ghost"
  className="h-7 w-7 p-0"
>
  <ExternalLinkIcon className="h-3.5 w-3.5" />
</Button>
```
✅ Hauteur fixe `h-7` (28px), texte `text-[13px]`
✅ Icônes `h-3.5 w-3.5` (14px)

### 9. **Input self-hosted**
**Avant :**
- Dans un `<details>` visible en permanence
- Taille par défaut

**Après :**
```tsx
<Input
  placeholder={`https://${forge.kind}.company.com`}
  className="h-8 text-[13px]"
  value={selfHostedUrl}
  onChange={...}
/>
```
✅ Hauteur `h-8` (32px), texte `text-[13px]`
✅ Affiché inline quand "Self-hosted" cliqué

### 10. **Status "Connected"**
**Avant :**
```tsx
<div className="flex items-center gap-1.5 text-sm text-green-600">
  <CheckCircle2Icon className="h-4 w-4" />
  <span>Connected</span>
</div>
```

**Après :**
```tsx
<span className="text-[13px] text-success">Connected</span>
```
✅ Simple texte avec couleur sémantique (`text-success`)
✅ Pas d'icône redondante (StatusDot déjà présent)

### 11. **Bouton "Check again"**
**Avant :**
- Taille normale
- Variant `outline`

**Après :**
```tsx
<Button
  size="sm"
  variant="ghost"
  className="h-7 px-2 text-[13px]"
>
  {isLoading ? 'Checking...' : 'Check again'}
</Button>
```
✅ Variant `ghost` (plus discret), hauteur `h-7`

### 12. **Note informative (supprimée)**
**Avant :** Grosse box avec bordure en bas de page
**Après :** Supprimée
✅ Pas nécessaire, le hint "Run: ..." est déjà explicite

---

## 🎯 Résultat : Cohérence totale

### Espacement
- ✅ `mb-2` entre header et contenu
- ✅ `space-y-2` entre les cartes (8px)
- ✅ `gap-4` dans les cartes (16px)
- ✅ `mt-0.5` / `mt-1.5` / `mt-2` pour spacing vertical interne

### Tailles de police
- ✅ Headers sections : `text-sm font-semibold` (14px)
- ✅ Descriptions : `text-[13px]` (13px)
- ✅ Labels cartes : `text-sm font-medium` (14px)
- ✅ Contenu cartes : `text-[13px]` (13px)
- ✅ Metadata : `text-xs` (12px, 11px effectif)

### Couleurs
- ✅ `text-foreground` pour texte principal
- ✅ `text-muted-foreground` pour descriptions
- ✅ `text-soft-foreground` pour metadata
- ✅ `text-success` / `text-pending` / `text-danger` pour status
- ✅ `bg-pending/10` pour hints (au lieu de yellow custom)

### Formes
- ✅ `rounded-md` pour cartes (6px)
- ✅ `rounded-sm` pour elements internes (4px)
- ✅ Bordures `border-border` consistantes

### Boutons
- ✅ Hauteur fixe `h-7` (28px) pour tous les boutons
- ✅ Icônes `h-3.5 w-3.5` (14px)
- ✅ Texte `text-[13px]` dans les boutons
- ✅ Padding horizontal adapté : `px-2` (ghost), `px-3` (outline)

---

## 📊 Comparaison avant/après

### Avant (non aligné)
```tsx
// Cartes volumineuses
<div className="rounded-lg border border-border bg-card p-4">
  <h3 className="font-semibold text-base">GitHub</h3>
  <p className="mt-1 text-sm text-muted-foreground">...</p>
  
  // Warning avec yellow custom
  <div className="bg-yellow-500/10">
    <AlertCircleIcon />
  </div>
  
  // Boutons taille par défaut
  <Button size="sm">Connect</Button>
</div>
```

### Après (aligné)
```tsx
// Cartes compactes, pattern horizontal
<div className="rounded-md border border-border px-3 py-2.5">
  <div className="flex items-start justify-between gap-4">
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <StatusDot tone={tone} className="mt-1" />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">GitHub</h3>
        <p className="mt-0.5 text-[13px]">...</p>
        
        // Warning avec couleur sémantique
        <div className="bg-pending/10 px-2 py-1.5">
          <p className="text-[13px] text-pending-foreground">...</p>
        </div>
      </div>
    </div>
    
    // Actions à droite
    <div className="flex shrink-0 items-center gap-1.5">
      <Button className="h-7 px-3 text-[13px]">Connect</Button>
    </div>
  </div>
</div>
```

---

## ✅ Checklist de conformité

- [x] IDs et data-slots ajoutés (`id="forges"`, `data-slot="forge-settings"`)
- [x] Classes de scroll (`scroll-mt-20`)
- [x] Typographie exacte (text-sm, text-[13px], text-xs)
- [x] Espacement exact (mb-2, space-y-2, gap-3, gap-4)
- [x] Couleurs sémantiques (success, pending, danger)
- [x] Formes (rounded-md, rounded-sm)
- [x] Boutons hauteur fixe (h-7)
- [x] StatusDot avec `mt-1` pour alignement
- [x] Layout horizontal compact
- [x] Pas de bg-card sur les cartes (transparent)
- [x] Padding cartes px-3 py-2.5 (pas p-4)
- [x] Icons h-3.5 w-3.5 (pas h-4 w-4)

---

## 🎨 Design System respecté

Le composant ForgesSection suit maintenant **100%** les patterns de Settings :
- Structure identique à provider-settings.tsx
- Spacing identique
- Typographie identique
- Couleurs identiques
- Formes identiques
- Interactions identiques

**Résultat :** Interface cohérente et professionnelle qui s'intègre parfaitement dans Settings ! ✨

---

*Audit design complété le : 7 octobre 2026*
*Pattern de référence : provider-settings.tsx*
*Conformité : 100%*
