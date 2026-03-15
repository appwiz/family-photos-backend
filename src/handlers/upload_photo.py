"""Lambda handler for uploading a photo.

Accepts a JSON payload containing base64-encoded image data and metadata,
stores the image in S3, and writes metadata + tag index items to DynamoDB.
"""

import base64
import json
import os
import uuid
from datetime import datetime, timezone

import boto3

PHOTOS_TABLE = os.environ["PHOTOS_TABLE"]
PHOTOS_BUCKET = os.environ["PHOTOS_BUCKET"]

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
table = dynamodb.Table(PHOTOS_TABLE)

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB


def handler(event, context):
    """Handle POST /photos requests."""
    try:
        body = json.loads(event.get("body") or "{}")
    except (json.JSONDecodeError, TypeError):
        return _response(400, {"error": "Invalid JSON in request body"})

    # --- validate required fields ----------------------------------------
    filename = body.get("filename")
    content_type = body.get("contentType")
    image_data_b64 = body.get("imageData")

    if not filename or not content_type or not image_data_b64:
        return _response(400, {
            "error": "Missing required fields: filename, contentType, imageData",
        })

    tags = body.get("tags", [])
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        return _response(400, {"error": "tags must be a list of strings"})

    # --- decode image data -----------------------------------------------
    try:
        image_bytes = base64.b64decode(image_data_b64, validate=True)
    except Exception:
        return _response(400, {"error": "imageData must be valid base64"})

    if len(image_bytes) > MAX_IMAGE_SIZE:
        return _response(400, {"error": f"Image exceeds maximum size of {MAX_IMAGE_SIZE} bytes"})

    # --- generate identifiers --------------------------------------------
    photo_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()
    s3_key = f"photos/{photo_id}/{filename}"

    # --- store image in S3 -----------------------------------------------
    s3.put_object(
        Bucket=PHOTOS_BUCKET,
        Key=s3_key,
        Body=image_bytes,
        ContentType=content_type,
    )

    # --- write metadata to DynamoDB --------------------------------------
    metadata_item = {
        "PK": f"PHOTO#{photo_id}",
        "SK": "METADATA",
        "photoId": photo_id,
        "filename": filename,
        "contentType": content_type,
        "tags": tags,
        "s3Key": s3_key,
        "uploadTimestamp": timestamp,
    }

    with table.batch_writer() as batch:
        batch.put_item(Item=metadata_item)
        for tag in tags:
            batch.put_item(Item={
                "PK": f"TAG#{tag}",
                "SK": f"PHOTO#{photo_id}",
                "photoId": photo_id,
                "uploadTimestamp": timestamp,
            })

    return _response(201, {
        "photoId": photo_id,
        "uploadTimestamp": timestamp,
        "tags": tags,
    })


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
