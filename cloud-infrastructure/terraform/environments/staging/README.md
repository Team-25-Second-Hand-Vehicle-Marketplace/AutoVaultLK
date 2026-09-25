# Staging deployment

Follows exactly the same runbook as
[`environments/production/README.md`](../production/README.md) — the module
graph in `main.tf` is a 1:1 mirror of production's, with `var.environment =
"staging"` doing all the naming/isolation work (every resource name
interpolates it, so nothing collides with production's copies).

Differences from production, worth knowing before you start:

- **Remote state**: same tfstate bucket, different key
  (`staging/terraform.tfstate`) — Step 1 of the production README ("create
  the bucket") is a one-time, account-wide setup; skip it if you already did
  it for production.
- **tfvars file**: use a git-ignored `staging.auto.tfvars` in this directory
  (same shape as production's — `groq_api_key` required, `ses_sender_email`
  or `ses_domain_name` for SES).
- **GitHub OIDC**: staging does **not** create its own OIDC provider — AWS
  allows only one per provider URL per account, and production already made
  one. `main.tf` looks it up with a `data "aws_iam_openid_connect_provider"`
  block instead. If you're deploying staging to a *different* AWS account
  than production, set `create_github_oidc_provider = true` in
  `staging.auto.tfvars` first.
- **Everything else** — RDS sizing, Lambda memory/timeout, the ingestion
  SQS+DLQ, the monitoring module, the notification retry sweep — is
  identical to production. If you want a cheaper staging environment later,
  the knobs to override are `modules/database`'s `instance_class`/
  `allocated_storage` variables and each Lambda module's `memory_size`.

To deploy: `cd` here instead of `environments/production` and follow the
production README's Steps 1–9 verbatim, substituting `staging` wherever it
says `production`.
