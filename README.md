# Canary deployment on Kubernetes with CircleCI and Argo Rollouts

Sample repository for the CircleCI tutorial **How to set up canary deployments on Kubernetes with CircleCI and Argo Rollouts**. It runs a Node.js app under an Argo Rollouts `Rollout` resource that ships new versions to 5% of traffic, then 25%, 50%, and 100%, with each step gated by an `AnalysisTemplate` that queries Prometheus for the canary's error rate. A bad release auto-rolls back without human intervention.

## What's in here

```
.
├── app/                          # Node.js sample app with /metrics endpoint
├── k8s/
│   ├── namespace.yml             # canary-tutorial namespace
│   ├── rollout.yml               # Argo Rollouts Rollout (replaces Deployment)
│   ├── service-stable.yml        # LoadBalancer for production traffic
│   ├── service-canary.yml        # ClusterIP for canary-only probes
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

| Variable             | Value                                                              |
|----------------------|--------------------------------------------------------------------|
| `DOCKERHUB_USERNAME` | Docker Hub username                                                |
| `DOCKERHUB_PASSWORD` | Docker Hub access token                                            |
| `KUBECONFIG_DATA`    | Base64-encoded kubeconfig (`cat ~/.kube/config \| base64 \| tr -d '[:space:]'`) |

## Demonstrating an automatic rollback

The sample app reads a `FAIL_RATE` environment variable that returns HTTP 500 for that percentage of requests. Bake a high value into a release to watch the `AnalysisRun` abort the canary:

```bash
# Build a "broken" image (APP_VERSION and FAIL_RATE are baked in via build args)
docker build \
  --build-arg APP_VERSION=1.2.0-broken \
  --build-arg FAIL_RATE=10 \
  -t $DOCKERHUB_USERNAME/canary-tutorial-app:1.2.0-broken \
  ./app
docker push $DOCKERHUB_USERNAME/canary-tutorial-app:1.2.0-broken

# Point the Rollout at it (or push the SHA via CircleCI)
kubectl argo rollouts set image canary-tutorial-app \
  canary-tutorial-app=$DOCKERHUB_USERNAME/canary-tutorial-app:1.2.0-broken \
  -n canary-tutorial

# Watch
kubectl argo rollouts get rollout canary-tutorial-app -n canary-tutorial --watch
```

After ~90 seconds the `AnalysisRun` should report failure ≥5% and Argo Rollouts will abort and revert traffic to the stable revision.

## Manual rollback via CircleCI

Trigger the `.circleci/rollback.yml` pipeline from the **Deploys** dashboard. It runs `kubectl argo rollouts abort` followed by `kubectl argo rollouts undo`, then waits for the rollout to return to Healthy.

## Cleanup

```bash
kubectl delete namespace canary-tutorial
```

(Leave `argo-rollouts` and `monitoring` namespaces in place if running other tutorials on the same cluster.)
