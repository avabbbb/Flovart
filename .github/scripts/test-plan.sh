#!/usr/bin/env bash
# Decide whether a PR can run only the Vitest tests its diff reaches
# (`vitest run --changed <base>`) or must run the whole suite.
#
# Usage: test-plan.sh <base-sha> [head-ref]
# Prints `mode=changed` or `mode=full`, plus `reason=...`.
#
# `vitest --changed` only follows the static import graph. Anything a test
# reaches some other way has to force a full run:
#   - dependency / toolchain inputs: lockfiles, package.json, .npmrc, .nvmrc
#   - config: tsconfig*, vite/vitest config, the shared test setup, this CI
#   - generated files (*.generated.*)
#   - non-module files (json/yaml/html/md fixtures, manifests, SKILL.md ...)
#     that tests read from disk
#   - code in dirs that tests spawn as child processes or read from disk
#     instead of importing (CLI, agent sidecar, scripts, eval, extension ...)
# Files nothing in the suite can see (docs/, root *.md, images, other
# workflows) are ignored.
set -euo pipefail

base="${1:?base sha required}"
head="${2:-HEAD}"

changed="$(git diff --name-only "$base" "$head")"

if [ -z "$changed" ]; then
  echo "mode=changed"
  echo "reason=empty diff"
  exit 0
fi

force_config='(^|/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|\.npmrc|\.nvmrc)$|(^|/)tsconfig[^/]*\.json$|(^|/)(vite|vitest)\.(config|workspace)\.[cm]?[jt]s$|^tests/setup\.ts$|^\.github/(workflows/ci\.yml|actions/|scripts/test-plan\.sh)|\.generated\.'
opaque_dirs='^(agent|tools|scripts|eval|extension|integrations|server|examples|skills|functions|src-tauri|\.agents)/'
ignored='^(docs|pic|stats)/|^\.(gitignore|gitattributes|editorconfig)$|^[^/]+\.md$|^\.github/|^LICENSE$|^VERSION$|\.(png|jpe?g|gif|svg|webp|ico)$'
module_file='\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$'

while IFS= read -r file; do
  [ -z "$file" ] && continue
  if [[ "$file" =~ $force_config ]]; then
    echo "mode=full"; echo "reason=config or dependency input changed: $file"; exit 0
  fi
  if [[ "$file" =~ $opaque_dirs ]]; then
    echo "mode=full"; echo "reason=file reached by spawn/fs, not imports: $file"; exit 0
  fi
  if [[ "$file" =~ $ignored ]]; then
    continue
  fi
  if ! [[ "$file" =~ $module_file ]]; then
    echo "mode=full"; echo "reason=non-module file may be read by tests: $file"; exit 0
  fi
done <<< "$changed"

echo "mode=changed"
echo "reason=only import-graph files changed"
