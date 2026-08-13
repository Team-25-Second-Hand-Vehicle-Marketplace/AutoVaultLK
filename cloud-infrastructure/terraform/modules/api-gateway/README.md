# API Gateway Terraform module (scaffold only)

**Status:** scaffold — `terraform apply` does **not** make the API routable in AWS.

## What this module creates

| Resource | Public API | Internal API |
|---|---|---|
| `aws_apigatewayv2_api` | Yes (with CORS from `api-gateway/config/cors.json`) | Yes |
| `aws_apigatewayv2_stage` | Yes | Yes |
| `aws_apigatewayv2_route` | **No** | **No** |
| `aws_apigatewayv2_integration` | **No** | **No** |

After apply you get invoke URLs and API IDs, but **every request returns API Gateway 404** until routes and backend integrations are added.

## What works today

- **Local dev:** `api-gateway/local/nginx.conf` on port **8080** (full path proxy to NestJS services).
- **Contract:** `api-gateway/openapi/public-api.yaml` and `internal-api.yaml` describe intended routes.
- **CI:** `terraform validate` checks HCL structure only.

## Completing AWS routing (later)

1. Deploy service backends (ECS/Lambda/ALB — TBD per service).
2. Uncomment and extend the example in `main.tf`, or import routes from OpenAPI.
3. Populate `public_lambda_integrations` (or replace with VPC Link / HTTP proxy integrations).
4. Add internal east-west routes on the internal API.

See `api-gateway/README.md` for the local route map and prefix rewrite rules.
