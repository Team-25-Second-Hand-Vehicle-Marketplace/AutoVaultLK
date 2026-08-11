# Cloud Infrastructure

Terraform modules and environment compositions for AWS resources.

## API Gateway

- Module: `terraform/modules/api-gateway/` — **scaffold only** (see module README)
- Dev environment: `terraform/environments/dev/`
- OpenAPI route catalogue: `../api-gateway/openapi/`

### Scaffold scope (important)

`terraform apply` currently provisions **HTTP APIs and stages only**. It does **not** create routes or integrations, so **traffic does not work in AWS** yet — invoke URLs will return API Gateway 404.

| Layer | Status |
|---|---|
| AWS API Gateway (Terraform) | APIs + stages + CORS scaffold |
| Local nginx (`api-gateway/local/nginx.conf`) | **Working** path proxy for development |
| OpenAPI specs | Route catalogue for future AWS import |

```powershell
cd terraform/environments/dev
terraform init -backend=false
terraform validate
```

Wire backend integrations and routes when service handlers are deployed to AWS.
