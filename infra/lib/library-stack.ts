import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import { Api } from "./api.js";
import { ALARM_EMAIL, BASE_PATH, INGEST_SCHEDULE_ENABLED, type Stage } from "./config.js";
import { Data } from "./data.js";
import { Ingest } from "./ingest.js";
import { Web } from "./web.js";

export interface LibraryStackProps extends StackProps {
  stage: Stage;
}

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

    new CfnOutput(this, "Stage", { value: stage });
    new CfnOutput(this, "TableName", { value: data.table.tableName });
    new CfnOutput(this, "ContentBucket", { value: data.content.bucketName });
    new CfnOutput(this, "IngestFunction", { value: ingest.fn.functionName });

    if (prod) {
      const api = new Api(this, "Api", { stage });
      const web = new Web(this, "Web", {
        stage,
        httpApi: api.httpApi,
        config: { stage, apiBase: `${BASE_PATH}/api` },
      });
      new CfnOutput(this, "DistributionDomain", {
        value: web.distribution.distributionDomainName,
      });
      new CfnOutput(this, "ApiEndpoint", { value: api.httpApi.apiEndpoint });
    }
  }
}
