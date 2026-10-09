import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { Api } from "./api.js";
import { BASE_PATH, type Stage } from "./config.js";
import { Web } from "./web.js";

export interface LibraryStackProps extends StackProps {
  stage: Stage;
}

/**
 * One stack per stage. prod: everything. dev: data + Lambdas only (no CloudFront, Cognito or
 * web), used by integration tests. See docs/architecture.md section 9.
 */
export class LibraryStack extends Stack {
  constructor(scope: Construct, id: string, props: LibraryStackProps) {
    super(scope, id, props);

    if (props.stage === "prod") {
      const api = new Api(this, "Api", { stage: props.stage });
      const web = new Web(this, "Web", {
        stage: props.stage,
        httpApi: api.httpApi,
        config: { stage: props.stage, apiBase: `${BASE_PATH}/api` },
      });

      new CfnOutput(this, "DistributionDomain", {
        value: web.distribution.distributionDomainName,
      });
      new CfnOutput(this, "ApiEndpoint", { value: api.httpApi.apiEndpoint });
    }
  }
}
