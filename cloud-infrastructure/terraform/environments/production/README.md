# Production deployment — full runbook + everything we hit

This is the battle-tested version of the deployment process: every command
that actually worked, plus every real problem we hit and how we fixed it.
Follow this top-to-bottom for a fresh deployment. If you hit the exact same
symptom described in "Known issues," jump straight to that fix instead of
re-diagnosing from scratch.

**Scope:** auth-user-service, marketplace-service, admin-service,
notification-service, web-frontend, plus an **MVP path for
ingestion-service** (two Lambdas — `ingest-api` and `etl-worker` — instead
of the full one-Lambda-per-stage Step Functions design; see the
"ingestion-service" comment block at the top of `main.tf` for what that
means and what it doesn't cover yet).

**Status: the first 4 services + frontend are fully deployed and verified
working**, end to end, as of this writing. All 4 confirmed live through the
public API Gateway:
- `GET /users/me` (auth) → `401 Unauthorized` (correct — no token sent; this
  means cold start + DB connection + routing all worked)
- `GET /marketplace/listings` (marketplace) → real JSON data
- `GET /admin/dashboard` (admin) → `401 Unauthorized` (same meaning as auth)
- notification confirmed via CloudWatch logs — clean bootstrap, DB
  connected, routes mapped (`POST /notifications/events` is its only real
  endpoint; there's no `GET /notifications`)

**ingestion-service's MVP path has not yet been run against a real AWS
account** — it's new in this revision. Follow the same steps below (it's
folded into the same ECR bootstrap / image build / apply flow), but verify
it explicitly once deployed:
```
curl -X POST <public_api_endpoint>/ingest/upload -H "Authorization: Bearer <dealer JWT>" -F csv=@test/fixtures/e2e-mixed.csv
curl <public_api_endpoint>/jobs/<jobId returned above> -H "Authorization: Bearer <dealer JWT>"
```
and watch `aws logs tail /aws/lambda/vehicle-marketplace-etl-worker-production --since 10m`
for the pipeline actually running. If something in this path breaks, it's
uncharted — the "Known issues" section below predates it.

Getting the first 4 services here took 3 more real bugs beyond the ones
documented when this file was first written (Issues 9–11 below) — read
those before assuming a fresh deployment will be issue-free; the fixes are
in the Terraform/code now, but they're worth understanding if something
*else* breaks.

---

## Architecture recap

- **Compute:** one Lambda function per service, running the same
  Lambda-targeted Docker image each service's `Dockerfile` already builds.
  One ECR repo per service.
- **Database:** one RDS Postgres instance (17.11) behind an RDS Proxy, in
  private subnets. Five per-service database roles (mirrors
  `database/docker/init/03-roles.sql`, minus `ingestion_service_role`), with
  Terraform-generated random passwords stored in Secrets Manager.
- **Networking:** one VPC, 2 public + 2 private subnets, one NAT Gateway.
- **API Gateway:** the existing `modules/api-gateway` scaffold, completed —
  public API (auth/users/dealer-profiles/marketplace/admin) and internal API
  (notifications, internal auth calls), routes mirroring
  `api-gateway/local/nginx.conf`'s prefixes exactly.
- **Frontend:** S3 (private) + CloudFront (OAC), SPA routing handled via
  custom error responses.
- **Secrets:** Secrets Manager holds the source-of-truth values (JWT secret,
  internal service key, per-service DB passwords), but each Lambda also gets
  them as plain environment variables — the app code doesn't fetch from
  Secrets Manager at runtime, so this is a deliberate simplification, not an
  oversight. Rotating a secret means a `terraform apply`, not something
  automatic.

---

## Prerequisites

- AWS credentials with admin-equivalent access, in `~/.aws/credentials` /
  `~/.aws/config` (`aws sts get-caller-identity` should succeed).
- Terraform ≥ 1.7 (we used 1.14.3), AWS CLI v2, Docker Desktop, Node/npm.
- A Groq API key and an email address you control (for SES) — put these in a
  git-ignored `production.auto.tfvars`:
  ```hcl
  groq_api_key     = "..."
  ses_sender_email = "you@example.com"
  ```

---

## Step 1 — Remote state bucket

Local state would hold generated secrets in plaintext, so set up a remote
backend first. **This is a one-time setup — skip if the bucket already
exists.**

```
aws s3api create-bucket --bucket vehicle-marketplace-tfstate-<account-id> --region ap-southeast-2 --create-bucket-configuration LocationConstraint=ap-southeast-2
aws s3api put-bucket-versioning --bucket vehicle-marketplace-tfstate-<account-id> --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket vehicle-marketplace-tfstate-<account-id> --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket vehicle-marketplace-tfstate-<account-id> --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

`main.tf`'s `backend "s3"` block already points at this bucket name pattern
with `use_lockfile = true` (Terraform's native S3 locking, TF 1.10+ — no
DynamoDB table needed). Update the bucket name in that block if you're
deploying to a different AWS account.

## Step 2 — Init and sanity-check

```
cd cloud-infrastructure/terraform/environments/production
terraform init
terraform plan
```

## Step 3 — Bootstrap the 6 ECR repos only

Image-based Lambdas can't be created against an empty ECR repo, so create
just the repos first:

```
terraform apply -auto-approve -target=module.auth_lambda.aws_ecr_repository.this -target=module.marketplace_lambda.aws_ecr_repository.this -target=module.admin_lambda.aws_ecr_repository.this -target=module.notification_lambda.aws_ecr_repository.this -target=module.ingest_api_lambda.aws_ecr_repository.this -target=module.etl_worker_lambda.aws_ecr_repository.this
```

Log in to ECR (once — good for all 6 repos, same registry host):

```
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com
```

## Step 4 — Build and push all 6 images

**Use `--no-cache --provenance=false` on every build — both flags matter,
see Issues 2 and 3 below for why.**

```bash
for svc in auth-user-service:auth marketplace-service:marketplace admin-service:admin notification-service:notification ingestion-service:ingest-api; do
  dir="${svc%%:*}"; name="${svc##*:}"
  cd "$dir"
  docker build --no-cache --provenance=false -t <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/vehicle-marketplace/$name-production:latest .
  docker push <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/vehicle-marketplace/$name-production:latest
  cd ..
done

# etl-worker is a different Dockerfile in the same ingestion-service tree
# (different CMD — see the note in production/main.tf) — build it separately.
cd ingestion-service
docker build --no-cache --provenance=false -f docker/etl-worker.Dockerfile -t <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/vehicle-marketplace/etl-worker-production:latest .
docker push <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/vehicle-marketplace/etl-worker-production:latest
cd ..
```

(On Windows cmd.exe, do these individually rather than as a loop — see
"Windows quoting gotchas" below for cmd.exe-specific issues.)

## Step 5 — Full apply

```
terraform apply
```

This creates everything else: VPC, RDS + Proxy, IAM, SES, the 6 Lambdas, the
ingestion SQS queue + DLQ, API Gateway routes, S3+CloudFront. **Expect
10–15 minutes** — RDS and the NAT Gateway are the slow parts. If this fails
partway through with a network error while saving state, see Issue 5 below
**before** retrying.

If a Lambda `CreateFunction` call 409s with `Function already exist` on a
retry, the function actually was created in an earlier attempt but state
didn't record it (same network-drop issue) — `import` it instead of letting
Terraform try to create it again:

```
terraform import module.auth_lambda.aws_lambda_function.this vehicle-marketplace-auth-production
terraform import module.marketplace_lambda.aws_lambda_function.this vehicle-marketplace-marketplace-production
terraform import module.admin_lambda.aws_lambda_function.this vehicle-marketplace-admin-production
terraform import module.notification_lambda.aws_lambda_function.this vehicle-marketplace-notification-production
terraform import module.ingest_api_lambda.aws_lambda_function.this vehicle-marketplace-ingest-api-production
terraform import module.etl_worker_lambda.aws_lambda_function.this vehicle-marketplace-etl-worker-production
```

## Step 6 — One-time database setup

RDS is in a private subnet with `publicly_accessible = false`, so nothing
outside the VPC can reach it directly. **Don't flip `publicly-accessible` to
try to work around this** — the DB's subnet group only has private subnets,
so that flag doesn't actually make it reachable anyway (see Issue 4). Use a
temporary bastion instead:

### 6a. Launch a temporary SSH bastion

```
aws ec2 create-key-pair --key-name db-bootstrap-key --query "KeyMaterial" --output text > db-bootstrap-key.pem
icacls db-bootstrap-key.pem /inheritance:r
icacls db-bootstrap-key.pem /grant:r "%username%:R"

aws ec2 create-security-group --group-name db-bootstrap-ssh --description "Temporary SSH for DB bootstrap" --vpc-id <vpc-id>
aws ec2 authorize-security-group-ingress --group-id <new-sg-id> --protocol tcp --port 22 --cidr <your-ip>/32

aws ec2 describe-subnets --filters "Name=vpc-id,Values=<vpc-id>" "Name=map-public-ip-on-launch,Values=true" --query "Subnets[0].SubnetId" --output text
aws ssm get-parameters --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --region ap-southeast-2 --query "Parameters[0].Value" --output text

aws ec2 run-instances --image-id <ami-id> --instance-type t3.micro --subnet-id <public-subnet-id> --security-group-ids <lambda-sg-id> <new-ssh-sg-id> --key-name db-bootstrap-key --associate-public-ip-address --region ap-southeast-2 --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=db-bootstrap-ssh}]"
```

**Give the bastion the "lambda" security group too** (`terraform output
lambda_security_group_id`) — the database SG's ingress rule only allows
connections from that SG, so the bastion needs to be a member of it.

We tried an SSM-Session-Manager-only bastion first (no key pair, no open
ports) and it never registered with SSM after 15+ minutes, with completely
empty console output — something in this account/region blocks it, never
root-caused. **SSH is the reliable path; don't bother with SSM first.**

### 6b. Connect and create the roles

```
ssh -i db-bootstrap-key.pem ec2-user@<bastion-public-ip>
sudo dnf install -y postgresql15
export PGPASSWORD='<master-password-with-special-chars-safe-in-single-quotes>'
psql "host=<rds-instance-endpoint> port=5432 user=<master-username> dbname=vehicle_marketplace sslmode=require"
```

Get the master credentials first: `aws secretsmanager get-secret-value
--secret-id <database_master_secret_arn output> --query SecretString
--output text`.

**Use the direct instance endpoint, not the proxy, for this** — until Issue
6 is fixed the proxy can't reach the instance at all, and even after the fix
there's no reason to route one-time admin SQL through the proxy.

**`sslmode=require` is mandatory** — RDS refuses plaintext connections
(`rds.force_ssl` is on by default), and the failure mode without it is a
confusing "server closed the connection unexpectedly" with no clear reason,
not a helpful auth error (see Issue 7).

Once connected, get the 5 generated passwords (`terraform output -json
db_service_role_passwords`) and run:

```sql
CREATE ROLE auth_service_role         LOGIN PASSWORD '<auth password>';
CREATE ROLE marketplace_service_role  LOGIN PASSWORD '<marketplace password>';
CREATE ROLE notification_service_role LOGIN PASSWORD '<notification password>';
CREATE ROLE admin_service_role        LOGIN PASSWORD '<admin password>';
CREATE ROLE ingestion_service_role    LOGIN PASSWORD '<ingestion password>';
GRANT CONNECT ON DATABASE vehicle_marketplace TO
  auth_service_role, marketplace_service_role,
  notification_service_role, admin_service_role, ingestion_service_role;
```

### 6c. Run migrations and grants

In a **second** terminal window, tunnel through the same bastion to the
direct instance endpoint:

```
ssh -i db-bootstrap-key.pem -L 15432:<rds-instance-endpoint>:5432 ec2-user@<bastion-public-ip>
```

Leave that running. In a **third** window:

```
cd database
set DATABASE_URL=postgresql://<master_user>:<master_password_percent_encoded>@localhost:15432/vehicle_marketplace
set DATABASE_SSL=true
npm run migration:run
```

**Percent-encode special characters in the password** if building a URI by
hand — an unescaped `<` (or similar) breaks both cmd.exe parsing and strict
URI parsing. `<` → `%3C`, etc. `DATABASE_SSL=true` is required too —
`data-source.ts` only enables TLS when that's set (see Issue 7 again; it's
easy to fix the connection string and still forget this one).

Then grants — safe to run unmodified:

```
docker run --rm -i --add-host=host.docker.internal:host-gateway postgres:17 psql "postgresql://<master_user>:<master_password_percent_encoded>@host.docker.internal:15432/vehicle_marketplace?sslmode=require" < src\grants.sql
```

If `ingestion_service_role` was created in step 6b above, every grant in
`grants.sql` (including the ingestion ones — cross-schema read on
`auth.dealer_profiles`/`auth.users`, and the one documented cross-schema
write exception onto `marketplace.vehicles`/`marketplace.vehicle_images`,
per ADR-002) now applies cleanly. If you skipped creating that role, you'll
see `role "ingestion_service_role" does not exist` errors scroll by instead
— psql doesn't stop on error when run this way, so every other grant still
applies, but the ingestion Lambdas won't be able to connect until you go
back and create the role.

### 6d. Clean up the bastion

```
aws ec2 terminate-instances --instance-ids <bastion-instance-id>
aws ec2 delete-security-group --group-id <new-ssh-sg-id>
```
(wait for termination first) and delete `db-bootstrap-key.pem` locally —
it's already `*.pem`-gitignored, but there's no reason to keep it once done.

## Step 7 — Deploy the frontend

```
cd web-frontend
set VITE_API_BASE_URL=<public_api_endpoint output>
npm run build
aws s3 sync dist/ s3://<frontend_bucket_name output>/ --delete
aws cloudfront create-invalidation --distribution-id <frontend_distribution_id output> --paths "/*"
```

## Step 8 — Verify

**There is no bare `/health` route reachable through the public API** — each
service's `HealthController` mounts at plain `/health` with no prefix, and
`modules/api-gateway` only wires the `/auth`, `/users`, `/dealer-profiles`,
`/marketplace`, `/admin` prefixes, not bare `/health`. Test a route that
actually exists instead:

```
curl <public_api_endpoint output>/users/me       # auth — expect 401 Unauthorized (success: means it's reachable, DB connected, JWT guard ran)
curl <public_api_endpoint output>/marketplace/listings   # marketplace — expect real JSON, e.g. {"message":"...","data":[]}
curl <public_api_endpoint output>/admin/dashboard        # admin — expect 401 Unauthorized, same meaning as auth
```

A `401` from auth/admin is success here, not a failure — it means the
Lambda cold-started, connected to the database (that happens at NestJS
bootstrap, before any route runs), and the router matched correctly; it's
just refusing an unauthenticated request as designed. notification-service
has no public route at all — check it via CloudWatch instead:
```
aws logs tail /aws/lambda/vehicle-marketplace-notification-production --since 10m
```
Look for `Nest application successfully started` with no `TypeOrmModule`
errors above it, and `Mapped {/notifications/events, POST} route` — that
confirms it's healthy without needing a request. (There's no `GET
/notifications` route — don't test that path, it's a legitimate 404.)

If any of the above returns `{"message":"Internal Server Error"}` or
`Service Unavailable`, check that service's own Lambda logs before guessing
further:
```
aws logs tail /aws/lambda/vehicle-marketplace-<service>-production --since 10m
```
This is how Issues 2, 3, 6, and 9 were all actually found — the error
message returned over HTTP is generic by design (NestJS's default exception
filter), but the Lambda's own log always has the real exception.

## Step 9 — CI/CD (manual-trigger deploys from GitHub Actions)

`modules/github-oidc` sets up an IAM role GitHub Actions can assume via
OIDC — no long-lived AWS keys stored in GitHub. `.github/workflows/
deploy-production.yml` uses it to build+push+update all 6 Lambdas (auth,
marketplace, admin, notification, ingest-api, etl-worker) and the frontend.
**It only runs on `workflow_dispatch`** (Actions tab → "Deploy to
production" → Run workflow) — deliberately no `push`/`pull_request`
trigger, since this environment gets torn down between sessions and an
auto-deploy pipeline would just fail every run while it's down.

After `terraform apply` (this module applies alongside everything else, no
separate step), get the role ARN:
```
terraform output github_deploy_role_arn
```

Then set these as **repository variables** (Settings → Secrets and
variables → Actions → Variables tab — not Secrets; none of these are
secret, OIDC is what keeps this safe) on the GitHub repo:

| Variable | Value |
|---|---|
| `AWS_ACCOUNT_ID` | `287761904540` (or your account) |
| `AWS_DEPLOY_ROLE_ARN` | the `github_deploy_role_arn` output |
| `PUBLIC_API_ENDPOINT` | `terraform output public_api_endpoint` |
| `FRONTEND_BUCKET_NAME` | `terraform output frontend_bucket_name` |
| `FRONTEND_DISTRIBUTION_ID` | `terraform output frontend_distribution_id` |

The trust policy only allows `workflow_dispatch` runs from this repo's
`main` branch (`repo:<org>/<repo>:ref:refs/heads/main` — see
`modules/github-oidc/main.tf` if you need to broaden that, e.g. to allow
deploys from a branch).

**If this AWS account already has a GitHub OIDC provider** from another
project (AWS allows only one per account for
`token.actions.githubusercontent.com`), set `create_github_oidc_provider =
false` in `production.auto.tfvars` and Terraform will reuse the existing
one instead of trying to create a duplicate (which errors).

**After a `terraform destroy` + fresh redeploy**, the account ID, role ARN,
and all 3 other values above change — update the repository variables again
before the next manual trigger, or it'll deploy against stale/nonexistent
resources.

---

## Known issues and fixes (all encountered on the first real deployment)

### Issue 1 — `AWS_REGION` is a reserved Lambda env var
Setting it yourself 400s `CreateFunction` with
`InvalidParameterValueException`. **Already fixed in `main.tf`** — don't add
it back to `common_env`. Every Lambda can still read
`process.env.AWS_REGION`; AWS sets it automatically.

### Issue 2 — Lambda rejects the image: "manifest ... not supported"
Recent Docker Desktop builds attach provenance/attestation manifests by
default, producing a multi-manifest image index Lambda doesn't support.
**Fix:** always build with `--provenance=false`.

### Issue 3 — Missing `node_modules` package at runtime despite a clean-looking build
We hit `Cannot find module '@codegenie/serverless-express'` at Lambda
cold-start, even though the build log showed no errors. Root cause: an
earlier build had genuinely corrupted midway (Docker Desktop disk I/O errors
— see Issue 8), and Docker's layer cache silently kept reusing that broken
`npm ci` layer in every subsequent build, because the layer's cache key
(same `package*.json`) never changed. The build always *looked* successful.
**Fix:** `--no-cache` on every build until you're confident the cache is
clean; if you see a suspiciously fast `npm ci` step (well under a second),
that's the tell.

### Issue 4 — Trying to make RDS temporarily public doesn't work
We flipped `publicly-accessible` to `true` and opened the security group,
expecting to connect directly for the one-time bootstrap. It still refused
every connection. Root cause: the DB subnet group only contains private
subnets (no route to an Internet Gateway) — `publicly-accessible` only
matters if the subnets themselves can route to the internet. **Don't bother
with this path; use the SSH bastion (Step 6) instead.** We reverted the
public-access change afterward:
```
aws rds modify-db-instance --db-instance-identifier vehicle-marketplace-db-production --no-publicly-accessible --apply-immediately
aws ec2 revoke-security-group-ingress --group-id <db-sg-id> --protocol tcp --port 5432 --cidr <your-ip>/32
```

### Issue 5 — DNS drops mid-`apply`, corrupting the lock/state handoff
Twice during long applies (RDS creation, Lambda creation), our network had a
transient DNS resolution failure exactly while Terraform tried to persist
state to S3. Terraform writes an `errored.tfstate` locally and the lock
doesn't release cleanly. **Recovery, in order:**
1. `terraform plan` — if it errors with `Error acquiring the state lock`, note the `ID` and run `terraform force-unlock <ID>`.
2. `terraform state push errored.tfstate` — **but check first**: if this refuses with `cannot import state with serial N over newer state with serial M` where M > N, the remote state is already ahead (the actual PUT likely succeeded on an internal retry before the connection dropped again on lock release) — **don't force it**, just skip to step 3.
3. `terraform plan` again to confirm you're back to the expected pending-resource count before applying.

If a Lambda 409s with `Function already exist` after this, see the `import`
commands in Step 5 above.

### Issue 6 — RDS Proxy target permanently `UNAVAILABLE` ("internal error")
This was the big one. The proxy's target health never passed, with a
generic, unhelpful `"DBProxy Target unavailable due to an internal error"`.
We tried: waiting, deregister+reregister (got a more specific but still
stuck `PENDING_PROXY_CAPACITY`), and a full destroy+recreate of the proxy
(`terraform apply -replace=module.database.aws_db_proxy.this`) — none of it
actually fixed the root cause, just masked it temporarily or not at all.

**Root cause:** the RDS Proxy's own network interfaces sit in the *same*
security group as the database instance (by design, for simplicity). That
security group's only ingress rule allowed traffic *from the Lambda security
group* — it never allowed traffic from **itself**. Since the proxy's ENIs
are members of that same "database" SG, and members of a SG aren't
automatically allowed to talk to each other, **the proxy was never able to
open a connection to the database at all**, on any attempt, from the very
first deployment. AWS's health-check error message never once hinted this
was a security-group problem.

**Fix — already applied in `modules/networking/main.tf`:** a self-referencing
ingress rule on the database security group:
```hcl
ingress {
  from_port = 5432
  to_port   = 5432
  protocol  = "tcp"
  self      = true
}
```
**Do not also touch the security group's `description` field in the same
change** — AWS treats a security group's `description` as immutable, so any
edit to it forces a full destroy-and-recreate, which then fails outright
because Terraform doesn't have permission to detach the RDS-owned ENIs
attached to it. We hit this directly: changing the description alongside
the real fix caused `AuthFailure: You do not have permission to access the
specified resource` mid-destroy. Only change the `ingress`/`egress` blocks
on an in-use security group; leave `name`/`description` alone.

After applying just the ingress addition (a safe in-place update), give the
proxy's next health-check cycle a couple of minutes, then check:
```
aws rds describe-db-proxy-targets --db-proxy-name vehicle-marketplace-proxy-production
```
Waiting for `"State": "AVAILABLE"`.

### Issue 7 — Postgres connections silently refused without SSL
Two distinct symptoms, same underlying cause (RDS enforces `rds.force_ssl`):
- Direct `psql` without `sslmode=require`: clear error, `no pg_hba.conf
  entry for host ..., no encryption` — helpful.
- Through the RDS Proxy, even *with* `sslmode=require` client-side: just
  "server closed the connection unexpectedly" — **not** helpful, and this
  turned out to be Issue 6 (the SG bug) rather than an SSL problem at all.
  Don't over-index on the proxy's vague error text; test the direct instance
  endpoint first to isolate SSL/auth issues from proxy-specific ones.
- For the Node/TypeORM migration runner specifically: `DATABASE_URL` alone
  isn't enough — `database/src/data-source.ts` only turns on TLS when
  `DATABASE_SSL=true` is *also* set as a separate env var.

### Issue 8 — Docker Desktop disk I/O corruption mid-build
Symptom: `npm ci` fails with `EIO: i/o error` / `TAR_ENTRY_ERROR`, or `docker
push` fails with `write ... input/output error` on Docker Desktop's own
containerd metadata database. Not a problem with the Dockerfile or npm —
Docker Desktop's own virtual disk got corrupted (possibly related to low
host disk space, though we still saw one recurrence with 12 GB free).
**Fix:**
1. Check host disk space (`Get-PSDrive C` in PowerShell).
2. Quit Docker Desktop, run `wsl --shutdown` (as Administrator), reopen
   Docker Desktop, wait for the whale icon to go fully steady.
3. Retry the build.
4. If it still fails the same way, Docker Desktop → Settings →
   Troubleshoot → Clean/Purge data (safe — just re-pulls base images).

This is also the root cause behind Issue 3 — a corrupted build that *looked*
successful got cached and silently propagated through later builds.

### Issue 9 — RDS Proxy connects, but every service role gets rejected
After Issue 6's fix, the proxy target went `AVAILABLE`, but every Lambda's
TypeORM connection then failed with a *different*, much more specific error:
`This RDS proxy has no credentials for the role auth_service_role. Check
the credentials for this role and try again.`

**Root cause:** `modules/database`'s `aws_db_proxy` only ever had **one**
`auth` block, pointing at the RDS-managed master user's secret. The proxy
has no other way to know a role like `auth_service_role` exists — it can
only authenticate as roles it has an explicit auth block + matching secret
for. On top of that, the per-service secrets `modules/secrets` created held
a bare password string, but RDS Proxy's `SECRETS` auth scheme requires the
secret's content to be `{"username": "...", "password": "..."}` JSON — it
reads the *role to authenticate as* from that JSON, not from anywhere else.

**Fix — already applied:**
1. `modules/secrets`: each per-service secret now stores
   `jsonencode({ username = "<role>", password = <generated> })` instead of
   a bare string. (Lambda env vars are unaffected — those read
   `random_password.db[...].result` directly, not the secret's content.)
2. `modules/database`: a `dynamic "auth"` block on `aws_db_proxy.this`,
   one per entry in a new `db_service_role_secret_arns` variable, alongside
   the existing master-user auth block. The proxy's own IAM role also needed
   `secretsmanager:GetSecretValue` on these 4 new secrets, not just the
   master's.
3. `environments/production/main.tf` passes
   `module.secrets.db_service_role_arns` into the database module.

This is a normal in-place update (new secret versions, new auth blocks on
an existing proxy) — it does not replace anything.

### Issue 10 — Every request 404s with the API Gateway **stage name** in the path
After Issue 9's fix, the database connected fine, but every request 404'd
inside the NestJS app itself, e.g. `Cannot GET /production/auth/health` —
note the `/production/` that was never part of any real route.

**Root cause:** AWS API Gateway HTTP APIs (v2) prepend a **named** stage's
name to the path forwarded to a Lambda-proxy integration (`event.rawPath`) —
e.g. hitting `.../production/auth/login` sends `/production/auth/login` to
the Lambda, not `/auth/login`. This is different from REST APIs (v1) and
easy to miss since `modules/api-gateway`'s stages were named after
`var.environment` ("production"), which looked completely reasonable.

**Fix — already applied:** both stages (`modules/api-gateway/main.tf`) use
the special stage name `$default`, which adds no path prefix at all.
**This forces a stage replacement** (`name` is immutable) — safe on its own
(nothing else attaches to a "stage"), but it changes the invoke URL shape
(`.../production/...` → `.../...`), which cascades to every Lambda's env
vars that reference `public_api_endpoint`/`internal_api_endpoint` (a normal
in-place update) **and** means the frontend needs a full rebuild + redeploy
(`VITE_API_BASE_URL` is baked in at build time, not runtime-configurable) —
don't skip that step or the deployed frontend will call stale URLs.

### Issue 11 — marketplace-service still 404s after Issue 10's fix
Every other service worked after Issue 10, but
`GET /marketplace/listings` still 404'd with `Cannot GET /marketplace/
listings`.

**Root cause:** unlike auth/admin/notification, marketplace-service's own
routes never include a `/marketplace` prefix locally either — nginx's
`location /marketplace/` **strips** it before forwarding (see
`api-gateway/local/nginx.conf`'s comments), so the app's own controllers are
mounted at e.g. `@Controller('listings')`, not `@Controller('marketplace/
listings')`. AWS API Gateway's `AWS_PROXY` (Lambda-proxy) integration type
has **no** path-rewrite capability — unlike an `HTTP_PROXY` integration,
there's no request-parameter mapping available, so whatever path hit the
gateway is exactly what the Lambda receives, prefix and all.

**Fix — already applied in `marketplace-service/src/lambda/marketplace-api.ts`:**
the handler strips a leading `/marketplace` off `event.rawPath` (and
`event.requestContext.http.path`) before handing the event to
`serverless-express`, replicating exactly what nginx does locally. This is
application code, not Terraform — if `marketplace-api.ts` gets rewritten
later, this stripping needs to move with it. **No other service needs
this** — auth/admin/notification all preserve their own prefix already,
matching nginx's behavior for them.

### Provider bug — "inconsistent final plan" on `.publish`
After the proxy replacement in Issue 6's investigation, `terraform apply`
threw `Provider produced inconsistent final plan ... invalid new value for
.publish` for all 4 Lambda functions — Terraform explicitly says this is a
provider bug, not a config problem. **Fix: just retry `terraform apply`**
(no flags) once the resource that was being replaced has actually finished —
mixing a `-replace` target with dependent resources' computed-value
expansion in the same apply seems to trigger it.

---

## Windows quoting gotchas

- `docker login`/`ec2 authorize-security-group-ingress` etc.: never type
  `<placeholder>` literally with angle brackets — in cmd.exe, `<` means
  "read input from this file" and breaks the command with confusing
  "system cannot find the file" errors.
- Passwords containing `<`, `>`, `&`, `|` etc.: percent-encode them in
  connection URIs (`<` → `%3C`) rather than fighting shell quoting.
- `terraform force-unlock` needs the exact Lock `ID` from the error message,
  and requires typing `yes` to confirm.

---

## Cleanup checklist (temporary resources from this process)

- [ ] Bastion EC2 instance(s) — `aws ec2 terminate-instances`
- [ ] Temporary SSH security group — `aws ec2 delete-security-group`
- [ ] `db-bootstrap-key.pem` — delete locally, it's gitignored but still a
      live credential while it exists
- [ ] If an SSM-based bastion attempt was made and abandoned (see Issue 6's
      note): its IAM role/instance profile
      (`vehicle-marketplace-ssm-bootstrap`) and the instance itself
- [ ] Confirm `publicly-accessible` is `false` on the RDS instance and the
      temporary `111.x.x.x/32`-style ingress rule is removed from the
      database security group (Issue 4)
