import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { CiStack } from "../lib/ci-stack.js";

const t = Template.fromStack(
  new CiStack(new App(), "TheLibrary-ci", {
    env: { account: "111111111111", region: "us-east-1" },
  }),
);

interface Statement {
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
}
const statements = (type: string, doc: string): Statement[] =>
  Object.values(t.findResources(type)).flatMap(
    (r) =>
      (r as { Properties: Record<string, { Statement: Statement[] }> }).Properties[doc]!.Statement,
  );

describe("ci stack: the role GitHub Actions deploys with", () => {
  it("trusts only this repository's dev and prod environments, through the account's provider", () => {
    t.resourceCountIs("AWS::IAM::Role", 1);
    t.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    t.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
    const trust = statements("AWS::IAM::Role", "AssumeRolePolicyDocument");
    expect(trust).toHaveLength(1);
    expect(trust[0]!.Action).toBe("sts:AssumeRoleWithWebIdentity");
    expect(trust[0]!.Condition).toEqual({
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": [
          "repo:devsandip@19489947/the-library@1411266741:environment:dev",
          "repo:devsandip@19489947/the-library@1411266741:environment:prod",
        ],
      },
    });
  });

  it("hands deploys to CDK's bootstrap roles and touches only the dev stack otherwise", () => {
    const allowed = statements("AWS::IAM::Policy", "PolicyDocument");
    for (const s of allowed) expect(s.Resource).not.toBe("*");
    const assume = allowed.find((s) => s.Action === "sts:AssumeRole")!;
    expect(JSON.stringify(assume.Resource)).toContain(
      ":role/cdk-hnb659fds-*-111111111111-us-east-1",
    );
    const actions = allowed.flatMap((s) => s.Action);
    expect(actions.filter((a) => a.startsWith("iam:"))).toEqual([]);
    for (const s of allowed.filter((x) => x.Action !== "sts:AssumeRole")) {
      expect(JSON.stringify(s.Resource)).toMatch(/TheLibrary-dev|thelibrary-dev-|bedrock/);
    }
  });
});
