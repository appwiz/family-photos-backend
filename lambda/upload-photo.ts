import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const PHOTOS_TABLE = process.env.PHOTOS_TABLE!;
  const PHOTOS_BUCKET = process.env.PHOTOS_BUCKET!;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return response(400, { error: "Invalid JSON in request body" });
  }

  // --- validate required fields ----------------------------------------
  const filename = body.filename as string | undefined;
  const contentType = body.contentType as string | undefined;
  const imageDataB64 = body.imageData as string | undefined;

  if (!filename || !contentType || !imageDataB64) {
    return response(400, {
      error: "Missing required fields: filename, contentType, imageData",
    });
  }

  const tags = body.tags ?? [];
  if (
    !Array.isArray(tags) ||
    !tags.every((t: unknown) => typeof t === "string")
  ) {
    return response(400, { error: "tags must be a list of strings" });
  }

  // --- decode image data -----------------------------------------------
  let imageBytes: Buffer;
  try {
    imageBytes = Buffer.from(imageDataB64, "base64");
    // Validate that the string was actually valid base64
    if (imageBytes.toString("base64") !== imageDataB64) {
      throw new Error("invalid base64");
    }
  } catch {
    return response(400, { error: "imageData must be valid base64" });
  }

  if (imageBytes.length > MAX_IMAGE_SIZE) {
    return response(400, {
      error: `Image exceeds maximum size of ${MAX_IMAGE_SIZE} bytes`,
    });
  }

  // --- generate identifiers --------------------------------------------
  const photoId = randomUUID();
  const timestamp = new Date().toISOString();
  const s3Key = `photos/${photoId}/${filename}`;

  // --- store image in S3 -----------------------------------------------
  await s3.send(
    new PutObjectCommand({
      Bucket: PHOTOS_BUCKET,
      Key: s3Key,
      Body: imageBytes,
      ContentType: contentType,
    }),
  );

  // --- write metadata to DynamoDB --------------------------------------
  const putRequests = [
    {
      PutRequest: {
        Item: {
          PK: `PHOTO#${photoId}`,
          SK: "METADATA",
          photoId,
          filename,
          contentType,
          tags,
          s3Key,
          uploadTimestamp: timestamp,
        },
      },
    },
    ...(tags as string[]).map((tag: string) => ({
      PutRequest: {
        Item: {
          PK: `TAG#${tag}`,
          SK: `PHOTO#${photoId}`,
          photoId,
          uploadTimestamp: timestamp,
        },
      },
    })),
  ];

  // BatchWriteItem supports max 25 items per request
  for (let i = 0; i < putRequests.length; i += 25) {
    await dynamodb.send(
      new BatchWriteCommand({
        RequestItems: {
          [PHOTOS_TABLE]: putRequests.slice(i, i + 25),
        },
      }),
    );
  }

  return response(201, {
    photoId,
    uploadTimestamp: timestamp,
    tags,
  });
}

function response(
  statusCode: number,
  body: Record<string, unknown>,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}
