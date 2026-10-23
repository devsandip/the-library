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
import { bedrockModels, nodeFunction } from "./functions.js";

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
/** TypeSafe's key for Jev (#81). Sandip stores it by hand; dev has none. */
export const jevParamName = (stage: Stage) => `/thelibrary/${stage}/jev/api-key`;

export class Ingest extends Construct {
  readonly fn: NodejsFunction;

  constructor(scope: Construct, id: string, props: IngestProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const param = gmailParamName(props.stage);
    const jevParam = jevParamName(props.stage);

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
        JEV_PARAM: jevParam,
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
        resources: [param, jevParam].map(
          (name) => `arn:${stack.partition}:ssm:${stack.region}:${stack.account}:parameter${name}`,
        ),
      }),
    );

    // Enrichment, the story index and the day in brief: Claude and Titan.
    this.fn.addToRolePolicy(bedrockModels(this));

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
