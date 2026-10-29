#!/usr/bin/env bash
set -euo pipefail

preferred_shadow_port=${1:-54320}

if ! [[ "$preferred_shadow_port" =~ ^[0-9]+$ ]] \
  || (( preferred_shadow_port < 1024 || preferred_shadow_port > 65526 )); then
  echo "Preferred Supabase shadow port must be between 1024 and 65526." >&2
  exit 2
fi

port_is_available() {
  local port=$1
  ! ss -H -ltn "sport = :${port}" | grep -q .
}

block_is_available() {
  local shadow_port=$1
  local offset
  for offset in 0 1 2 3 4 9; do
    if ! port_is_available "$((shadow_port + offset))"; then
      return 1
    fi
  done
}

selected_shadow_port=
for candidate in "$preferred_shadow_port" $(seq 56020 100 64920); do
  if block_is_available "$candidate"; then
    selected_shadow_port=$candidate
    break
  fi
done

if [[ -z "$selected_shadow_port" ]]; then
  echo "No free local Supabase port block is available." >&2
  exit 1
fi

printf 'SUPABASE_SHADOW_PORT=%s\n' "$selected_shadow_port"
printf 'SUPABASE_API_PORT=%s\n' "$((selected_shadow_port + 1))"
printf 'SUPABASE_DB_PORT=%s\n' "$((selected_shadow_port + 2))"
printf 'SUPABASE_STUDIO_PORT=%s\n' "$((selected_shadow_port + 3))"
printf 'SUPABASE_INBUCKET_PORT=%s\n' "$((selected_shadow_port + 4))"
printf 'SUPABASE_POOLER_PORT=%s\n' "$((selected_shadow_port + 9))"
