import { App, Tags } from "aws-cdk-lib";
import { REGION, type Stage } from "../lib/config.js";
import { LibraryStack } from "../lib/library-stack.js";

const app = new App();
const stage = app.node.tryGetContext("stage") as Stage | undefined;
if (stage !== "dev" && stage !== "prod") {
  throw new Error("Choose a stage: cdk <command> -c stage=dev  or  -c stage=prod");
}

new LibraryStack(app, `TheLibrary-${stage}`, {
  stage,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION },
  description: `The Library newsletter reader (${stage})`,
});

Tags.of(app).add("project", "thelibrary");
Tags.of(app).add("stage", stage);
