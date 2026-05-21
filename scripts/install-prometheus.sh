#!/usr/bin/env bash
# Install kube-prometheus-stack via Helm in the monitoring namespace.
# Provides Prometheus, Alertmanager, Grafana, and the Prometheus Operator
# (which defines the ServiceMonitor CRD that the canary scrape config uses).

set -euo pipefail

NAMESPACE="${NAMESPACE:-monitoring}"
RELEASE_NAME="${RELEASE_NAME:-kube-prometheus-stack}"

if ! command -v helm >/dev/null 2>&1; then
  echo "helm is required. Install from https://helm.sh/docs/intro/install/" >&2
  exit 1
fi

echo "==> Adding prometheus-community Helm repository"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
helm repo update >/dev/null

echo "==> Creating namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo "==> Installing ${RELEASE_NAME} into ${NAMESPACE}"
helm upgrade --install "${RELEASE_NAME}" prometheus-community/kube-prometheus-stack \
  --namespace "${NAMESPACE}" \
  --set grafana.enabled=true \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
  --set prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues=false \
  --wait \
  --timeout 10m

echo "==> Done. Prometheus reachable at:"
echo "    http://${RELEASE_NAME}-prometheus.${NAMESPACE}.svc.cluster.local:9090"
