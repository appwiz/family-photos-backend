# TRANSCRIPT.md — Conversation Log

This file records the prompts provided by the project owner during development.

---

## Prompt 1 — Initial Requirements

> We are building an app and backend for sharing photos. Photos are uploaded,
> stored, and indexed by various tags or timestamps. Viewers see photos randomly
> or by tags. This repo contains the backend for the app. It is hosted in AWS
> and uses S3, DynamoDB, AWS API Gateway, and Lambda as the primary services.
> Provide an API to upload a photo and another to retrieve a photo with optional
> filters for tags. Start with a plan including an architecture diagram that I
> can review before you proceed with implementation.

**Outcome**: Initial Python/SAM implementation was created with POST /photos and
GET /photos endpoints, architecture documentation, and unit tests.

---

## Prompt 2 — Switch to TypeScript/CDK

> Implement using Typescript and CDK instead of python/SAM please.

**Outcome**: Full rewrite from Python/SAM to TypeScript/CDK while preserving the
same architecture (API Gateway, Lambda, S3, DynamoDB) and API behavior.

---

## Prompt 3 — Add SPEC.md and TRANSCRIPT.md

> Remember to write these constraints and design decisions into a SPEC.md. I
> also want you to write my prompts into a TRANSCRIPT.md file.

**Outcome**: Created SPEC.md documenting constraints and design decisions.
Created this TRANSCRIPT.md file recording all prompts.
