import { Duration, RemovalPolicy, Stack, TimeZone } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
import type { Stage } from "./config.js";
import { nodeFunction } from "./functions.js";

export interface IngestProps {
  stage: Stage;
  table: TableV2;
  content: Bucket;
  /** prod only: alarm notifications. */
  alarmTopic?: ITopic;
  /** prod only: the 2-hourly schedule. Created disabled until Gmail is connected (R5). */
  scheduleEnabled?: boolean;
}

export const gmailParamName = (stage: Stage) => `/thelibrary/${stage}/gmail/oauth`;

export class Ingest extends Construct {
  readonly fn: NodejsFunction;

  constructor(scope: Construct, id: string, props: IngestProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const param = gmailParamName(props.stage);

    this.fn = nodeFunction(this, "Fn", {
      entry: "services/ingest/src/handler.ts",
      logRemoval: RemovalPolicy.DESTROY,
      memorySize: 512,
      timeout: Duration.minutes(10),
      retryAttempts: 0, // async invokes (schedule, "refresh now") never re-run a failed ingest
      reservedConcurrentExecutions: 1, // one run at a time
      environment: {
        TABLE_NAME: props.table.tableName,
        BUCKET_NAME: props.content.bucketName,
        GMAIL_PARAM: param,
        STAGE: props.stage,
        NODE_OPTIONS: "--enable-source-maps",
      },
    });
    props.table.grantReadWriteData(this.fn);
    props.content.grantReadWrite(this.fn); // write new issues; read raw/ for reprocess
    // SecureString encrypted with the AWS-managed aws/ssm key: ssm:GetParameter is enough.
    this.fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:${stack.partition}:ssm:${stack.region}:${stack.account}:parameter${param}`,
        ],
      }),
    );

    // Enrichment (keep in step with MODELS in services/ingest/src/bedrock.ts): Claude Haiku 4.5,
    // or 5.5 once the account has it, through US cross-region inference profiles, which may run in
    // any US region; and Titan Text Embeddings V2 in this region.
    this.fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${stack.partition}:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/us.anthropic.claude-haiku-5-5`,
          `arn:${stack.partition}:bedrock:*::foundation-model/anthropic.claude-haiku-5-5`,
          `arn:${stack.partition}:bedrock:${stack.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );

    if (props.stage !== "prod") return;

    new Schedule(this, "Every2h", {
      description: "The Library ingest, every 2 hours 06:00-22:00 IST",
      schedule: ScheduleExpression.cron({
        minute: "0",
        hour: "6-22/2",
        timeZone: TimeZone.ASIA_KOLKATA,
      }),
      target: new LambdaInvoke(this.fn, { retryAttempts: 0 }),
      enabled: props.scheduleEnabled ?? false,
    });

    if (props.alarmTopic) {
      const errors = new Alarm(this, "ErrorsAlarm", {
        alarmDescription: "The Library ingest failed (Gmail token, Gmail API, or a message error).",
        metric: this.fn.metricErrors({ period: Duration.hours(6) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
      errors.addAlarmAction(new SnsAction(props.alarmTopic));

      // Staleness: no clean run in a day. Only once the schedule runs, or it would fire at once.
      if (props.scheduleEnabled) {
        const stale = new Alarm(this, "StaleAlarm", {
          alarmDescription: "The Library has not completed a clean ingest run in 24 hours.",
          metric: new Metric({
            namespace: "TheLibrary",
            metricName: "IngestSucceeded",
            dimensionsMap: { Stage: props.stage },
            statistic: "Sum",
            period: Duration.days(1),
          }),
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
          treatMissingData: TreatMissingData.BREACHING,
        });
        stale.addAlarmAction(new SnsAction(props.alarmTopic));
      }
    }
  }
}
