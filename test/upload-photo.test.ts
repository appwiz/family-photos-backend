import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { handler } from "../lambda/upload-photo";
import { APIGatewayProxyEvent } from "aws-lambda";

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

const SAMPLE_IMAGE = Buffer.from("fake-image-data").toString("base64");

function makeEvent(body: Record<string, unknown>): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/photos",
    pathParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
  };
}

describe("upload-photo handler", () => {
  beforeAll(() => {
    process.env.PHOTOS_TABLE = "test-table";
    process.env.PHOTOS_BUCKET = "test-bucket";
  });

  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    ddbMock.on(BatchWriteCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});
  });

  // -- success cases ----------------------------------------------------

  test("returns 201 with photoId, timestamp, and tags on success", async () => {
    const result = await handler(
      makeEvent({
        filename: "test.jpg",
        contentType: "image/jpeg",
        tags: ["family", "vacation"],
        imageData: SAMPLE_IMAGE,
      }),
    );

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.photoId).toBeDefined();
    expect(body.uploadTimestamp).toBeDefined();
    expect(body.tags).toEqual(["family", "vacation"]);
  });

  test("stores image in S3", async () => {
    await handler(
      makeEvent({
        filename: "beach.png",
        contentType: "image/png",
        tags: [],
        imageData: SAMPLE_IMAGE,
      }),
    );

    const s3Calls = s3Mock.commandCalls(PutObjectCommand);
    expect(s3Calls).toHaveLength(1);
    expect(s3Calls[0].args[0].input.Bucket).toBe("test-bucket");
    expect(s3Calls[0].args[0].input.Key).toMatch(/^photos\/.*\/beach\.png$/);
    expect(s3Calls[0].args[0].input.ContentType).toBe("image/png");
  });

  test("writes metadata and tag items to DynamoDB", async () => {
    await handler(
      makeEvent({
        filename: "party.jpg",
        contentType: "image/jpeg",
        tags: ["birthday", "family"],
        imageData: SAMPLE_IMAGE,
      }),
    );

    const ddbCalls = ddbMock.commandCalls(BatchWriteCommand);
    expect(ddbCalls).toHaveLength(1);

    const items =
      ddbCalls[0].args[0].input.RequestItems?.["test-table"] || [];
    // 1 metadata + 2 tags = 3
    expect(items).toHaveLength(3);

    const pks = items.map(
      (r) => r.PutRequest?.Item?.PK as string,
    );
    expect(pks).toContainEqual(expect.stringContaining("PHOTO#"));
    expect(pks).toContain("TAG#birthday");
    expect(pks).toContain("TAG#family");
  });

  test("works without tags", async () => {
    const result = await handler(
      makeEvent({
        filename: "solo.jpg",
        contentType: "image/jpeg",
        imageData: SAMPLE_IMAGE,
      }),
    );

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.tags).toEqual([]);
  });

  // -- validation failures -----------------------------------------------

  test("returns 400 when filename is missing", async () => {
    const result = await handler(
      makeEvent({ contentType: "image/jpeg", imageData: SAMPLE_IMAGE }),
    );
    expect(result.statusCode).toBe(400);
  });

  test("returns 400 when contentType is missing", async () => {
    const result = await handler(
      makeEvent({ filename: "test.jpg", imageData: SAMPLE_IMAGE }),
    );
    expect(result.statusCode).toBe(400);
  });

  test("returns 400 when imageData is missing", async () => {
    const result = await handler(
      makeEvent({ filename: "test.jpg", contentType: "image/jpeg" }),
    );
    expect(result.statusCode).toBe(400);
  });

  test("returns 400 for invalid base64", async () => {
    const result = await handler(
      makeEvent({
        filename: "test.jpg",
        contentType: "image/jpeg",
        imageData: "not-valid-base64!!!",
      }),
    );
    expect(result.statusCode).toBe(400);
  });

  test("returns 400 for invalid JSON body", async () => {
    const event = makeEvent({});
    event.body = "not json";
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  test("returns 400 when tags is not a list of strings", async () => {
    const result = await handler(
      makeEvent({
        filename: "test.jpg",
        contentType: "image/jpeg",
        tags: "not-a-list",
        imageData: SAMPLE_IMAGE,
      }),
    );
    expect(result.statusCode).toBe(400);
  });

  test("includes CORS headers in response", async () => {
    const result = await handler(
      makeEvent({
        filename: "test.jpg",
        contentType: "image/jpeg",
        imageData: SAMPLE_IMAGE,
      }),
    );
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe("*");
  });
});
