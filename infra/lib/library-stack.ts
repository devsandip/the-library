import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import { Api } from "./api.js";
import { Auth } from "./auth.js";
import {
  ALARM_EMAIL,
  BASE_PATH,
  COGNITO_DOMAIN,
  INGEST_SCHEDULE_ENABLED,
  PUBLIC_ORIGIN,
  type Stage,
} from "./config.js";
import { Data } from "./data.js";
import { Ingest } from "./ingest.js";
import { Web } from "./web.js";

export interface LibraryStackProps extends StackProps {
  stage: Stage;
}

/** Local Vite dev server; gets its own Cognito callback URL. */
const LOCAL_ORIGIN = "http://localhost:5173";

/**
 * One stack per stage. prod: everything. dev: table, bucket and Lambdas only (no CloudFront,
 * Cognito or web), used by integration tests. See docs/architecture.md section 9.
 */
export class LibraryStack extends Stack {
  constructor(scope: Construct, id: string, props: LibraryStackProps) {
    super(scope, id, props);
    const { stage } = props;
    const prod = stage === "prod";

    const data = new Data(this, "Data", { stage });

    let alarmTopic: Topic | undefined;
    if (prod) {
      alarmTopic = new Topic(this, "Alarms", { displayName: "The Library alarms" });
      alarmTopic.addSubscription(new EmailSubscription(ALARM_EMAIL));
    }

    const ingest = new Ingest(this, "Ingest", {
      stage,
      table: data.table,
      content: data.content,
      alarmTopic,
      scheduleEnabled: INGEST_SCHEDULE_ENABLED,
    });

    const api = new Api(this, "Api", {
      stage,
      table: data.table,
      content: data.content,
      ingestFn: ingest.fn,
    });

    new CfnOutput(this, "Stage", { value: stage });
    new CfnOutput(this, "TableName", { value: data.table.tableName });
    new CfnOutput(this, "ContentBucket", { value: data.content.bucketName });
    new CfnOutput(this, "IngestFunction", { value: ingest.fn.functionName });
    new CfnOutput(this, "ApiFunction", { value: api.fn.functionName });
    new CfnOutput(this, "JobsFunction", { value: api.jobsFn.functionName });

    if (!prod) return;

    // Order matters: distribution -> Cognito client (callback URLs) -> authorizer and config.json.
    const web = new Web(this, "Web", { stage, httpApi: api.httpApi! });
    const distributionOrigin = `https://${web.distribution.distributionDomainName}`;
    const auth = new Auth(this, "Auth", {
      origins: [PUBLIC_ORIGIN, distributionOrigin, LOCAL_ORIGIN],
    });
    api.addRoutes(
      new HttpJwtAuthorizer("Cognito", auth.issuer, {
        jwtAudience: [auth.client.userPoolClientId],
      }),
    );
    web.deploy({
      stage,
      apiBase: `${BASE_PATH}/api`,
      cognitoDomain: COGNITO_DOMAIN,
      clientId: auth.client.userPoolClientId,
    });

    new CfnOutput(this, "DistributionDomain", { value: web.distribution.distributionDomainName });
    new CfnOutput(this, "ApiEndpoint", { value: api.httpApi!.apiEndpoint });
    new CfnOutput(this, "UserPoolId", { value: auth.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: auth.client.userPoolClientId });
    new CfnOutput(this, "CognitoDomain", { value: COGNITO_DOMAIN });
  }
}
