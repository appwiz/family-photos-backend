import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import * as path from "path";

export class FamilyPhotosStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------
    // DynamoDB Table (single-table design)
    // -----------------------------------------------------------------
    const photosTable = new dynamodb.Table(this, "PhotosTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -----------------------------------------------------------------
    // S3 Bucket (private, encrypted)
    // -----------------------------------------------------------------
    const photosBucket = new s3.Bucket(this, "PhotosBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // -----------------------------------------------------------------
    // Lambda Functions
    // -----------------------------------------------------------------
    const commonLambdaProps: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        PHOTOS_TABLE: photosTable.tableName,
        PHOTOS_BUCKET: photosBucket.bucketName,
      },
    };

    const uploadPhotoFn = new NodejsFunction(this, "UploadPhotoFunction", {
      ...commonLambdaProps,
      entry: path.join(__dirname, "..", "lambda", "upload-photo.ts"),
      handler: "handler",
      description: "Handles photo uploads — stores image in S3 and metadata in DynamoDB",
    });

    const getPhotosFn = new NodejsFunction(this, "GetPhotosFunction", {
      ...commonLambdaProps,
      entry: path.join(__dirname, "..", "lambda", "get-photos.ts"),
      handler: "handler",
      description: "Retrieves photos with optional tag filters",
    });

    // Grant permissions (least-privilege)
    photosTable.grantReadWriteData(uploadPhotoFn);
    photosBucket.grantReadWrite(uploadPhotoFn);

    photosTable.grantReadData(getPhotosFn);
    photosBucket.grantRead(getPhotosFn);

    // -----------------------------------------------------------------
    // API Gateway
    // -----------------------------------------------------------------
    const api = new apigateway.RestApi(this, "PhotosApi", {
      restApiName: "Family Photos API",
      description: "REST API for uploading and retrieving family photos",
      deployOptions: { stageName: "prod" },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      binaryMediaTypes: ["application/octet-stream", "image/*"],
    });

    const photosResource = api.root.addResource("photos");
    photosResource.addMethod("POST", new apigateway.LambdaIntegration(uploadPhotoFn));
    photosResource.addMethod("GET", new apigateway.LambdaIntegration(getPhotosFn));

    // -----------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------
    new cdk.CfnOutput(this, "ApiEndpoint", {
      description: "API Gateway endpoint URL",
      value: api.url,
    });
    new cdk.CfnOutput(this, "PhotosBucketName", {
      description: "S3 bucket for photo storage",
      value: photosBucket.bucketName,
    });
    new cdk.CfnOutput(this, "PhotosTableName", {
      description: "DynamoDB table for photo metadata",
      value: photosTable.tableName,
    });
  }
}
