#!/usr/bin/env bash
# Install the Argo Rollouts controller and the kubectl plugin.
# Idempotent: re-running upgrades to the latest release.

set -euo pipefail

NAMESPACE="${NAMESPACE:-argo-rollouts}"

echo "==> Creating namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo "==> Installing Argo Rollouts controller"
kubectl apply -n "${NAMESPACE}" \
  -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml

echo "==> Waiting for controller to become ready"
kubectl rollout status deployment/argo-rollouts -n "${NAMESPACE}" --timeout=5m

echo "==> Installing kubectl-argo-rollouts plugin"
OS="$(uname | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
esac

PLUGIN_URL="https://github.com/argoproj/argo-rollouts/releases/latest/download/kubectl-argo-rollouts-${OS}-${ARCH}"
TMP_BIN="$(mktemp)"
curl -sSL -o "${TMP_BIN}" "${PLUGIN_URL}"
chmod +x "${TMP_BIN}"

INSTALL_PATH="${INSTALL_PATH:-/usr/local/bin/kubectl-argo-rollouts}"
if [ -w "$(dirname "${INSTALL_PATH}")" ]; then
  mv "${TMP_BIN}" "${INSTALL_PATH}"
else
  sudo mv "${TMP_BIN}" "${INSTALL_PATH}"
fi

echo "==> Installed: $(kubectl argo rollouts version 2>/dev/null || true)"
