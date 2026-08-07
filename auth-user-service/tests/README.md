# Auth User Service Testing Guide

This guide explains how to build and run the Lambda container locally and test every current auth-user endpoint from PowerShell.

## 1. Start PostgreSQL

From the repository root:

```powershell
cd "C:\Users\user\New folder\cloud-native-marketplace-org"
docker compose up -d postgres
```

Run database migrations from the `database` folder:

```powershell
cd "C:\Users\user\New folder\cloud-native-marketplace-org\database"
npm run migration:run
```

## 2. Build the Lambda image

Open Command Prompt or PowerShell and move to the auth service:

```powershell
cd "C:\Users\user\New folder\cloud-native-marketplace-org\auth-user-service"
docker build -t auth-user-service:local .
```

## 3. Run the Lambda container

The Docker image uses the AWS Lambda runtime. It listens through port `8080` inside the container and is exposed as port `9000` on the host.

```powershell
docker run -d --rm `
  --name auth-user-service-lambda `
  -p 9000:8080 `
  --env-file ..\.env `
  -e AUTH_DATABASE_URL="postgresql://auth_service_role:dev_auth@host.docker.internal:5433/vehicle_marketplace" `
  auth-user-service:local
```

If using Command Prompt instead of PowerShell, run it as one line:

```cmd
docker run -d --rm --name auth-user-service-lambda -p 9000:8080 --env-file ..\.env -e AUTH_DATABASE_URL="postgresql://auth_service_role:dev_auth@host.docker.internal:5433/vehicle_marketplace" auth-user-service:local
```

Check the container:

```powershell
docker ps
docker logs auth-user-service-lambda
```

Stop it when finished:

```powershell
docker stop auth-user-service-lambda
```

## 4. PowerShell Lambda helper

The Lambda runtime invocation endpoint is:

```text
http://localhost:9000/2015-03-31/functions/function/invocations
```

Run this helper once in PowerShell:

```powershell
function Invoke-AuthLambda {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Body = $null
    )

    $event = @{
        version = "2.0"
        routeKey = "$Method $Path"
        rawPath = $Path
        rawQueryString = ""
        headers = @{
            "content-type" = "application/json"
            "host" = "localhost"
        }
        requestContext = @{
            http = @{
                method = $Method
                path = $Path
                protocol = "HTTP/1.1"
                sourceIp = "127.0.0.1"
                userAgent = "PowerShell"
            }
        }
        isBase64Encoded = $false
    }

    if ($null -ne $Body) {
        $event.body = $Body | ConvertTo-Json -Depth 10 -Compress
    }

    $payload = $event | ConvertTo-Json -Depth 10 -Compress

    $response = Invoke-RestMethod `
        -Method Post `
        -Uri "http://localhost:9000/2015-03-31/functions/function/invocations" `
        -ContentType "application/json" `
        -Body $payload

    if ($response.body) {
        return $response.body | ConvertFrom-Json
    }

    return $response
}
```

## 5. Test endpoints

### Health check

```powershell
Invoke-AuthLambda -Method GET -Path "/health"
```

Expected response:

```json
{
  "status": "ok",
  "service": "auth-user-service"
}
```

### Buyer registration

```powershell
$buyerEmail = "buyer-$([guid]::NewGuid().ToString('N').Substring(0,8))@example.com"

$buyer = Invoke-AuthLambda -Method POST -Path "/auth/register/buyer" -Body @{
    email = $buyerEmail
    password = "Password123!"
    name = "Test Buyer"
}

$buyer | ConvertTo-Json -Depth 10
```

### Dealer registration

```powershell
$dealerEmail = "dealer-$([guid]::NewGuid().ToString('N').Substring(0,8))@example.com"

$dealer = Invoke-AuthLambda -Method POST -Path "/auth/register/dealer" -Body @{
    email = $dealerEmail
    password = "Password123!"
    name = "Test Dealer"
    dealerType = "business"
    businessRegistrationNumber = "BR-001"
    businessAddress = "1 Main Street"
    city = "Colombo"
    verificationDocuments = @{
        registration = "document-key"
    }
    companyName = "Test Motors"
    contactNumber = "+94110000000"
}

$dealer | ConvertTo-Json -Depth 10
```

### Buyer or dealer login

```powershell
$login = Invoke-AuthLambda -Method POST -Path "/auth/login" -Body @{
    email = $buyerEmail
    password = "Password123!"
}

$login | ConvertTo-Json -Depth 10
$accessToken = $login.accessToken
$refreshToken = $login.refreshToken
```

Admin accounts cannot be registered publicly and must already exist in the database.

### Admin login

```powershell
$adminLogin = Invoke-AuthLambda -Method POST -Path "/auth/login/admin" -Body @{
    email = "admin@test.com"
    password = "AdminPassword123!"
}

$adminLogin | ConvertTo-Json -Depth 10
```

### Refresh token

```powershell
$refreshed = Invoke-AuthLambda -Method POST -Path "/auth/refresh" -Body @{
    refreshToken = $refreshToken
}

$refreshed | ConvertTo-Json -Depth 10
$newRefreshToken = $refreshed.refreshToken
```

The old refresh token is revoked after successful rotation.

### Logout

```powershell
Invoke-AuthLambda -Method POST -Path "/auth/logout" -Body @{
    refreshToken = $newRefreshToken
}
```

### List users

```powershell
Invoke-AuthLambda -Method GET -Path "/users"
```

### Get a specific user

```powershell
Invoke-AuthLambda -Method GET -Path "/users/$($buyer.user.id)"
```

### List dealer profiles

```powershell
Invoke-AuthLambda -Method GET -Path "/dealer-profiles"
```

### Get a dealer profile

```powershell
Invoke-AuthLambda -Method GET -Path "/dealer-profiles/$($dealer.user.id)"
```

## 6. Run automated tests

From `auth-user-service`:

```powershell
npm run test:ci
npm run build
```

The repository tests use mocked TypeORM repositories and do not require a live database. The API commands above test the complete Lambda, NestJS, database, and authentication flow.
