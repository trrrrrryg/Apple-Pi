#!/usr/bin/env bash
set -euo pipefail

# Keep the current release and the nine preceding installers by semantic version.
UPDATE_DIR="${UPDATE_DIR:-/var/www/html/apple-pi/updates}"
KEEP_RELEASES="${KEEP_RELEASES:-10}"

if [[ ! "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ ]]; then
  echo "KEEP_RELEASES must be a positive integer" >&2
  exit 2
fi

mapfile -t installers < <(
  find "$UPDATE_DIR" -maxdepth 1 -type f -name '苹果Pi Setup *.exe' -printf '%f\n' | sort -V
)

remove_count=$((${#installers[@]} - KEEP_RELEASES))
if ((remove_count <= 0)); then
  exit 0
fi

for ((index = 0; index < remove_count; index++)); do
  installer="${installers[index]}"
  rm -f -- "$UPDATE_DIR/$installer" "$UPDATE_DIR/$installer.blockmap"
  printf 'Removed expired release: %s\n' "$installer"
done
