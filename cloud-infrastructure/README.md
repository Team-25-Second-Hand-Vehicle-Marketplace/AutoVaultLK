# Cloud Infrastructure

Terraform modules and environment compositions for AWS resources.

## API Gateway

- Module: `terraform/modules/api-gateway/` — public + internal HTTP APIs (SAD sections 3.5.1, 3.5.2)
- Dev environment: `terraform/environments/dev/`
- OpenAPI route catalogue: `../api-gateway/openapi/`

```powershell
cd terraform/environments/dev
terraform init -backend=false
terraform validate
```

Lambda integrations are stubbed; wire ARNs when service handlers are deployed.
