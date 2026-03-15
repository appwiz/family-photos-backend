import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { handler } from "../lambda/get-photos";
import { APIGatewayProxyEvent } from "aws-lambda";

// Mock getSignedUrl to return a predictable URL
jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://s3.amazonaws.com/presigned-url"),
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

function makeEvent(params?: Record<string, string>): APIGatewayProxyEvent {
  return {
    body: null,
    queryStringParameters: params || null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/photos",
    pathParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

function makePhotoItem(id: string, filename: string, tags: string[]) {
  return {
    PK: `PHOTO#${id}`,
    SK: "METADATA",
    photoId: id,
    filename,
    contentType: "image/jpeg",
    tags,
    s3Key: `photos/${id}/${filename}`,
    uploadTimestamp: "2024-01-15T10:00:00Z",
  };
}

describe("get-photos handler", () => {
  beforeAll(() => {
    process.env.PHOTOS_TABLE = "test-table";
    process.env.PHOTOS_BUCKET = "test-bucket";
  });

  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
  });

  // -- listing all photos ------------------------------------------------

  test("returns empty list when table is empty", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.photos).toEqual([]);
  });

  test("lists all photos from scan", async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        makePhotoItem("id-1", "a.jpg", ["beach"]),
        makePhotoItem("id-2", "b.jpg", ["mountain"]),
      ],
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.photos).toHaveLength(2);
  });

  test("photos contain downloadUrl", async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [makePhotoItem("id-1", "a.jpg", [])],
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);
    expect(body.photos[0].downloadUrl).toBe("https://s3.amazonaws.com/presigned-url");
  });

  test("internal keys are not exposed in response", async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [makePhotoItem("id-1", "a.jpg", [])],
    });

    const result = await handler(makeEvent());
    const body = JSON.parse(result.body);
    const photo = body.photos[0];

    expect(photo.PK).toBeUndefined();
    expect(photo.SK).toBeUndefined();
    expect(photo.s3Key).toBeUndefined();
  });

  // -- filtering by tag --------------------------------------------------

  test("filters by tag using query", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ PK: "TAG#beach", SK: "PHOTO#id-1", photoId: "id-1" }],
    });
    ddbMock.on(BatchGetCommand).resolves({
      Responses: {
        "test-table": [makePhotoItem("id-1", "beach.jpg", ["beach", "summer"])],
      },
    });

    const result = await handler(makeEvent({ tag: "beach" }));
    const body = JSON.parse(result.body);
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].photoId).toBe("id-1");
  });

  test("returns empty list for nonexistent tag", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await handler(makeEvent({ tag: "nonexistent" }));
    const body = JSON.parse(result.body);
    expect(body.photos).toEqual([]);
  });

  // -- limit parameter ---------------------------------------------------

  test("passes custom limit to scan", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    await handler(makeEvent({ limit: "5" }));

    const scanCalls = ddbMock.commandCalls(ScanCommand);
    expect(scanCalls[0].args[0].input.Limit).toBe(5);
  });

  test("uses default limit for invalid value", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    const result = await handler(makeEvent({ limit: "abc" }));
    expect(result.statusCode).toBe(200);

    const scanCalls = ddbMock.commandCalls(ScanCommand);
    expect(scanCalls[0].args[0].input.Limit).toBe(20);
  });

  // -- CORS headers -------------------------------------------------------

  test("includes CORS headers", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    const result = await handler(makeEvent());
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("*");
  });
});
