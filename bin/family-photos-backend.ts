#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FamilyPhotosStack } from "../lib/family-photos-stack";

const app = new cdk.App();
new FamilyPhotosStack(app, "FamilyPhotosStack", {
  description: "Family Photos Backend — serverless API for uploading and retrieving photos",
});
