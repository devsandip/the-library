import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import {
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

/** The repository whose main branch deploys (docs/features/pipeline.md). */
export const GITHUB_REPO = "devsandip/the-library";
/**
 * How GitHub names the repository in its tokens. Immutable subjects are on, so the owner and the
 * repository carry their IDs as well, and a renamed or recreated repository cannot match.
 */
export const GITHUB_SUBJECT = "repo:devsandip@19489947/the-library@1411266741";
/** The GitHub environments the deploy jobs run in; GitHub lets only main use them. */
export const GITHUB_ENVIRONMENTS = ["dev", "prod"] as const;
export const DEPLOY_ROLE_NAME = "TheLibrary-github-deploy";
/** GitHub's sign-in to AWS. The account already has it (another project created it). */
const GITHUB_OIDC = "token.actions.githubusercontent.com";

/**
 * The role GitHub Actions deploys with. Deployed by hand (`pnpm cdk deploy -c stage=ci`); the
 * pipeline never deploys this stack. It trusts only this repository's dev and prod environments,
 * and can hand work only to CDK's own bootstrap roles, plus what the integration tests do to the
 * dev stack. The CDK roles can change anything in the account, so the real gate is main itself:
 * only a merged pull request with a passing check runs a deploy.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const { account, region, partition } = this;

    const github = OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHub",
      `arn:${partition}:iam::${account}:oidc-provider/${GITHUB_OIDC}`,
    );
    const role = new Role(this, "Deploy", {
      roleName: DEPLOY_ROLE_NAME,
      description: `GitHub Actions: deploys The Library from ${GITHUB_REPO} main`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new WebIdentityPrincipal(github.openIdConnectProviderArn, {
        StringEquals: {
          [`${GITHUB_OIDC}:aud`]: "sts.amazonaws.com",
          [`${GITHUB_OIDC}:sub`]: GITHUB_ENVIRONMENTS.map(
            (env) => `${GITHUB_SUBJECT}:environment:${env}`,
          ),
        },
      }),
    });

    // `cdk deploy` does its work through the bootstrap roles: deploy, publish assets, look up.
    role.addToPolicy(
      new PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:${partition}:iam::${account}:role/cdk-hnb659fds-*-${account}-${region}`],
      }),
    );

    // `pnpm test:int` on dev: it finds the stack by its outputs, wipes and seeds the table, reads
    // and writes raw mail, invokes the Lambdas, and calls the models ingest calls (keep these in
    // step with the ingest role in lib/ingest.ts).
    role.addToPolicy(
      new PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [`arn:${partition}:cloudformation:${region}:${account}:stack/TheLibrary-dev/*`],
      }),
    );
    const table = `arn:${partition}:dynamodb:${region}:${account}:table/TheLibrary-dev-*`;
    role.addToPolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ],
        resources: [table, `${table}/index/*`],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [`arn:${partition}:s3:::thelibrary-dev-*/*`],
      }),
    );
    // Without it a missing object reads as 403 rather than 404.
    role.addToPolicy(
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [`arn:${partition}:s3:::thelibrary-dev-*`],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [`arn:${partition}:lambda:${region}:${account}:function:TheLibrary-dev-*`],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${partition}:bedrock:${region}:${account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${partition}:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${partition}:bedrock:${region}:${account}:inference-profile/us.anthropic.claude-haiku-5-5`,
          `arn:${partition}:bedrock:*::foundation-model/anthropic.claude-haiku-5-5`,
          `arn:${partition}:bedrock:${region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );

    new CfnOutput(this, "DeployRoleArn", {
      value: role.roleArn,
      description: "The repository variable AWS_ROLE_ARN on GitHub",
    });
  }
}
