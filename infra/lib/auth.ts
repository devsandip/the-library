import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  CfnUserPoolGroup,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolEmail,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import {
  BASE_PATH,
  COGNITO_DOMAIN_PREFIX,
  MAIL_DOMAIN,
  MAIL_FROM,
  MAIL_FROM_NAME,
  REGION,
} from "./config.js";

export interface AuthProps {
  /** Origins the app is served from; each gets a callback and sign-out URL. */
  origins: string[];
}

/**
 * Single-user Cognito: no self sign-up, TOTP required, managed login on the prefix domain.
 * The branding resource matters: without one, a CloudFormation-created client's managed login
 * page shows an error instead of the sign-in form.
 */
export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly issuer: string;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);
    const stack = Stack.of(this);

    this.userPool = new UserPool(this, "Pool", {
      userPoolName: "thelibrary",
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      // Optional (#223), so readers without an authenticator can sign in with an email code; an
      // account with one keeps it only if it is the account's preferred MFA, which accounts
      // enrolled while MFA was required do not have: set it before this deploys (README,
      // "MFA optional"). Email codes come in a later deploy: Cognito refuses them while MFA is
      // still required, so the two cannot change in one update.
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false, email: false },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      userInvitation: {
        emailSubject: "The Library: your temporary password",
        emailBody:
          "Sign in at https://sandip.dev/nutgraf/ with {username} and the temporary password {####}. You will set your own password and add an authenticator app.",
      },
      // Through SES (#222), not Cognito's own mail and its 50 a day. Cognito makes its
      // service-linked role for SES the first time this deploys.
      email: UserPoolEmail.withSES({
        fromEmail: MAIL_FROM,
        fromName: MAIL_FROM_NAME,
        sesVerifiedDomain: MAIL_DOMAIN,
        sesRegion: REGION,
      }),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Operators (#224) see how the mail runs went and may check the mail now. The owner always
    // may; others are added by hand (README, "The operator group"). The name matches
    // OPERATORS_GROUP in packages/core/src/reader.ts.
    new CfnUserPoolGroup(this, "Operators", {
      userPoolId: this.userPool.userPoolId,
      groupName: "operators",
      description: "Nutgraf operators: Status's mail runs and Check now",
    });

    this.userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: COGNITO_DOMAIN_PREFIX },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    const urls = (suffix: string) => props.origins.map((o) => `${o}${BASE_PATH}${suffix}`);
    this.client = this.userPool.addClient("Web", {
      userPoolClientName: "web",
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL],
        callbackUrls: urls("/auth/callback"),
        logoutUrls: urls("/"),
      },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
    });

    new CfnManagedLoginBranding(this, "Branding", {
      userPoolId: this.userPool.userPoolId,
      clientId: this.client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    this.issuer = `https://cognito-idp.${stack.region}.amazonaws.com/${this.userPool.userPoolId}`;
  }
}
