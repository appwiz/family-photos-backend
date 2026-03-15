import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  QueryCommandInput,
  ScanCommand,
  ScanCommandInput,
  BatchGetCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const PHOTOS_TABLE = process.env.PHOTOS_TABLE!;
  const PHOTOS_BUCKET = process.env.PHOTOS_BUCKET!;

  const params = event.queryStringParameters || {};

  const tag = params.tag;
  const limit = parseLimit(params.limit);
  const nextToken = params.nextToken;

  let photos: Record<string, unknown>[];
  let newNextToken: string | undefined;

  if (tag) {
    ({ photos, nextToken: newNextToken } = await queryByTag(
      PHOTOS_TABLE,
      tag,
      limit,
      nextToken,
    ));
  } else {
    ({ photos, nextToken: newNextToken } = await scanAllPhotos(
      PHOTOS_TABLE,
      limit,
      nextToken,
    ));
  }

  // Enrich each photo with a presigned download URL
  for (const photo of photos) {
    photo.downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: PHOTOS_BUCKET,
        Key: photo.s3Key as string,
      }),
      { expiresIn: PRESIGNED_URL_EXPIRY },
    );
    delete photo.s3Key;
    delete photo.PK;
    delete photo.SK;
  }

  const responseBody: Record<string, unknown> = { photos };
  if (newNextToken) {
    responseBody.nextToken = newNextToken;
  }

  return response(200, responseBody);
}

async function queryByTag(
  tableName: string,
  tag: string,
  limit: number,
  nextToken?: string,
): Promise<{ photos: Record<string, unknown>[]; nextToken?: string }> {
  // Step 1: get photoIds from the TAG# partition
  const queryInput: QueryCommandInput = {
    TableName: tableName,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": `TAG#${tag}` },
    Limit: limit,
  };

  if (nextToken) {
    queryInput.ExclusiveStartKey = JSON.parse(b64Decode(nextToken));
  }

  const result = await dynamodb.send(new QueryCommand(queryInput));
  const tagItems = result.Items || [];

  // Step 2: batch-get the full metadata for each photo
  let photos: Record<string, unknown>[] = [];
  if (tagItems.length > 0) {
    const keys = tagItems.map((item) => ({
      PK: `PHOTO#${item.photoId}`,
      SK: "METADATA",
    }));

    const batchResult = await dynamodb.send(
      new BatchGetCommand({
        RequestItems: {
          [tableName]: { Keys: keys },
        },
      }),
    );
    photos = (batchResult.Responses?.[tableName] || []) as Record<
      string,
      unknown
    >[];
  }

  let newNextToken: string | undefined;
  if (result.LastEvaluatedKey) {
    newNextToken = b64Encode(JSON.stringify(result.LastEvaluatedKey));
  }

  return { photos, nextToken: newNextToken };
}

async function scanAllPhotos(
  tableName: string,
  limit: number,
  nextToken?: string,
): Promise<{ photos: Record<string, unknown>[]; nextToken?: string }> {
  const scanInput: ScanCommandInput = {
    TableName: tableName,
    FilterExpression: "SK = :sk",
    ExpressionAttributeValues: { ":sk": "METADATA" },
    Limit: limit,
  };

  if (nextToken) {
    scanInput.ExclusiveStartKey = JSON.parse(b64Decode(nextToken));
  }

  const result = await dynamodb.send(new ScanCommand(scanInput));
  const photos = (result.Items || []) as Record<string, unknown>[];

  let newNextToken: string | undefined;
  if (result.LastEvaluatedKey) {
    newNextToken = b64Encode(JSON.stringify(result.LastEvaluatedKey));
  }

  return { photos, nextToken: newNextToken };
}

// -- helpers ----------------------------------------------------------------

function parseLimit(raw?: string): number {
  const value = parseInt(raw || "", 10);
  if (isNaN(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(value, MAX_LIMIT));
}

function b64Encode(text: string): string {
  return Buffer.from(text).toString("base64url");
}

function b64Decode(token: string): string {
  return Buffer.from(token, "base64url").toString();
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
