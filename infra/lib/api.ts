import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  HttpApi,
  HttpMethod,
  HttpStage,
  type IHttpRouteAuthorizer,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { BASE_PATH, type Stage } from "./config.js";
import { nodeFunction } from "./functions.js";

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
  readonly httpApi?: HttpApi;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    this.fn = nodeFunction(this, "Fn", {
      entry: "services/api/src/handler.ts",
      logRemoval: RemovalPolicy.DESTROY,
      memorySize: 512,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: props.table.tableName,
        BUCKET_NAME: props.content.bucketName,
        INGEST_FUNCTION: props.ingestFn.functionName,
        STAGE: props.stage,
        NODE_OPTIONS: "--enable-source-maps",
      },
    });
    props.table.grantReadWriteData(this.fn);
    props.content.grantRead(this.fn);
    props.ingestFn.grantInvoke(this.fn);
    // Search by meaning (#53): Titan embeds the query, in this region. Keep in step with
    // EMBED_MODEL in packages/core/src/vectors.ts.
    const stack = Stack.of(this);
    this.fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${stack.partition}:bedrock:${stack.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );

    if (props.stage !== "prod") return;

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
