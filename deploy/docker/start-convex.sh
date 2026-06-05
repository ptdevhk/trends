#!/bin/sh
# Starts the Convex local backend for preview deployments.
# Called by docker-compose.preview.yml convex service.
#
# NOTE: --local-force-upgrade is intentionally OMITTED because it forces a
# Convex binary version that produced 500 InternalServerError on schema
# push (start_push). The default binary version embedded with the CLI works.
set -e

mkdir -p /root/.cache/tmp

# The Convex local backend is a native binary and uses the system CA store for
# outbound HTTPS calls made by Convex actions. node:*-slim can omit it.
if [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then
  echo "Installing ca-certificates for Convex action HTTPS calls..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates
  rm -rf /var/lib/apt/lists/*
fi

export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

cd /app/packages/convex
npm install --no-save --no-audit --no-fund 2>&1 | tail -3

# Newer Convex CLI deprecates --local; select the local deployment first.
npx convex deployment select local 2>/dev/null || true

MAX=5
n=0
while [ "$n" -lt "$MAX" ]; do
  n=$((n + 1))
  echo "Convex dev attempt $n/$MAX..."
  npx convex dev && break || {
    echo "Attempt $n failed, retrying in 10s..."
    sleep 10
  }
done
