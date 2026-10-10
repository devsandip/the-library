import { existsSync } from "node:fs";
import { join } from "node:path";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import type { IHttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import {
  AccessLevel,
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  OriginRequestPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, CacheControl, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { BASE_PATH, CONTENT_SECURITY_POLICY, type Stage } from "./config.js";
import { REPO_ROOT } from "./functions.js";

/**
 * Viewer-request function for the static behavior. Everything under /thelibrary/ that is not a
 * real file becomes index.html (SPA routing). about/privacy/terms are public static pages that
 * Google's OAuth consent screen links to; they hold no user data. Redirects use a relative
 * Location so a request proxied through sandip.dev never bounces to the cloudfront.net domain.
 */
const SPA_FUNCTION = `
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === "/" || uri === "${BASE_PATH}") {
    return { statusCode: 301, statusDescription: "Moved Permanently", headers: { location: { value: "${BASE_PATH}/" } } };
  }
  if (uri.indexOf("${BASE_PATH}/") !== 0) {
    return { statusCode: 404, statusDescription: "Not Found" };
  }
  if (
    uri.indexOf("${BASE_PATH}/assets/") === 0 ||
    uri === "${BASE_PATH}/config.json" ||
    uri === "${BASE_PATH}/favicon.svg" ||
    uri === "${BASE_PATH}/favicon-32.png" ||
    uri === "${BASE_PATH}/apple-touch-icon.png" ||
    uri === "${BASE_PATH}/about.html" ||
    uri === "${BASE_PATH}/privacy.html" ||
    uri === "${BASE_PATH}/terms.html"
  ) {
    return request;
  }
  request.uri = "${BASE_PATH}/index.html";
  return request;
}
`;

const PLACEHOLDER_SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>The Library</title></head><body>The Library: web/dist was not built when this was deployed.</body></html>`;

export interface WebProps {
  stage: Stage;
  httpApi: IHttpApi;
}

export class Web extends Construct {
  readonly distribution: Distribution;
  readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id);
    const stack = Stack.of(this);

    this.bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY, // rebuilt from source on every deploy
      autoDeleteObjects: true,
    });

    const headers = new ResponseHeadersPolicy(this, "Headers", {
      comment: `The Library ${props.stage}: security headers + noindex`,
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: CONTENT_SECURITY_POLICY, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: false,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.NO_REFERRER, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: "X-Robots-Tag", value: "noindex, nofollow", override: true }],
      },
    });

    const spa = new CloudFrontFunction(this, "SpaRouting", {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(SPA_FUNCTION),
      comment: "SPA routing under /thelibrary/",
    });

    const apiDomain = `${props.httpApi.apiId}.execute-api.${stack.region}.${stack.urlSuffix}`;

    this.distribution = new Distribution(this, "Distribution", {
      comment: `The Library (${props.stage})`,
      priceClass: PriceClass.PRICE_CLASS_200, // includes India
      httpVersion: HttpVersion.HTTP2_AND_3,
      // With LIST access, a bare "/" must never reach S3 as a bucket listing. The SPA function
      // already redirects "/", this is the second guard.
      defaultRootObject: `${BASE_PATH.slice(1)}/index.html`,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket, {
          originAccessLevels: [AccessLevel.READ, AccessLevel.LIST], // LIST: missing keys 404, not 403
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        functionAssociations: [{ function: spa, eventType: FunctionEventType.VIEWER_REQUEST }],
        compress: true,
      },
      additionalBehaviors: {
        [`${BASE_PATH}/api/*`]: {
          origin: new HttpOrigin(apiDomain),
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
          compress: true,
        },
      },
    });
  }

  /**
   * Two deployments, neither prunes: hashed assets are immutable (old chunks stay for open tabs);
   * the shell and config.json are no-cache because Amplify's cache only clears on Amplify deploys.
   * `config` becomes /thelibrary/config.json and may contain deploy-time tokens.
   */
  deploy(config: Record<string, unknown>) {
    const dist = join(REPO_ROOT, "web", "dist");
    const built = existsSync(join(dist, "index.html"));
    const prefix = BASE_PATH.slice(1);

    let assets: BucketDeployment | undefined;
    if (built && existsSync(join(dist, "assets"))) {
      assets = new BucketDeployment(this, "DeployAssets", {
        sources: [Source.asset(join(dist, "assets"))],
        destinationBucket: this.bucket,
        destinationKeyPrefix: `${prefix}/assets/`,
        cacheControl: [CacheControl.fromString("public, max-age=31536000, immutable")],
        prune: false,
        memoryLimit: 512,
      });
    }

    const shell = new BucketDeployment(this, "DeployShell", {
      sources: [
        built
          ? Source.asset(dist, { exclude: ["assets", "assets/**"] })
          : Source.data("index.html", PLACEHOLDER_SHELL),
        Source.jsonData("config.json", config),
      ],
      destinationBucket: this.bucket,
      destinationKeyPrefix: `${prefix}/`,
      cacheControl: [CacheControl.fromString("no-cache")],
      prune: false,
      memoryLimit: 512,
      distribution: this.distribution,
      distributionPaths: [`${BASE_PATH}/index.html`, `${BASE_PATH}/config.json`],
    });
    if (assets) shell.node.addDependency(assets);
  }
}
