#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage : $0 <email>" >&2
  exit 1
fi

cd "$(dirname "$0")/../.."

printf "UPDATE users SET role = 'admin' WHERE email = lower(:'email');\n" |
  docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v email="$1"' _ "$1"

echo "Rôle admin attribué à $1 (si le compte existe)."
