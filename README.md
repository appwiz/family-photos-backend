# family-photos-backend

Serverless backend for sharing family photos — AWS CDK + TypeScript.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full architecture
documentation including a diagram, API specifications, and DynamoDB table design.

See [SPEC.md](SPEC.md) for constraints and design decisions.

### Quick overview

| Service      | Role                                  |
|--------------|---------------------------------------|
| API Gateway  | REST API (POST & GET `/photos`)       |
| Lambda       | Upload and retrieval business logic   |
| S3           | Photo file storage                    |
| DynamoDB     | Photo metadata and tag indexes        |

## Prerequisites

- Node.js 20+
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/cli.html) (`npm install -g aws-cdk`)
- An AWS account with credentials configured

## Local development

```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Type-check
npm run build
```

## Deploy

```bash
cdk bootstrap   # first time only
cdk deploy
```

## API usage

### Upload a photo

```bash
curl -X POST https://<api-id>.execute-api.<region>.amazonaws.com/prod/photos \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "beach.jpg",
    "contentType": "image/jpeg",
    "tags": ["vacation", "beach"],
    "imageData": "<base64-encoded image>"
  }'
```

### Retrieve photos

```bash
# All photos
curl https://<api-id>.execute-api.<region>.amazonaws.com/prod/photos

# Filter by tag
curl "https://<api-id>.execute-api.<region>.amazonaws.com/prod/photos?tag=vacation"

# With pagination
curl "https://<api-id>.execute-api.<region>.amazonaws.com/prod/photos?limit=10&nextToken=..."
```
