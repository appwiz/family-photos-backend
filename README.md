# family-photos-backend

Backend for sharing family photos — a serverless application on AWS.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full architecture
documentation including a diagram, API specifications, and DynamoDB table design.

### Quick overview

| Service      | Role                                  |
|--------------|---------------------------------------|
| API Gateway  | REST API (POST & GET `/photos`)       |
| Lambda       | Upload and retrieval business logic   |
| S3           | Photo file storage                    |
| DynamoDB     | Photo metadata and tag indexes        |

## Prerequisites

- Python 3.12+
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- An AWS account with credentials configured

## Local development

```bash
# Install test dependencies
pip install -r tests/requirements.txt

# Run unit tests
PYTHONPATH=src python -m pytest tests/ -v
```

## Deploy

```bash
sam build
sam deploy --guided   # first time — creates samconfig.toml
sam deploy            # subsequent deploys
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
