import test from "node:test";
import assert from "node:assert/strict";

import { collectBucketObjectVersions, summarizeStackFailureEvents } from "./src/deploy.mjs";

test("collectBucketObjectVersions includes versions and delete markers", () => {
  const objects = collectBucketObjectVersions({
    Versions: [
      {
        Key: "lambda/source-dispatcher.zip",
        VersionId: "111"
      }
    ],
    DeleteMarkers: [
      {
        Key: "lambda/render-worker.zip",
        VersionId: "222"
      }
    ]
  });

  assert.deepEqual(objects, [
    {
      Key: "lambda/source-dispatcher.zip",
      VersionId: "111"
    },
    {
      Key: "lambda/render-worker.zip",
      VersionId: "222"
    }
  ]);
});

test("summarizeStackFailureEvents keeps relevant CloudFormation failures", () => {
  const summary = summarizeStackFailureEvents([
    {
      Timestamp: "2026-04-11T10:05:00.000Z",
      LogicalResourceId: "WebsiteDistribution",
      ResourceType: "AWS::CloudFront::Distribution",
      ResourceStatus: "CREATE_FAILED",
      ResourceStatusReason: "One or more aliases are already associated with a different resource."
    },
    {
      Timestamp: "2026-04-11T10:04:00.000Z",
      LogicalResourceId: "LiveStack",
      ResourceType: "AWS::CloudFormation::Stack",
      ResourceStatus: "ROLLBACK_IN_PROGRESS",
      ResourceStatusReason: "The following resource(s) failed to create: [WebsiteDistribution]."
    },
    {
      Timestamp: "2026-04-11T10:03:00.000Z",
      LogicalResourceId: "WebsiteCodeBucket",
      ResourceType: "AWS::S3::Bucket",
      ResourceStatus: "CREATE_COMPLETE"
    }
  ]);

  assert.deepEqual(summary, [
    {
      timestamp: "2026-04-11T10:05:00.000Z",
      logicalResourceId: "WebsiteDistribution",
      resourceType: "AWS::CloudFront::Distribution",
      resourceStatus: "CREATE_FAILED",
      resourceStatusReason: "One or more aliases are already associated with a different resource."
    },
    {
      timestamp: "2026-04-11T10:04:00.000Z",
      logicalResourceId: "LiveStack",
      resourceType: "AWS::CloudFormation::Stack",
      resourceStatus: "ROLLBACK_IN_PROGRESS",
      resourceStatusReason: "The following resource(s) failed to create: [WebsiteDistribution]."
    }
  ]);
});
