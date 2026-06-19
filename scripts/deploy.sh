#!/usr/bin/env bash
# EC2 first-time setup — run once after cloning the repo.
# Subsequent deploys: git pull && docker compose up --build -d
set -euo pipefail

echo "==> Installing Docker..."
sudo dnf update -y
sudo dnf install -y docker
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ec2-user
newgrp docker

echo "==> Installing Docker Compose plugin..."
sudo dnf install -y docker-compose-plugin

echo "==> Creating data and logs directories..."
mkdir -p data logs

echo "==> Building and starting..."
docker compose up --build -d

echo ""
echo "Done. App running on port 3000."
echo "Logs: docker compose logs -f"
echo "Stop: docker compose down"
echo "Redeploy: git pull && docker compose up --build -d"
