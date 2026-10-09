#!/usr/bin/env bash
# Script de validation rapide pour l'implémentation Kilo Code
# Usage: ./validate-kilo-implementation.sh

set -e

echo "🔍 Validation de l'implémentation Kilo Code"
echo "=========================================="
echo ""

# Couleurs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
}

info() {
    echo -e "ℹ $1"
}

# Vérifier que nous sommes dans le bon répertoire
if [ ! -f "package.json" ]; then
    error "Erreur: package.json introuvable. Exécutez ce script depuis la racine du projet."
    exit 1
fi

# 1. Vérifier que les fichiers existent
echo "1. Vérification des fichiers créés/modifiés..."
echo ""

check_file() {
    if [ -f "$1" ]; then
        success "$1"
        return 0
    else
        error "$1 - MANQUANT"
        return 1
    fi
}

FILES=(
    "packages/cezar/src/core/kilo-runner.ts"
    "packages/cezar/src/core/agent-runner.ts"
    "packages/cezar/src/core/runner-factory.ts"
    "packages/cezar/src/core/backend-detect.ts"
    "packages/cezar/src/core/agent-env.ts"
    "packages/cezar/src/core/ui-events.ts"
    "packages/contract/src/health.ts"
    "packages/contract/src/workspace.ts"
    "packages/api-client/src/protocol/ui-events.ts"
    "packages/web/src/components/tools-menu.tsx"
    "packages/web/src/lib/provider-status.ts"
    ".env.example"
    "KILO_IMPLEMENTATION.md"
    "KILO_IMPLEMENTATION_PROGRESS.md"
)

all_files_exist=true
for file in "${FILES[@]}"; do
    check_file "$file" || all_files_exist=false
done

echo ""

if [ "$all_files_exist" = false ]; then
    error "Certains fichiers sont manquants!"
    exit 1
fi

# 2. Vérifier que 'kilo' est présent dans les fichiers clés
echo "2. Vérification de la présence de 'kilo' dans les fichiers..."
echo ""

check_content() {
    if grep -q "$2" "$1"; then
        success "$1 contient '$2'"
        return 0
    else
        error "$1 ne contient PAS '$2'"
        return 1
    fi
}

all_content_ok=true

check_content "packages/cezar/src/core/agent-runner.ts" "'kilo'" || all_content_ok=false
check_content "packages/cezar/src/core/runner-factory.ts" "case 'kilo':" || all_content_ok=false
check_content "packages/cezar/src/core/backend-detect.ts" "probeKilo" || all_content_ok=false
check_content "packages/contract/src/health.ts" "'kilo'" || all_content_ok=false
check_content "packages/api-client/src/protocol/ui-events.ts" "'kilo'" || all_content_ok=false
check_content ".env.example" "CEZ_KILO_BIN" || all_content_ok=false

echo ""

if [ "$all_content_ok" = false ]; then
    error "Certains fichiers ne contiennent pas les modifications attendues!"
    exit 1
fi

# 3. Vérifier les imports
echo "3. Vérification des imports..."
echo ""

if grep -q "import.*KiloRunner" "packages/cezar/src/core/runner-factory.ts"; then
    success "KiloRunner est importé dans runner-factory.ts"
else
    error "KiloRunner n'est PAS importé dans runner-factory.ts"
    all_content_ok=false
fi

echo ""

# 4. Compter les occurrences de 'kilo' pour vérifier la cohérence
echo "4. Statistiques de l'implémentation..."
echo ""

kilo_count=$(grep -r "'kilo'" packages/cezar/src/core packages/contract/src packages/api-client/src packages/web/src 2>/dev/null | wc -l)
info "Nombre d'occurrences de 'kilo' dans le code: $kilo_count"

runner_ids_count=$(grep -r "RUNNER_IDS" packages/ 2>/dev/null | wc -l)
info "Fichiers utilisant RUNNER_IDS: $runner_ids_count"

echo ""

# 5. Vérifier la structure du runner
echo "5. Vérification de la structure du KiloRunner..."
echo ""

check_class_method() {
    if grep -q "$2" "$1"; then
        success "$1 contient $2"
        return 0
    else
        warning "$1 ne contient pas $2"
        return 1
    fi
}

check_class_method "packages/cezar/src/core/kilo-runner.ts" "export class KiloRunner"
check_class_method "packages/cezar/src/core/kilo-runner.ts" "readonly backend = 'kilo'"
check_class_method "packages/cezar/src/core/kilo-runner.ts" "startSession"
check_class_method "packages/cezar/src/core/kilo-runner.ts" "interrupt"

echo ""

# 6. Liste des fichiers qui nécessitent des mises à jour manuelles
echo "6. Fichiers nécessitant une attention manuelle..."
echo ""

warning "Tests à mettre à jour avec 'kilo':"
echo "  - packages/web/src/routes/new-task-form.test.ts"
echo "  - packages/web/src/components/engine-pills.test.ts"
echo "  - packages/web/src/routes/settings/agent-descriptors.test.ts"
echo "  - packages/web/src/routes/settings/accounts-section.test.tsx"
echo ""

warning "UI Components à mettre à jour:"
echo "  - packages/web/src/routes/settings/agent-descriptors.ts (ajouter descripteur Kilo)"
echo ""

warning "Fixtures à créer:"
echo "  - packages/cezar/src/core/__fixtures__/kilo/"
echo "  - packages/cezar/src/core/kilo-ui-mapper.test.ts"
echo ""

# 7. Résumé final
echo "=========================================="
echo ""

if [ "$all_files_exist" = true ] && [ "$all_content_ok" = true ]; then
    success "Validation réussie! ✨"
    echo ""
    info "L'implémentation de base de Kilo Code est complète."
    info "Statut: ~70% terminé"
    echo ""
    info "Prochaines étapes:"
    echo "  1. Mettre à jour les tests (voir liste ci-dessus)"
    echo "  2. Ajouter le descripteur agent dans settings"
    echo "  3. Créer les fixtures de test"
    echo "  4. Exécuter: npm run typecheck"
    echo "  5. Exécuter: npm test"
    echo ""
    info "Documentation: voir KILO_IMPLEMENTATION_PROGRESS.md"
    exit 0
else
    error "Validation échouée! ❌"
    echo ""
    info "Vérifiez les erreurs ci-dessus et corrigez-les."
    exit 1
fi
