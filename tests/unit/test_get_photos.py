"""Unit tests for the get_photos Lambda handler."""

import base64
import json
import os
import unittest

import boto3
import moto


TABLE_NAME = "test-photos-table"
BUCKET_NAME = "test-photos-bucket"


def _set_env():
    os.environ["PHOTOS_TABLE"] = TABLE_NAME
    os.environ["PHOTOS_BUCKET"] = BUCKET_NAME
    os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"


def _create_table():
    dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
    dynamodb.create_table(
        TableName=TABLE_NAME,
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    return dynamodb.Table(TABLE_NAME)


def _create_bucket():
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=BUCKET_NAME)


def _seed_photo(table, photo_id, filename, tags, timestamp="2024-01-15T10:00:00Z"):
    """Insert a photo metadata item and associated tag items."""
    s3_key = f"photos/{photo_id}/{filename}"
    with table.batch_writer() as batch:
        batch.put_item(Item={
            "PK": f"PHOTO#{photo_id}",
            "SK": "METADATA",
            "photoId": photo_id,
            "filename": filename,
            "contentType": "image/jpeg",
            "tags": tags,
            "s3Key": s3_key,
            "uploadTimestamp": timestamp,
        })
        for tag in tags:
            batch.put_item(Item={
                "PK": f"TAG#{tag}",
                "SK": f"PHOTO#{photo_id}",
                "photoId": photo_id,
                "uploadTimestamp": timestamp,
            })

    # Put a dummy object in S3 so presigned URLs are for real keys
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.put_object(Bucket=BUCKET_NAME, Key=s3_key, Body=b"fake")


@moto.mock_aws
class TestGetPhotos(unittest.TestCase):
    """Tests for GET /photos handler."""

    def setUp(self):
        _set_env()
        self.table = _create_table()
        _create_bucket()
        # Import after mocks
        from handlers.get_photos import handler
        self.handler = handler

    def _invoke(self, params=None):
        event = {
            "body": None,
            "queryStringParameters": params,
        }
        return self.handler(event, None)

    # -- listing all photos ------------------------------------------------

    def test_empty_table_returns_empty_list(self):
        response = self._invoke()
        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["photos"], [])

    def test_list_all_photos(self):
        _seed_photo(self.table, "id-1", "a.jpg", ["beach"])
        _seed_photo(self.table, "id-2", "b.jpg", ["mountain"])

        response = self._invoke()
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(len(body["photos"]), 2)

    def test_photos_contain_download_url(self):
        _seed_photo(self.table, "id-1", "a.jpg", [])

        response = self._invoke()
        body = json.loads(response["body"])
        photo = body["photos"][0]

        self.assertIn("downloadUrl", photo)
        self.assertTrue(photo["downloadUrl"].startswith("https://"))

    def test_internal_keys_not_exposed(self):
        _seed_photo(self.table, "id-1", "a.jpg", [])

        response = self._invoke()
        body = json.loads(response["body"])
        photo = body["photos"][0]

        self.assertNotIn("PK", photo)
        self.assertNotIn("SK", photo)
        self.assertNotIn("s3Key", photo)

    # -- filtering by tag --------------------------------------------------

    def test_filter_by_tag(self):
        _seed_photo(self.table, "id-1", "beach.jpg", ["beach", "summer"])
        _seed_photo(self.table, "id-2", "mountain.jpg", ["mountain"])

        response = self._invoke({"tag": "beach"})
        body = json.loads(response["body"])

        self.assertEqual(len(body["photos"]), 1)
        self.assertEqual(body["photos"][0]["photoId"], "id-1")

    def test_filter_by_tag_no_results(self):
        _seed_photo(self.table, "id-1", "a.jpg", ["beach"])

        response = self._invoke({"tag": "nonexistent"})
        body = json.loads(response["body"])

        self.assertEqual(body["photos"], [])

    # -- limit parameter ---------------------------------------------------

    def test_custom_limit(self):
        for i in range(5):
            _seed_photo(self.table, f"id-{i}", f"{i}.jpg", ["group"])

        response = self._invoke({"tag": "group", "limit": "2"})
        body = json.loads(response["body"])

        self.assertLessEqual(len(body["photos"]), 2)

    def test_invalid_limit_uses_default(self):
        response = self._invoke({"limit": "abc"})
        self.assertEqual(response["statusCode"], 200)

    # -- CORS headers ------------------------------------------------------

    def test_cors_headers(self):
        response = self._invoke()
        self.assertEqual(
            response["headers"]["Access-Control-Allow-Origin"], "*",
        )


if __name__ == "__main__":
    unittest.main()
