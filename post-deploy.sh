#!/usr/bin/env bash
set -e

# Post-deploy hook: create symbolic link from ../.env to ./.env
echo "[Post-Deploy] Creating symbolic link from ../.env to ./.env..."
ln -sf ../.env .env
echo "[Post-Deploy] .env -> $(readlink .env 2>/dev/null || echo '../.env')"
