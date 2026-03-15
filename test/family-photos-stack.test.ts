import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { FamilyPhotosStack } from "../lib/family-photos-stack";

describe("FamilyPhotosStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new FamilyPhotosStack(app, "TestStack");
    template = Template.fromStack(stack);
  });

  // -- DynamoDB -----------------------------------------------------------

  test("creates DynamoDB table with PK/SK key schema", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  // -- S3 -----------------------------------------------------------------

  test("creates S3 bucket with encryption and blocked public access", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  // -- Lambda -------------------------------------------------------------

  test("creates two Lambda functions", () => {
    template.resourceCountIs("AWS::Lambda::Function", 3);
    // 3 = UploadPhoto + GetPhotos + CDK autoDeleteObjects custom resource handler
  });

  test("Lambda functions use Node.js 20 runtime", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs20.x",
      MemorySize: 256,
      Timeout: 30,
    });
  });

  // -- API Gateway --------------------------------------------------------

  test("creates REST API with /photos resource", () => {
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "Family Photos API",
    });
  });

  test("creates POST and GET methods on /photos", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "POST",
    });
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
    });
  });

  // -- Outputs ------------------------------------------------------------

  test("exports API endpoint, bucket name, and table name", () => {
    template.hasOutput("ApiEndpoint", {});
    template.hasOutput("PhotosBucketName", {});
    template.hasOutput("PhotosTableName", {});
  });
});
