# 🔴 PROBLÈMES IDENTIFIÉS : Non-conformité avec le design

## Analyse comparative Providers vs Forges

### ❌ **Problème 1 : Structure de carte différente**

**Providers (correct):**
```tsx
<div className="rounded-md border border-border bg-card px-3.5 py-3">
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <h3 className="text-[13px] font-semibold">Label</h3>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <StatusDot />
        <span>Status</span>
      </div>
    </div>
    <div className="flex items-center gap-2">
      {/* Actions */}
    </div>
  </div>
</div>
```

**Forges (incorrect):**
```tsx
<div className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2.5">
  ❌ Pas de bg-card
  ❌ px-3 au lieu de px-3.5
  ❌ py-2.5 au lieu de py-3
  ❌ gap-4 au lieu de gap-3
  ❌ Pas de wrapper flex-wrap
  
  <div className="flex min-w-0 flex-1 items-start gap-3">
    <StatusDot className="mt-1" />  ❌ StatusDot à part
    <div className="min-w-0 flex-1">
      <h3 className="text-sm font-medium">  ❌ text-sm au lieu de text-[13px]
      <p className="mt-0.5 text-[13px]">  ❌ Description trop tôt
    </div>
  </div>
</div>
```

### ❌ **Problème 2 : Ordre du contenu**

**Providers:**
1. Titre (text-[13px] font-semibold)
2. Status line (mt-1, text-xs avec StatusDot + label)
3. Hint/Description (mt-1.5, text-xs)
4. Actions à droite

**Forges:**
1. Titre (text-sm ❌)
2. Username sur même ligne ❌
3. Description (mt-0.5 ❌)
4. Hint
5. Actions à droite

### ❌ **Problème 3 : StatusDot placement**

**Providers:** Dans une div avec le status label
```tsx
<div className="mt-1 flex items-center gap-2 text-xs">
  <StatusDot />
  <span>Connected</span>
</div>
```

**Forges:** À part, avec mt-1
```tsx
<StatusDot className="mt-1" />  ❌ Séparé du texte
```

### ❌ **Problème 4 : Classes manquantes**

| Élément | Providers | Forges | Status |
|---------|-----------|--------|--------|
| Card bg | `bg-card` | ❌ absent | MANQUANT |
| Card padding | `px-3.5 py-3` | `px-3 py-2.5` | INCORRECT |
| Gap | `gap-3` | `gap-4` | INCORRECT |
| Flex wrap | `flex-wrap` | ❌ absent | MANQUANT |
| Titre size | `text-[13px]` | `text-sm` | INCORRECT |
| Titre weight | `font-semibold` | `font-medium` | INCORRECT |

### ❌ **Problème 5 : Description placement**

**Providers:** Pas de description générale, seulement des hints conditionnels

**Forges:** Description toujours affichée avec `mt-0.5` ❌

---

## ✅ **CORRECTIONS NÉCESSAIRES**

### 1. Structure de carte
```tsx
// Changer de :
<div className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2.5">

// À :
<div className="rounded-md border border-border bg-card px-3.5 py-3">
  <div className="flex flex-wrap items-start justify-between gap-3">
```

### 2. Ordre et typographie
```tsx
<div className="min-w-0">
  {/* Titre : text-[13px] font-semibold */}
  <h3 className="text-[13px] font-semibold text-foreground">{forge.label}</h3>
  
  {/* Status line avec StatusDot INLINE */}
  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
    <StatusDot tone={tone} />
    <span>Connected / Not connected / Not installed</span>
    {user && <span>• {user}</span>}
  </div>
  
  {/* Description en text-xs (pas text-[13px]) */}
  <p className="mt-1.5 text-xs text-soft-foreground">
    {forge.description}
  </p>
  
  {/* Hint si présent */}
  {hint && <div className="mt-2">...</div>}
  
  {/* Version */}
  {version && <p className="mt-1.5 text-xs">...</p>}
</div>
```

### 3. Actions à droite
```tsx
<div className="flex items-center gap-2">
  {/* Pas de classes h-7, px-2, text-[13px] sur les boutons */}
  {/* Juste size="sm" variant="outline" / "ghost" */}
  <Button size="sm" variant="outline">Connect</Button>
  <Button size="sm" variant="ghost">...</Button>
</div>
```

---

## 📋 **CHECKLIST FINALE**

- [ ] Ajouter `bg-card` sur la carte
- [ ] Changer padding en `px-3.5 py-3`
- [ ] Changer gap en `gap-3`
- [ ] Ajouter wrapper avec `flex-wrap`
- [ ] Titre en `text-[13px] font-semibold`
- [ ] StatusDot + status INLINE dans une div
- [ ] Description en `text-xs` (pas `text-[13px]`)
- [ ] Description avec `mt-1.5` (pas `mt-0.5`)
- [ ] Supprimer les classes custom sur boutons (h-7, px-2, text-[13px])
- [ ] Username dans la status line (pas sur titre)

---

*Analyse complétée le : 7 octobre 2026*
*Référence : packages/web/src/routes/settings/provider-settings.tsx lignes 236-270*
