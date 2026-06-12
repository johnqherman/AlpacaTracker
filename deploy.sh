#!/bin/bash
set -e

cd /var/www/AlpacaTracker

git fetch origin
git reset --hard origin/master

docker compose up --build -d

docker image prune -f
