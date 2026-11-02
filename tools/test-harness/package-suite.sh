#!/bin/bash
# Keep raw Node TAP/spec output and propagate failures across every package.
set -u
rc=0
packages=(music engine-mars world-compiler generators ground kernel brain engine-toy engine-contract protocol engine-native)
[ ! -d packages/conformance/src ] || packages+=(conformance)   # EF4 core-library conformance (was packages/catalog)
for p in "${packages[@]}"; do
  echo "## $p"
  (
    cd "packages/$p" || exit 1
    shopt -s nullglob
    files=(src/*.test.ts src/core-kit/*.test.ts)
    [ ${#files[@]} -gt 0 ] || { echo "no test files for $p"; exit 1; }
    node --test --test-reporter=tap --test-concurrency=4 "${files[@]}"
  )
  package_rc=$?
  echo "## $p exit=$package_rc"
  [ "$package_rc" -eq 0 ] || rc=1
done
exit "$rc"
