#!/bin/sh
# Starts the Convex local backend for preview deployments.
# Called by docker-compose.preview.yml convex service.
#
# NOTE: --local-force-upgrade is intentionally OMITTED because it forces a
# Convex binary version that produced 500 InternalServerError on schema
# push (start_push). The default binary version embedded with the CLI works.
set -e

mkdir -p /root/.cache/tmp

cd /app/packages/convex
npm install --no-save --no-audit --no-fund 2>&1 | tail -3

MAX=5
n=0
while [ "$n" -lt "$MAX" ]; do
  n=$((n + 1))
  echo "Convex dev attempt $n/$MAX..."
  npx convex dev --local && break || {
    echo "Attempt $n failed, retrying in 10s..."
    sleep 10
  }
done
