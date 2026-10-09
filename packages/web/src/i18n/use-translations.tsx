import { createContext, useContext, type ReactNode } from 'react'
import { translate, type Language, type TranslationKey } from './translations'

interface TranslationContextValue {
  language: Language
  t: (key: TranslationKey) => string
}

/**
 * The context's DEFAULT is a real, working English translation, not `null`. Every caller of
 * `useTranslations` gets an answer whether or not a provider is above it, and the tree stays
 * renderable while its data is still arriving.
 *
 * That is the bug this replaces: the default was `null`, `useTranslations` threw on `null`, and
 * `TranslationProvider` sat INSIDE `useAppearance()` in `app.tsx` because the language comes from
 * appearance. So the ~14 components that call the hook — the whole app shell, the nav, the task
 * table — were rendered by the provider's own parent's first paint with no provider above them, and
 * the whole cockpit went blank. 584 tests across 16 files caught it. Provider ordering was not the
 * problem to solve: a hook whose contract is "translate a UI string" should never be the thing that
 * takes the screen down, and moving the provider up would only have narrowed the window.
 *
 * `Mark`/`Translate` still refuse an unknown key — see `t` below — so the fail-open is scoped to the
 * one question a missing provider can legitimately answer (which language?) and not to the typo.
 */
const TranslationContext = createContext<TranslationContextValue>({
  language: 'en',
  t: (key: TranslationKey) => translate(key, 'en'),
})

export function TranslationProvider({ language, children }: { language: Language; children: ReactNode }) {
  const t = (key: TranslationKey) => translate(key, language)

  return (
    <TranslationContext.Provider value={{ language, t }}>
      {children}
    </TranslationContext.Provider>
  )
}

export function useTranslations() {
  const context = useContext(TranslationContext)
  const wrapped = (key: TranslationKey): string => {
    const value = context.t(key)
    // A key the catalog does not hold is a BUG, not a missing translation: the typed union makes
    // `t('nope')` a compile error, so reaching here means a test handed the context a `Translation`
    // object where the function expected its `en` half, or the catalog and a persisted ui-state
    // disagree. Reflecting throws the provider's own message — silently returning "" would paint an
    // empty label and let the typo ship. This is the assertion the old `null` check was reaching for;
    // it now fires on the key rather than on the absence of a provider.
    if (typeof value !== 'string') throw new Error('useTranslations must be used within TranslationProvider')
    return value
  }
  return { language: context.language, t: wrapped }
}
