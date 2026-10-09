import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, Billing, ProjectionType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { Stage } from "./config.js";

export interface DataProps {
  stage: Stage;
}

/**
 * The table and the content bucket. prod keeps both on stack deletion and protects the table;
 * dev is disposable. All four GSIs exist from the first deploy because CloudFormation adds only
 * one GSI per update (docs/architecture.md section 5).
 */
export class Data extends Construct {
  readonly table: TableV2;
  readonly content: Bucket;

  constructor(scope: Construct, id: string, props: DataProps) {
    super(scope, id);
    const prod = props.stage === "prod";
    const removalPolicy = prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const str = (name: string) => ({ name, type: AttributeType.STRING });

    this.table = new TableV2(this, "Table", {
      partitionKey: str("pk"),
      sortKey: str("sk"),
      billing: Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: prod },
      deletionProtection: prod,
      removalPolicy,
      globalSecondaryIndexes: ["gsi1", "gsi2", "gsi3", "gsi4"].map((name) => ({
        indexName: name,
        partitionKey: str(`${name}pk`),
        sortKey: str(`${name}sk`),
        projectionType: ProjectionType.ALL,
      })),
    });

    this.content = new Bucket(this, "Content", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !prod,
      lifecycleRules: [
        { id: "raw-30d", prefix: "raw/", expiration: Duration.days(30) },
        { id: "html-365d", prefix: "html/", expiration: Duration.days(365) },
        { id: "abort-uploads", abortIncompleteMultipartUploadAfter: Duration.days(7) },
      ],
    });
  }
}
