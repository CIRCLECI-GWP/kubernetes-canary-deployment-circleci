# Canary deployment on Kubernetes with CircleCI and Argo Rollouts

Sample repository for the CircleCI tutorial **How to set up canary deployments on Kubernetes with CircleCI and Argo Rollouts**. It runs a Node.js app under an Argo Rollouts `Rollout` resource that ships new versions to a graduated share of production traffic (~10%, ~30%, ~50%, 100% with 10 replicas), with each step gated by an `AnalysisTemplate` that queries Prometheus for the canary's error rate on real user requests. A bad release auto-rolls back without human intervention.

## What's in here

```
.
├── app/                          # Node.js sample app with /metrics endpoint
├── k8s/
│   ├── namespace.yml             # canary-tutorial namespace
│   ├── rollout.yml               # Argo Rollouts Rollout (replaces Deployment)
│   ├── service.yml               # Single LoadBalancer for stable + canary
│   ├── analysis-template.yml     # Prometheus error-rate gate
│   └── servicemonitor.yml        # Prometheus scrape config
├── .circleci/
│   ├── config.yml                # Build, push, update rollout, monitor
│   └── rollback.yml              # Manual rollback pipeline
└── scripts/
    ├── install-argo-rollouts.sh  # Controller + kubectl plugin
    ├── install-prometheus.sh     # kube-prometheus-stack via Helm
    └── initial-deploy.sh         # First-time deploy at version 1.0.0
```

## Prerequisites

- A Kubernetes cluster reachable via `kubectl` (any provider works; the tutorial uses GKE)
- Docker, Node 20+, `envsubst` (`gettext` on macOS), and `helm` installed locally
- A Docker Hub account with a repository named `canary-tutorial-app`
- A CircleCI account with the repository connected as a project

## Quickstart

```bash
# 1. Install Argo Rollouts and Prometheus on the cluster
./scripts/install-argo-rollouts.sh
./scripts/install-prometheus.sh

# 2. Build and push the initial image
export DOCKERHUB_USERNAME=<your-dockerhub-user>
export CIRCLE_PROJECT_ID=<your-circleci-project-id>
docker build --build-arg APP_VERSION=1.0.0 \
  -t $DOCKERHUB_USERNAME/canary-tutorial-app:1.0.0 ./app
docker push $DOCKERHUB_USERNAME/canary-tutorial-app:1.0.0

# 3. Apply the initial Rollout
IMAGE_TAG=1.0.0 ./scripts/initial-deploy.sh

# 4. Watch a canary roll out (after the CircleCI pipeline pushes a new image tag)
kubectl argo rollouts get rollout canary-tutorial-app -n canary-tutorial --watch
```

## CircleCI context

Create a context named `canary-tutorial` with these environment variables:

| Variable             | Value                                                                   |
|----------------------|-------------------------------------------------------------------------|
| `DOCKERHUB_USERNAME` | Docker Hub username                                                     |
| `DOCKERHUB_PASSWORD` | Docker Hub access token                                                 |
| `KUBECONFIG_DATA`    | Base64-encoded kubeconfig — generate via `./scripts/generate-kubeconfig.sh` |

`scripts/generate-kubeconfig.sh` creates a namespace-scoped `ServiceAccount`, binds it to the built-in `admin` role inside `canary-tutorial`, mints a long-lived token via a Secret of type `kubernetes.io/service-account-token`, and prints a base64-encoded kubeconfig with the token embedded directly. The resulting kubeconfig has no `exec:` provider and no `gke-gcloud-auth-plugin` dependency, so the CircleCI runner uses it as-is — no gcloud SDK needed.

```bash
# Run with kubectl already pointed at the target cluster
./scripts/generate-kubeconfig.sh > /tmp/canary-kubeconfig.b64
pbcopy < /tmp/canary-kubeconfig.b64    # macOS
```

Paste the resulting string as `KUBECONFIG_DATA` in the context. The token is namespace-scoped to `canary-tutorial`; rotating it means re-running the script and updating the context value.

## Demonstrating an automatic rollback

The sample app reads a `FAIL_RATE` environment variable that returns HTTP 500 for that percentage of `/` and `/api` requests (`/health` and `/metrics` always return 200, so readiness probes pass and the AnalysisRun is the signal that trips the abort).

```bash
# Build a "broken" image: 30% of user requests will return 500.
docker build \
  --build-arg APP_VERSION=1.2.0-broken \
  --build-arg FAIL_RATE=30 \
  -t $DOCKERHUB_USERNAME/canary-tutorial-app:1.2.0-broken \
  ./app
docker push $DOCKERHUB_USERNAME/canary-tutorial-app:1.2.0-broken
```

The `AnalysisTemplate` gates on a minimum traffic rate (`> 0.1 req/sec`) so cold-start with zero traffic stays Inconclusive instead of false-passing. To make the demo reproducible without organic production traffic, drive a constant load loop in a separate terminal:

```bash
LB_IP=$(kubectl get svc canary-tutorial-app -n canary-tutorial \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

while true; do
  curl -s -o /dev/null "http://${LB_IP}/api"
  sleep 0.1
done
```

Then trigger the canary:

```bash
kubectl argo rollouts set image canary-tutorial-app \
  canary-tutorial-app=$DOCKERHUB_USERNAME/canary-tutorial-app:1.2.0-broken \
  -n canary-tutorial

kubectl argo rollouts get rollout canary-tutorial-app -n canary-tutorial --watch
```

At step 1 (`setWeight: 5`), one of ten pods is canary and ~10% of LB traffic lands on it. With `FAIL_RATE=30`, the canary-scoped error rate is ~30%, well clear of the 5% failure threshold. The `AnalysisRun` records three consecutive Failed measurements after the 60-second `initialDelay`, then `failureLimit: 3` aborts the rollout. End-to-end: ~150 seconds from `set image` to canary scaled back to zero.

## Manual rollback via CircleCI

Trigger the `.circleci/rollback.yml` pipeline from the **Deploys** dashboard. It runs `kubectl argo rollouts abort` followed by `kubectl argo rollouts undo`, then waits for the rollout to return to Healthy.

## Cleanup

```bash
kubectl delete namespace canary-tutorial
```

(Leave `argo-rollouts` and `monitoring` namespaces in place if running other tutorials on the same cluster.)
