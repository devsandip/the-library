import { App, Tags } from "aws-cdk-lib";
import { CiStack } from "../lib/ci-stack.js";
import { REGION, type Stage } from "../lib/config.js";
import { LibraryStack } from "../lib/library-stack.js";

const app = new App();
const stage = app.node.tryGetContext("stage") as Stage | "ci" | undefined;
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

if (stage === "ci") {
  // The role GitHub Actions deploys with (docs/features/pipeline.md); deployed by hand, once.
  new CiStack(app, "TheLibrary-ci", {
    env,
    description: "The Library: the role GitHub Actions deploys with",
    tags: { project: "thelibrary", stage },
  });
} else if (stage === "dev" || stage === "prod") {
  new LibraryStack(app, `TheLibrary-${stage}`, {
    stage,
    env,
    description: `The Library newsletter reader (${stage})`,
    // Stack-level tags (explicitStackTags is on); the dev tooling's safety guard checks "stage".
    tags: { project: "thelibrary", stage },
  });
} else {
  throw new Error(
    "Choose a stage: cdk <command> -c stage=dev  or  -c stage=prod  (or -c stage=ci for the deploy role)",
  );
}

// Resource-level tags, for cost allocation.
Tags.of(app).add("project", "thelibrary");
Tags.of(app).add("stage", stage);
