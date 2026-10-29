import { Duration, RemovalPolicy, TimeZone } from "aws-cdk-lib";
import {
  HttpApi,
  HttpMethod,
  HttpStage,
  type IHttpRouteAuthorizer,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { Construct } from "constructs";
import { BASE_PATH, READER_KEYS, type Stage } from "./config.js";
import { bedrockModels, nodeFunction } from "./functions.js";

export interface ApiProps {
  stage: Stage;
  table: TableV2;
  content: Bucket;
  ingestFn: NodejsFunction;
}

/**
 * The reader API Lambda. prod also gets the HTTP API it sits behind; dev integration tests
 * invoke the Lambda directly.
 */
export class Api extends Construct {
  readonly fn: NodejsFunction;
  /** Deep dives that may take longer than the API's 28 seconds (#23), started by the API. */
  readonly jobsFn: NodejsFunction;
  readonly httpApi?: HttpApi;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    this.jobsFn = nodeFunction(this, "JobsFn", {
      entry: "services/api/src/jobs.ts",
      logRemoval: RemovalPolicy.DESTROY,
      memorySize: 512,
      // A source check reads pages of at most 8 seconds each and calls Claude; the API calls a
      // run stopped after 3 minutes.
      timeout: Duration.minutes(2),
      // The API starts a job once; a failure is recorded on the run for the reader to retry.
      retryAttempts: 0,
      environment: {
        TABLE_NAME: props.table.tableName,
        BUCKET_NAME: props.content.bucketName,
        STAGE: props.stage,
        READER_KEYS: READER_KEYS[props.stage] ? "1" : "0",
        NODE_OPTIONS: "--enable-source-maps",
      },
    });
    props.table.grantReadWriteData(this.jobsFn);
    props.content.grantRead(this.jobsFn);
    this.jobsFn.addToRolePolicy(bedrockModels(this));

    this.fn = nodeFunction(this, "Fn", {
      entry: "services/api/src/handler.ts",
      logRemoval: RemovalPolicy.DESTROY,
      memorySize: 512,
      // Most answers take milliseconds. A timeline (#19) is one Claude call of 4 to 9 seconds,
      // after a corpus read of about 3 on a cold start; HTTP API waits at most 30.
      timeout: Duration.seconds(28),
      environment: {
        TABLE_NAME: props.table.tableName,
        BUCKET_NAME: props.content.bucketName,
        INGEST_FUNCTION: props.ingestFn.functionName,
        JOBS_FUNCTION: this.jobsFn.functionName,
        STAGE: props.stage,
        READER_KEYS: READER_KEYS[props.stage] ? "1" : "0",
        NODE_OPTIONS: "--enable-source-maps",
      },
    });
    props.table.grantReadWriteData(this.fn);
    props.content.grantRead(this.fn);
    props.ingestFn.grantInvoke(this.fn);
    this.jobsFn.grantInvoke(this.fn);
    // Search by meaning (#53): Titan embeds the query. How this evolved (#19): Claude writes a
    // story's timeline when the reader asks.
    this.fn.addToRolePolicy(bedrockModels(this));

    if (props.stage !== "prod") return;

    // Who called it (#139): settle the predictions that came due, once a day after the first
    // ingest run. A failed day is not re-run; tomorrow's takes what is left.
    new Schedule(this, "SettleDaily", {
      description: "The Library: settle due predictions, daily 07:30 IST",
      schedule: ScheduleExpression.cron({
        minute: "30",
        hour: "7",
        timeZone: TimeZone.ASIA_KOLKATA,
      }),
      target: new LambdaInvoke(this.jobsFn, {
        input: ScheduleTargetInput.fromObject({ kind: "settle" }),
        retryAttempts: 0,
      }),
    });

    // Keep this construct ID stable: a new HTTP API takes many minutes to get a DNS record
    // (docs/architecture.md section 4). "Http" replaced the original "HttpApi" on 2026-10-09.
    this.httpApi = new HttpApi(this, "Http", {
      apiName: `thelibrary-${props.stage}`,
      createDefaultStage: false,
    });
    new HttpStage(this, "DefaultStage", {
      httpApi: this.httpApi,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 10, burstLimit: 20 },
    });
  }

  /** One authorized catch-all route; the Lambda routes internally. */
  addRoutes(authorizer: IHttpRouteAuthorizer) {
    if (!this.httpApi) throw new Error("addRoutes needs the prod HTTP API");
    this.httpApi.addRoutes({
      path: `${BASE_PATH}/api/{proxy+}`,
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration("ApiIntegration", this.fn),
      authorizer,
    });
  }
}
