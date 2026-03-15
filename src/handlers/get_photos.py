"""Lambda handler for retrieving photos.

Supports listing all photos or filtering by a single tag. Returns metadata
together with time-limited presigned download URLs.
"""

import json
import os

import boto3
from boto3.dynamodb.conditions import Key

PHOTOS_TABLE = os.environ["PHOTOS_TABLE"]
PHOTOS_BUCKET = os.environ["PHOTOS_BUCKET"]

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
table = dynamodb.Table(PHOTOS_TABLE)

DEFAULT_LIMIT = 20
MAX_LIMIT = 100
PRESIGNED_URL_EXPIRY = 3600  # 1 hour


def handler(event, context):
    """Handle GET /photos requests."""
    params = event.get("queryStringParameters") or {}

    tag = params.get("tag")
    limit = _parse_limit(params.get("limit"))
    next_token = params.get("nextToken")

    if tag:
        photos, new_next_token = _query_by_tag(tag, limit, next_token)
    else:
        photos, new_next_token = _scan_all_photos(limit, next_token)

    # Enrich each photo with a presigned download URL
    for photo in photos:
        photo["downloadUrl"] = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": PHOTOS_BUCKET, "Key": photo["s3Key"]},
            ExpiresIn=PRESIGNED_URL_EXPIRY,
        )
        del photo["s3Key"]  # no need to expose internal key
        # Remove DynamoDB key attributes from the response
        photo.pop("PK", None)
        photo.pop("SK", None)

    response_body = {"photos": photos}
    if new_next_token:
        response_body["nextToken"] = new_next_token

    return _response(200, response_body)


def _query_by_tag(tag, limit, next_token):
    """Query the tag index to find photos matching a specific tag."""
    # Step 1: get photoIds from the TAG# partition
    query_args = {
        "KeyConditionExpression": Key("PK").eq(f"TAG#{tag}"),
        "Limit": limit,
    }
    if next_token:
        query_args["ExclusiveStartKey"] = json.loads(
            _b64_decode(next_token),
        )

    result = table.query(**query_args)
    tag_items = result.get("Items", [])

    # Step 2: batch-get the full metadata for each photo
    photos = []
    for item in tag_items:
        photo_id = item["photoId"]
        meta = table.get_item(
            Key={"PK": f"PHOTO#{photo_id}", "SK": "METADATA"},
        ).get("Item")
        if meta:
            photos.append(meta)

    new_next_token = None
    if "LastEvaluatedKey" in result:
        new_next_token = _b64_encode(json.dumps(result["LastEvaluatedKey"]))

    return photos, new_next_token


def _scan_all_photos(limit, next_token):
    """Scan for all photo metadata items."""
    scan_args = {
        "FilterExpression": Key("SK").eq("METADATA"),
        "Limit": limit,
    }
    if next_token:
        scan_args["ExclusiveStartKey"] = json.loads(
            _b64_decode(next_token),
        )

    result = table.scan(**scan_args)
    photos = result.get("Items", [])

    new_next_token = None
    if "LastEvaluatedKey" in result:
        new_next_token = _b64_encode(json.dumps(result["LastEvaluatedKey"]))

    return photos, new_next_token


# -- helpers ----------------------------------------------------------------

def _parse_limit(raw):
    try:
        value = int(raw)
        return max(1, min(value, MAX_LIMIT))
    except (TypeError, ValueError):
        return DEFAULT_LIMIT


def _b64_encode(text):
    import base64
    return base64.urlsafe_b64encode(text.encode()).decode()


def _b64_decode(token):
    import base64
    return base64.urlsafe_b64decode(token.encode()).decode()


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
