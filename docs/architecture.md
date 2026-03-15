# Family Photos Backend — Architecture

## Overview

The Family Photos Backend is a serverless application hosted on AWS that provides
APIs for uploading, storing, and retrieving family photos. Photos are indexed by
tags and timestamps so that viewers can browse them randomly or filter by tag.

## Architecture Diagram

```
                         ┌──────────────────────────────┐
                         │          Clients              │
                         │  (Mobile App / Web Browser)   │
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │      Amazon API Gateway       │
                         │         (REST API)            │
                         │                               │
                         │  POST /photos    GET /photos  │
                         └──────┬───────────────┬───────┘
                                │               │
                     ┌──────────▼──┐     ┌──────▼──────────┐
                     │  Upload     │     │  Get Photos      │
                     │  Photo      │     │  Lambda           │
                     │  Lambda     │     │                   │
                     └──┬─────┬───┘     └──────┬───────────┘
                        │     │                │
               ┌────────▼┐  ┌─▼────────┐  ┌───▼──────────┐
               │  Amazon  │  │ Amazon   │  │   Amazon     │
               │   S3     │  │ DynamoDB │  │  DynamoDB    │
               │ (photos) │  │(metadata)│  │  (query by   │
               │          │  │          │  │   tag/time)  │
               └──────────┘  └──────────┘  └──────┬───────┘
                                                   │
                                              ┌────▼───────┐
                                              │  Amazon S3  │
                                              │ (presigned  │
                                              │   URLs)     │
                                              └────────────┘
```

## AWS Services

| Service          | Purpose                                                  |
|------------------|----------------------------------------------------------|
| API Gateway      | REST API entry point; routes requests to Lambda functions |
| Lambda           | Serverless compute for upload and retrieval logic         |
| S3               | Object storage for photo files                           |
| DynamoDB         | NoSQL metadata store for photo records and tag indexes    |

## API Endpoints

### POST /photos — Upload a Photo

Upload a base64-encoded photo along with metadata.

**Request body** (JSON):
```json
{
  "filename": "vacation.jpg",
  "contentType": "image/jpeg",
  "tags": ["vacation", "beach", "2024"],
  "imageData": "<base64-encoded image>"
}
```

**Response** (`201 Created`):
```json
{
  "photoId": "a1b2c3d4-...",
  "uploadTimestamp": "2024-01-15T10:30:00Z",
  "tags": ["vacation", "beach", "2024"]
}
```

### GET /photos — Retrieve Photos

Retrieve photos with optional tag filters. Returns metadata and presigned S3
URLs for downloading the actual image files.

**Query parameters** (all optional):

| Parameter | Description                                        |
|-----------|----------------------------------------------------|
| `tag`     | Filter by tag (returns only photos with this tag)  |
| `limit`   | Max number of results (default 20, max 100)        |
| `nextToken` | Pagination token from a previous response        |

**Response** (`200 OK`):
```json
{
  "photos": [
    {
      "photoId": "a1b2c3d4-...",
      "filename": "vacation.jpg",
      "tags": ["vacation", "beach", "2024"],
      "uploadTimestamp": "2024-01-15T10:30:00Z",
      "downloadUrl": "https://s3.amazonaws.com/..."
    }
  ],
  "nextToken": "eyJsYXN0..."
}
```

## DynamoDB Table Design (Single-Table)

The application uses a single DynamoDB table with a composite primary key to
store both photo metadata and tag-based indexes.

| Item Type       | PK (partition key)  | SK (sort key)           | Attributes                                       |
|-----------------|---------------------|-------------------------|--------------------------------------------------|
| Photo Metadata  | `PHOTO#<photoId>`   | `METADATA`              | filename, contentType, tags, s3Key, uploadTimestamp |
| Tag Index       | `TAG#<tagName>`     | `PHOTO#<photoId>`       | photoId, uploadTimestamp                          |

**Access patterns:**

1. **Get all photos** — Scan for items where `SK = METADATA`
2. **Get photos by tag** — Query where `PK = TAG#<tagName>`
3. **Get a single photo** — Query where `PK = PHOTO#<photoId>` and `SK = METADATA`

## S3 Bucket

- Photos are stored with the key pattern: `photos/<photoId>/<filename>`
- Presigned download URLs are generated with a 1-hour expiry for retrieval

## Security Considerations

- API Gateway provides throttling and request validation
- S3 bucket is private; access is only via presigned URLs
- Lambda execution roles follow least-privilege (only necessary S3 and DynamoDB permissions)
- Binary photo data is base64-encoded in the JSON payload for simplicity

## Technology Stack

| Component       | Technology                          |
|-----------------|-------------------------------------|
| Language        | TypeScript                          |
| Infrastructure  | AWS CDK                             |
| Compute         | AWS Lambda (Node.js 20)             |
| API             | Amazon API Gateway (REST)           |
| Storage         | Amazon S3                           |
| Database        | Amazon DynamoDB                     |
| Testing         | Jest, aws-sdk-client-mock           |
| Bundling        | esbuild (via CDK NodejsFunction)    |
