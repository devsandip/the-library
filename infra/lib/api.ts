import { HttpApi, HttpMethod, HttpStage } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BASE_PATH, type Stage } from "./config.js";
import { nodeFunction } from "./functions.js";

export interface ApiProps {
  stage: Stage;
}

/** HTTP API under /thelibrary/api. R2: temporary echo Lambda, no authorizer (replaced in R6). */
export class Api extends Construct {
  readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    this.httpApi = new HttpApi(this, "HttpApi", {
      apiName: `thelibrary-${props.stage}`,
      createDefaultStage: false,
    });
    new HttpStage(this, "DefaultStage", {
      httpApi: this.httpApi,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 10, burstLimit: 20 },
    });

    const echo = nodeFunction(this, "EchoFn", {
      entry: "services/api/src/echo.ts",
      logRemoval: RemovalPolicy.DESTROY,
    });
    this.httpApi.addRoutes({
      path: `${BASE_PATH}/api/{proxy+}`,
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration("EchoIntegration", echo),
    });
  }
}
