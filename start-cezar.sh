#!/usr/bin/env bash
# Démarre Cezar en mode développement et ouvre automatiquement le cockpit.
# Usage : ./start-cezar.sh

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Erreur : Node.js et npm doivent être installés et disponibles dans le PATH." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installation des dépendances..."
  npm install
fi

echo "Démarrage de Cezar..."
# Le script « dev » lance l'API et Vite, puis ouvre le cockpit dans le navigateur.
exec npm run dev
