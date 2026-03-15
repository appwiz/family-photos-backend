# SPEC.md — Family Photos Backend

## Overview

A serverless backend for sharing family photos, hosted on AWS. Photos are
uploaded, stored in S3, and indexed by tags and timestamps in DynamoDB. Viewers
can retrieve photos randomly or filter by tags via a REST API.

## Constraints

| # | Constraint | Rationale |
|---|-----------|-----------|
| C1 | Must be hosted entirely on AWS | Organizational standard |
| C2 | Must use S3, DynamoDB, API Gateway, and Lambda as primary services | Specified in requirements |
| C3 | Must be implemented in **TypeScript** | Owner preference (replaces initial Python implementation) |
| C4 | Infrastructure must be defined with **AWS CDK** | Owner preference (replaces initial SAM template) |
| C5 | S3 bucket must be private — no public access | Security best practice |
| C6 | Photos accessed only via time-limited presigned URLs | Follows from C5 |
| C7 | Lambda execution roles follow least-privilege | Security best practice |
| C8 | API must support CORS (`Access-Control-Allow-Origin: *`) | Required for browser-based clients |

## Design Decisions

### DD1 — Single-Table DynamoDB Design

Use a single DynamoDB table with a composite primary key (`PK` / `SK`) to store
both photo metadata and tag index entries. This avoids multiple tables and
enables efficient access patterns with minimal cost.

**Item patterns:**

| Item Type      | PK                  | SK                    | Additional Attributes                                |
|----------------|---------------------|-----------------------|------------------------------------------------------|
| Photo Metadata | `PHOTO#<photoId>`   | `METADATA`            | photoId, filename, contentType, tags, s3Key, uploadTimestamp |
| Tag Index      | `TAG#<tagName>`     | `PHOTO#<photoId>`     | photoId, uploadTimestamp                             |

### DD2 — S3 Object Key Pattern

Store photos under `photos/<photoId>/<filename>`. The photoId prefix prevents
name collisions and makes per-photo cleanup straightforward.

### DD3 — Base64 Encoding for Upload

Photo data is sent as base64-encoded JSON in the request body. This keeps the
API simple (single JSON endpoint) at the cost of ~33% payload overhead. A future
improvement could use multipart upload or presigned PUT URLs.

### DD4 — Presigned URLs for Download

GET /photos returns presigned S3 download URLs (1-hour expiry) instead of
proxying binary data through Lambda. This offloads bandwidth to S3 and avoids
Lambda response size limits.

### DD5 — Pagination with Opaque Tokens

Pagination uses base64-encoded DynamoDB `LastEvaluatedKey` values as opaque
`nextToken` strings. Clients never need to understand the underlying cursor
format.

### DD6 — PAY_PER_REQUEST DynamoDB Billing

On-demand billing avoids capacity planning and keeps costs proportional to
actual usage — ideal for a personal/family application with unpredictable traffic.

### DD7 — NodejsFunction with esbuild Bundling

Lambda handlers use CDK's `NodejsFunction` construct which automatically bundles
TypeScript with esbuild. This produces small, fast-starting Lambda packages
without a separate build step.

### DD8 — Maximum Image Size Limit

Uploads are capped at 10 MB to prevent abuse and keep Lambda execution within
reasonable memory/time bounds.

## API Specification

### POST /photos — Upload a Photo

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

**Error responses**: `400 Bad Request` with `{ "error": "..." }` for validation
failures (missing fields, invalid base64, oversized image, invalid tags).

### GET /photos — Retrieve Photos

**Query parameters** (all optional):

| Parameter   | Description                                        | Default |
|-------------|----------------------------------------------------|---------|
| `tag`       | Filter by tag (returns only photos with this tag)  | —       |
| `limit`     | Max number of results (1–100)                      | 20      |
| `nextToken` | Pagination token from a previous response          | —       |

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

## Technology Stack

| Component       | Technology              |
|-----------------|-------------------------|
| Language        | TypeScript              |
| Infrastructure  | AWS CDK                 |
| Compute         | AWS Lambda (Node.js 20) |
| API             | Amazon API Gateway (REST) |
| Storage         | Amazon S3               |
| Database        | Amazon DynamoDB         |
| Testing         | Jest, aws-sdk-client-mock |
| Bundling        | esbuild (via CDK NodejsFunction) |
