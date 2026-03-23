#!/bin/bash
echo "Setting up Convex environment..."
cd packages/convex
if [ ! -f .env.local ]; then
    echo "Please run 'make dev-convex' (or 'cd packages/convex && env -u TZ npx convex dev') to log in and create a project."
    echo "Once done, the types will be generated in '_generated/'."
else
    echo "Convex environment seems configured."
    env -u TZ npx convex dev --once
fi
