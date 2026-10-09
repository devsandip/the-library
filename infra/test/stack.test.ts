import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../lib/config.js";
import { LibraryStack } from "../lib/library-stack.js";

function synth(stage: "dev" | "prod") {
  // Skip esbuild bundling in unit tests; deploys bundle for real.
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new LibraryStack(app, `TheLibrary-${stage}`, {
    stage,
    env: { account: "111111111111", region: "us-east-1" },
  });
  return Template.fromStack(stack);
}

describe("prod stack: hosting", () => {
  const t = synth("prod");

  it("routes /thelibrary/api/* to the HTTP API with caching off and auth headers forwarded", () => {
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: "/thelibrary/api/*",
            AllowedMethods: Match.arrayWith(["PATCH", "POST", "DELETE"]),
            CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", // CachingDisabled
            OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac", // AllViewerExceptHostHeader
          }),
        ],
      }),
    });
  });

  it("serves the SPA through a viewer-request function", () => {
    t.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionConfig: Match.objectLike({ Runtime: "cloudfront-js-2.0" }),
      FunctionCode: Match.stringLikeRegexp("/thelibrary/index.html"),
    });
  });

  it("sends the CSP and noindex on every response", () => {
    t.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: { ContentSecurityPolicy: CONTENT_SECURITY_POLICY, Override: true },
        }),
        CustomHeadersConfig: {
          Items: [{ Header: "X-Robots-Tag", Value: "noindex, nofollow", Override: true }],
        },
      }),
    });
  });

  it("uses Node 24 on arm64", () => {
    t.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
    });
  });

  it("exports the distribution domain for the Amplify rule", () => {
    expect(Object.keys(t.findOutputs("DistributionDomain"))).toHaveLength(1);
  });
});

describe("dev stack", () => {
  it("has no CloudFront", () => {
    synth("dev").resourceCountIs("AWS::CloudFront::Distribution", 0);
  });
});
