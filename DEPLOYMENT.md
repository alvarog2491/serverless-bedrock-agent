# Deployment Guide

This guide covers how to deploy the Enterprise Bedrock Agent both locally and via CI/CD.

## 1. Local Development Deployment

To deploy the agent to your AWS account for development purposes:

### CD Deployment
1. **Bootstrap your environment** (if it's the first time):
   ```bash
   npx cdk bootstrap
   ```

2. **Deploy to Dev**:
   ```bash
   npx cdk deploy --all -c env=dev
   ```


---

## 2. Local Pipeline Testing with `act`

You can test the GitHub Actions pipeline locally using [act](https://github.com/nektos/act). This allows you to verify the deployment logic without pushing to GitHub.

### Prerequisites
- Install `act`
- Ensure Docker is running

### Run Staging Pipeline Locally
1. Ensure your `.secrets.staging` file is configured with valid AWS credentials.
2. Run the staging job:
   ```bash
   act push -j deploy-staging --secret-file .secrets.staging --bind
   ```

### Run Production Pipeline Locally
1. Ensure your `.secrets.prod` file is configured with valid AWS credentials.
2. Run the production job:
   ```bash
   act push -j deploy-production --secret-file .secrets.prod --bind
   ```

*Note: In local mode (`act`), the scripts use the static credentials provided in the `.secrets` files instead of assuming cross-account IAM roles.*

---

## 3. CI/CD Pipeline (GitHub Actions)

The project includes a multi-stage pipeline defined in `.github/workflows/deploy.yml`.

### Workflow Overview:
1. **Push to `main`**: Any push to the `main` branch triggers the pipeline.
2. **Deploy to Staging**:
    - Provisions all stacks in the **Staging** environment.
    - Synchronizes documentation from `./data` to the Knowledge Base S3 bucket.
    - Runs **Unit Tests** for the Lambda functions.
    - Executes a **DeepEval Evaluation** task in ECS Fargate.
3. **Quality Gate**:
    - The pipeline executes `scripts/check_eval_results.py`.
    - If the average DeepEval score is below **predefined thresholds**, the pipeline fails and does not proceed to production.
4. **Deploy to Production**:
    - Requires successful completion of the staging stage.
    - **Manual Approval**: If the GitHub Environment `production` is configured with protection rules, a reviewer must approve the deployment in the GitHub Actions tab.
    - Provisions all stacks in the **Production** environment.

### Environment Management
- **Staging**: Uses environment context `env=staging`.
- **Production**: Uses environment context `env=prod`.

Configs for these environments are managed in the `config/` directory.
