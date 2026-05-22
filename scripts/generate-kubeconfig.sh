#!/usr/bin/env bash
# Generate a base64-encoded kubeconfig for use as the KUBECONFIG_DATA
# CircleCI context variable. The kubeconfig embeds a ServiceAccount token
# directly, so the CircleCI runner needs no gcloud SDK, no
# gke-gcloud-auth-plugin, and no cluster-specific auth tooling.
#
# Requires `kubectl` configured for the target cluster (e.g. after
# `gcloud container clusters get-credentials ...` locally). Idempotent:
# re-running emits a fresh base64 string for the same long-lived token.
#
# The token comes from a Secret of type kubernetes.io/service-account-token,
# which Kubernetes auto-populates with a non-expiring token tied to the
# ServiceAccount. This is the long-lived-token pattern for CI/CD; for
# stricter setups, use `kubectl create token` instead and accept the
# cluster's default expiration (often 24-48h).
#
# Usage:
#   ./scripts/generate-kubeconfig.sh > /tmp/canary-kubeconfig.b64
#   pbcopy < /tmp/canary-kubeconfig.b64    # macOS

set -euo pipefail

NAMESPACE="${NAMESPACE:-canary-tutorial}"
SA_NAME="${SA_NAME:-circleci-deployer}"
SECRET_NAME="${SECRET_NAME:-${SA_NAME}-token}"

if ! kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
  echo "namespace ${NAMESPACE} does not exist; run scripts/initial-deploy.sh first" >&2
  exit 1
fi

# Create ServiceAccount, RoleBinding (admin scoped to ${NAMESPACE} —
# Argo Rollouts CRDs are aggregated into the built-in admin role), and a
# Secret tied to the SA. Stderr from `kubectl apply` goes to /dev/null so
# only the final base64 string lands on stdout.
kubectl apply -f - >/dev/null 2>&1 <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${SA_NAME}
  namespace: ${NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SA_NAME}-admin
  namespace: ${NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: admin
subjects:
  - kind: ServiceAccount
    name: ${SA_NAME}
    namespace: ${NAMESPACE}
---
apiVersion: v1
kind: Secret
metadata:
  name: ${SECRET_NAME}
  namespace: ${NAMESPACE}
  annotations:
    kubernetes.io/service-account.name: ${SA_NAME}
type: kubernetes.io/service-account-token
EOF

# Wait for the controller to populate the Secret's data.token field.
for _ in $(seq 1 20); do
  TOKEN=$(kubectl -n "${NAMESPACE}" get secret "${SECRET_NAME}" \
    -o jsonpath='{.data.token}' 2>/dev/null | base64 --decode 2>/dev/null || true)
  if [ -n "${TOKEN}" ]; then break; fi
  sleep 1
done

if [ -z "${TOKEN:-}" ]; then
  echo "timed out waiting for Secret ${SECRET_NAME} to be populated" >&2
  exit 1
fi

# Pull endpoint + CA from the currently selected context.
CLUSTER_SERVER=$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.server}')
CLUSTER_CA=$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')

if [ -z "${CLUSTER_SERVER}" ] || [ -z "${CLUSTER_CA}" ]; then
  echo "failed to read cluster endpoint or CA cert from current kubectl context" >&2
  exit 1
fi

# Build the kubeconfig. The 'user' block uses 'token:' directly — no exec
# provider, no auth plugin, no gcloud dependency.
KUBECONFIG_CONTENT=$(cat <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: canary-tutorial-cluster
    cluster:
      server: ${CLUSTER_SERVER}
      certificate-authority-data: ${CLUSTER_CA}
contexts:
  - name: circleci
    context:
      cluster: canary-tutorial-cluster
      user: ${SA_NAME}
      namespace: ${NAMESPACE}
current-context: circleci
users:
  - name: ${SA_NAME}
    user:
      token: ${TOKEN}
EOF
)

# Emit on stdout, base64-encoded, no newlines. Suitable for direct paste
# into the CircleCI context UI.
printf '%s' "${KUBECONFIG_CONTENT}" | base64 | tr -d '[:space:]'
echo
