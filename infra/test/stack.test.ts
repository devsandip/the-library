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

  it("routes /nutgraf/api/* to the HTTP API with caching off and auth headers forwarded", () => {
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: "/nutgraf/api/*",
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
      FunctionCode: Match.stringLikeRegexp("/nutgraf/index.html"),
    });
  });

  it("lets the public about/privacy/terms pages bypass the sign-in shell", () => {
    for (const page of ["about", "privacy", "terms"]) {
      t.hasResourceProperties("AWS::CloudFront::Function", {
        FunctionCode: Match.stringLikeRegexp(`uri === "/nutgraf/${page}.html"`),
      });
    }
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

describe("data and ingest", () => {
  it("prod: table with 4 GSIs, PITR and deletion protection, retained", () => {
    const t = synth("prod");
    t.hasResource("AWS::DynamoDB::GlobalTable", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({ IndexName: "gsi1" }),
          Match.objectLike({ IndexName: "gsi2" }),
          Match.objectLike({ IndexName: "gsi3" }),
          Match.objectLike({ IndexName: "gsi4" }),
        ]),
        Replicas: [
          Match.objectLike({
            DeletionProtectionEnabled: true,
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          }),
        ],
      }),
    });
  });

  it("dev: table is disposable", () => {
    synth("dev").hasResource("AWS::DynamoDB::GlobalTable", { DeletionPolicy: "Delete" });
  });

  it("content bucket expires raw/ after 30 days and html/ after 365", () => {
    synth("prod").hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Prefix: "raw/", ExpirationInDays: 30 }),
          Match.objectLike({ Prefix: "html/", ExpirationInDays: 365 }),
        ]),
      },
    });
  });

  it("ingest never retries async invokes and runs one at a time", () => {
    const t = synth("prod");
    t.hasResourceProperties("AWS::Lambda::EventInvokeConfig", { MaximumRetryAttempts: 0 });
    t.hasResourceProperties("AWS::Lambda::Function", {
      Timeout: 600,
      ReservedConcurrentExecutions: 1,
    });
  });

  it("the jobs Lambda runs up to 2 minutes, never retries, and the API starts it (#23)", () => {
    const t = synth("prod");
    t.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Timeout: 120,
      Environment: { Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }) },
    });
    t.hasResourceProperties("AWS::Lambda::Function", {
      Timeout: 28,
      Environment: { Variables: Match.objectLike({ JOBS_FUNCTION: Match.anyValue() }) },
    });
    const configs = Object.values(t.findResources("AWS::Lambda::EventInvokeConfig"));
    expect(configs.length).toBeGreaterThanOrEqual(2);
    expect(configs.every((c) => c.Properties.MaximumRetryAttempts === 0)).toBe(true);
    expect(Object.keys(t.findOutputs("JobsFunction"))).toHaveLength(1);
  });

  it("on prod the jobs Lambda may delete a reader's sign-in and stored mail (#220)", () => {
    const t = synth("prod");
    t.hasResourceProperties("AWS::Lambda::Function", {
      Timeout: 120,
      Environment: { Variables: Match.objectLike({ USER_POOL_ID: Match.anyValue() }) },
    });
    const statements = Object.values(t.findResources("AWS::IAM::Policy")).flatMap(
      (p) => p.Properties.PolicyDocument.Statement as { Action: unknown }[],
    );
    const actions = JSON.stringify(statements.map((s) => s.Action));
    expect(actions).toContain("cognito-idp:AdminDeleteUser");
    expect(actions).toContain("cognito-idp:ListUsers");
    expect(actions).toContain("s3:DeleteObject");
    // Dev has no user pool.
    const dev = synth("dev").findResources("AWS::Lambda::Function");
    expect(JSON.stringify(dev)).not.toContain("USER_POOL_ID");
  });

  it("prod settles due predictions in an hourly round, each reader at their 07:00 (#139, #211)", () => {
    synth("prod").hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "cron(0 * * * ? *)",
      Target: Match.objectLike({
        Input: JSON.stringify({ kind: "daily" }),
        RetryPolicy: Match.objectLike({ MaximumRetryAttempts: 0 }),
      }),
    });
  });

  it("ingest, the API and its jobs may call Haiku 4.5 or 5.5 (any US region) and Titan", () => {
    const policies = Object.values(synth("prod").findResources("AWS::IAM::Policy"));
    const statements = policies.flatMap(
      (p) => p.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[],
    );
    const bedrock = statements.filter((st) => JSON.stringify(st.Action).includes("bedrock:"));
    expect(bedrock).toHaveLength(3);
    expect(bedrock.every((st) => st.Action === "bedrock:InvokeModel")).toBe(true);
    const [ingest, ...others] = bedrock;
    for (const st of others) expect(st.Resource).toEqual(ingest!.Resource);
    const resources = JSON.stringify(ingest!.Resource);
    expect(resources).toContain(":inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(resources).toContain(
      ":bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    expect(resources).toContain(":inference-profile/us.anthropic.claude-haiku-5-5");
    expect(resources).toContain(":bedrock:*::foundation-model/anthropic.claude-haiku-5-5");
    expect(resources).toContain("::foundation-model/amazon.titan-embed-text-v2:0");
    expect((ingest!.Resource as unknown[]).length).toBe(5);
  });

  it("ingest reads its Gmail token and the Jev key, and nothing else in SSM (#81)", () => {
    const t = synth("prod");
    const policies = Object.values(t.findResources("AWS::IAM::Policy"));
    const ssm = policies
      .flatMap(
        (p) => p.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[],
      )
      .filter((st) => JSON.stringify(st.Action).includes("ssm:"));
    expect(ssm).toHaveLength(1);
    expect(ssm[0]!.Action).toBe("ssm:GetParameter");
    const resources = JSON.stringify(ssm[0]!.Resource);
    expect(resources).toContain(":parameter/thelibrary/prod/gmail/oauth");
    expect(resources).toContain(":parameter/thelibrary/prod/jev/api-key");
    expect((ssm[0]!.Resource as unknown[]).length).toBe(2);
    t.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({ JEV_PARAM: "/thelibrary/prod/jev/api-key" }),
      },
    });
  });

  it("prod schedule: every 2h 06-22 IST, no retries, enabled", () => {
    synth("prod").hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "cron(0 6-22/2 * * ? *)",
      ScheduleExpressionTimezone: "Asia/Kolkata",
      State: "ENABLED",
      Target: Match.objectLike({ RetryPolicy: Match.objectLike({ MaximumRetryAttempts: 0 }) }),
    });
  });

  it("dev has no schedule and no alarms", () => {
    const t = synth("dev");
    t.resourceCountIs("AWS::Scheduler::Schedule", 0);
    t.resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("prod alarms when no clean run happened in a day (missing data counts)", () => {
    synth("prod").hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "IngestSucceeded",
      Namespace: "TheLibrary",
      ComparisonOperator: "LessThanThreshold",
      Period: 86400,
      TreatMissingData: "breaching",
    });
  });

  it("prod alarms on any ingest error", () => {
    synth("prod").hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Errors",
      Threshold: 1,
      Period: 21600,
    });
  });
});

describe("auth and API (prod)", () => {
  const t = synth("prod");

  it("user pool: one user, no self sign-up, TOTP required, retained", () => {
    t.hasResource("AWS::Cognito::UserPool", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        UserPoolTier: "ESSENTIALS",
        MfaConfiguration: "ON",
        EnabledMfas: ["SOFTWARE_TOKEN_MFA"],
        AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
        DeletionProtection: "ACTIVE",
      }),
    });
  });

  it("an operators group (#224)", () => {
    t.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName: "operators" });
  });

  it("managed login v2 on the fixed prefix, with a branding resource", () => {
    t.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: "thelibrary-sandip",
      ManagedLoginVersion: 2,
    });
    t.hasResourceProperties("AWS::Cognito::ManagedLoginBranding", {
      UseCognitoProvidedValues: true,
    });
  });

  it("public PKCE client with sandip.dev callbacks and revocation", () => {
    t.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid", "email"],
      CallbackURLs: Match.arrayWith(["https://sandip.dev/nutgraf/auth/callback"]),
      LogoutURLs: Match.arrayWith(["https://sandip.dev/nutgraf/"]),
      EnableTokenRevocation: true,
    });
  });

  it("every API route requires a Cognito JWT", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      IdentitySource: ["$request.header.Authorization"],
    });
    t.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "ANY /nutgraf/api/{proxy+}",
      AuthorizationType: "JWT",
    });
    t.resourceCountIs("AWS::ApiGatewayV2::Route", 1);
  });

  it("HTTP API keeps its construct path (replacing it is slow, see spec section 4)", () => {
    expect(Object.keys(t.findResources("AWS::ApiGatewayV2::Api"))[0]).toMatch(
      /^ApiHttp[0-9A-F]{8}$/,
    );
  });
});

describe("dev: no auth surface", () => {
  it("has the API Lambda but no Cognito or HTTP API", () => {
    const t = synth("dev");
    t.resourceCountIs("AWS::Cognito::UserPool", 0);
    t.resourceCountIs("AWS::ApiGatewayV2::Api", 0);
    expect(Object.keys(t.findOutputs("ApiFunction"))).toHaveLength(1);
  });
});
