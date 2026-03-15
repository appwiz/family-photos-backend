"""Unit tests for the upload_photo Lambda handler."""

import base64
import json
import os
import unittest
from unittest.mock import patch

import boto3
import moto


TABLE_NAME = "test-photos-table"
BUCKET_NAME = "test-photos-bucket"

SAMPLE_IMAGE = base64.b64encode(b"\x89PNG\r\n\x1a\nfake-image-data").decode()


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


def _create_bucket():
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=BUCKET_NAME)


@moto.mock_aws
class TestUploadPhoto(unittest.TestCase):
    """Tests for POST /photos handler."""

    def setUp(self):
        _set_env()
        _create_table()
        _create_bucket()
        # Import after env and mocks are set up
        from handlers.upload_photo import handler
        self.handler = handler

    def _invoke(self, body):
        event = {
            "body": json.dumps(body),
            "queryStringParameters": None,
        }
        return self.handler(event, None)

    # -- success cases -----------------------------------------------------

    def test_upload_success(self):
        response = self._invoke({
            "filename": "test.jpg",
            "contentType": "image/jpeg",
            "tags": ["family", "vacation"],
            "imageData": SAMPLE_IMAGE,
        })

        self.assertEqual(response["statusCode"], 201)
        body = json.loads(response["body"])
        self.assertIn("photoId", body)
        self.assertIn("uploadTimestamp", body)
        self.assertEqual(body["tags"], ["family", "vacation"])

    def test_upload_creates_s3_object(self):
        self._invoke({
            "filename": "beach.png",
            "contentType": "image/png",
            "tags": [],
            "imageData": SAMPLE_IMAGE,
        })

        s3 = boto3.client("s3", region_name="us-east-1")
        objects = s3.list_objects_v2(Bucket=BUCKET_NAME, Prefix="photos/")
        self.assertEqual(objects["KeyCount"], 1)
        self.assertTrue(objects["Contents"][0]["Key"].endswith("/beach.png"))

    def test_upload_creates_dynamodb_items(self):
        self._invoke({
            "filename": "party.jpg",
            "contentType": "image/jpeg",
            "tags": ["birthday", "family"],
            "imageData": SAMPLE_IMAGE,
        })

        table = boto3.resource("dynamodb", region_name="us-east-1").Table(TABLE_NAME)
        result = table.scan()
        items = result["Items"]

        # 1 metadata item + 2 tag items
        self.assertEqual(len(items), 3)

        pks = sorted(item["PK"] for item in items)
        self.assertTrue(any(pk.startswith("PHOTO#") for pk in pks))
        self.assertIn("TAG#birthday", pks)
        self.assertIn("TAG#family", pks)

    def test_upload_without_tags(self):
        response = self._invoke({
            "filename": "solo.jpg",
            "contentType": "image/jpeg",
            "imageData": SAMPLE_IMAGE,
        })

        self.assertEqual(response["statusCode"], 201)
        body = json.loads(response["body"])
        self.assertEqual(body["tags"], [])

    # -- validation failures -----------------------------------------------

    def test_missing_filename(self):
        response = self._invoke({
            "contentType": "image/jpeg",
            "imageData": SAMPLE_IMAGE,
        })
        self.assertEqual(response["statusCode"], 400)

    def test_missing_content_type(self):
        response = self._invoke({
            "filename": "test.jpg",
            "imageData": SAMPLE_IMAGE,
        })
        self.assertEqual(response["statusCode"], 400)

    def test_missing_image_data(self):
        response = self._invoke({
            "filename": "test.jpg",
            "contentType": "image/jpeg",
        })
        self.assertEqual(response["statusCode"], 400)

    def test_invalid_base64(self):
        response = self._invoke({
            "filename": "test.jpg",
            "contentType": "image/jpeg",
            "imageData": "not-valid-base64!!!",
        })
        self.assertEqual(response["statusCode"], 400)

    def test_invalid_json_body(self):
        event = {"body": "not json", "queryStringParameters": None}
        response = self.handler(event, None)
        self.assertEqual(response["statusCode"], 400)

    def test_tags_must_be_list_of_strings(self):
        response = self._invoke({
            "filename": "test.jpg",
            "contentType": "image/jpeg",
            "tags": "not-a-list",
            "imageData": SAMPLE_IMAGE,
        })
        self.assertEqual(response["statusCode"], 400)

    def test_cors_headers_present(self):
        response = self._invoke({
            "filename": "test.jpg",
            "contentType": "image/jpeg",
            "imageData": SAMPLE_IMAGE,
        })
        self.assertEqual(
            response["headers"]["Access-Control-Allow-Origin"], "*",
        )


if __name__ == "__main__":
    unittest.main()
