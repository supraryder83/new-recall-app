#!/usr/bin/env bash
set -e

# ---------------------------------------------------------------------------------
# Deployment Hook for release/symlink workflow (deploy/current/)
# Creates a symbolic link from the parent directory's .env (deploy/.env)
# to the current active release directory (deploy/current/.env).
# ---------------------------------------------------------------------------------

echo "[Post-Deploy] Creating symbolic link from ../.env to ./.env..."
ln -sf ../.env .env

if [ -L ".env" ]; then
  echo "[Post-Deploy] Symlink established: $(ls -l .env)"
else
  echo "[Post-Deploy] Warning: .env symlink could not be verified."
fi
