#!/usr/bin/env bash
# One-time setup: create the canary-tutorial namespace, apply the AnalysisTemplate,
# the Service, the ServiceMonitor, and the initial Rollout at version 1.0.0.
#
# Required environment variables:
#   DOCKERHUB_USERNAME   Docker Hub user owning the canary-tutorial-app image
#   IMAGE_TAG            Image tag for the initial deploy (default: 1.0.0)
#   CIRCLE_PROJECT_ID    CircleCI project ID for the deploy marker labels

set -euo pipefail

: "${DOCKERHUB_USERNAME:?DOCKERHUB_USERNAME must be set}"
: "${CIRCLE_PROJECT_ID:?CIRCLE_PROJECT_ID must be set}"
export IMAGE_TAG="${IMAGE_TAG:-1.0.0}"
export DOCKERHUB_USERNAME CIRCLE_PROJECT_ID

if ! command -v envsubst >/dev/null 2>&1; then
  echo "envsubst is required (brew install gettext / apt-get install gettext-base)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

echo "==> Creating canary-tutorial namespace"
kubectl apply -f k8s/namespace.yml

echo "==> Applying Service, AnalysisTemplate, and ServiceMonitor"
kubectl apply -f k8s/service.yml
kubectl apply -f k8s/analysis-template.yml
kubectl apply -f k8s/servicemonitor.yml

echo "==> Applying initial Rollout at ${IMAGE_TAG}"
envsubst < k8s/rollout.yml | kubectl apply -f -

echo "==> Waiting for Rollout to reach Healthy"
kubectl argo rollouts status canary-tutorial-app -n canary-tutorial --timeout 5m

echo "==> LoadBalancer endpoint:"
kubectl get svc canary-tutorial-app -n canary-tutorial \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}' && echo
