import * as cdk from '@aws-cdk/core';
import * as crpm from 'crpm';
import * as ecra from '@aws-cdk/aws-ecr-assets'
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as s3 from '@aws-cdk/aws-s3';
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";
import { Handler, Runtime } from '@aws-cdk/aws-lambda';
import { Aws, Duration } from '@aws-cdk/core';
import * as Lambda from "@aws-cdk/aws-lambda";
import * as core from '@aws-cdk/core';
import * as sns from '@aws-cdk/aws-sns';
import * as sqs from '@aws-cdk/aws-sqs';
import * as snsSubs from '@aws-cdk/aws-sns-subscriptions';
import { SqsDestination } from '@aws-cdk/aws-lambda-destinations';
import { AccountPrincipal, AccountRootPrincipal } from '@aws-cdk/aws-iam';

const name = 'Puppeteer'

export class PuppeteerStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    console.log('Stack info: ', cdk.Stack.of(this));

    const bucketProps = crpm.load<s3.CfnBucketProps>(`${__dirname}/../res/storage/s3/bucket/props.yaml`);
    const bucket = new s3.CfnBucket(this, 'Bucket', bucketProps);

    const dockerImage = new ecra.DockerImageAsset(this, 'DockerImage', { directory: '../', exclude: ['node_modules', 'infra'] });

    const jwtSecret = secretsmanager.Secret.fromSecretNameV2(this,
      'AUTOMATION_API_KEY',
      'SecretOfAutomation',
    );

    const fnRoleProps = crpm.load<iam.CfnRoleProps>(`${__dirname}/../res/security-identity-compliance/iam/role-lambda/props.yaml`);
    const fnRole = new iam.CfnRole(this, 'LambdaRole', fnRoleProps);

    const appFnProps = crpm.load<lambda.CfnFunctionProps>(`${__dirname}/../res/compute/lambda/function-puppeteer/props.yaml`);
    // 👇 import existing IAM Role
    const importedRole = iam.Role.fromRoleArn(
      this,
      'imported-role',
      `arn:aws:iam::${cdk.Stack.of(this).account}:role/AllowLambdaAccessToS3AndSQS`,
      { mutable: false },
    );

    appFnProps.code = {
      imageUri: dockerImage.imageUri,
    };
    appFnProps.role = fnRole.attrArn;
    appFnProps.environment = {
      variables: {
        bucketName: bucket.ref,
        AUTOMATION_API_KEY: jwtSecret.secretValueFromJson('AUTOMATION_API_KEY').toString(),
      },
    }

    const appFn = new lambda.CfnFunction(this, 'PuppeteerFunction', appFnProps);

    const imageRepresentation = new lambda.AssetImageCode('../', { exclude: ['node_modules', 'infra'] });

    const app2Fn = new lambda.Function(this, 'PuppeteerFunctionTwo', {
      code: imageRepresentation,
      memorySize: 1920,
      handler: Handler.FROM_IMAGE,
      runtime: Runtime.FROM_IMAGE,
      timeout: Duration.seconds(210),
      role: importedRole,
      environment: {
        bucketName: bucket.ref,
        AUTOMATION_API_KEY: jwtSecret.secretValueFromJson('AUTOMATION_API_KEY').toString(),
      },
    });

    // Define a dead-letter-queue
    const dlq = new sqs.Queue(this, `${name}_DLQ`, {
      queueName: `${name}_DLQ_queue`,
      retentionPeriod: core.Duration.days(14),
    });

    // Define a dead-letter-queue
    const dlqLambda = new sqs.Queue(this, `${name}_LAMBDA_DLQ`, {
      queueName: `${name}_DLQ_LAMBDA`,
      retentionPeriod: core.Duration.days(14),
    });

    // SNS Subscription
    const snsTopic = new sns.Topic(this, `${name}_SNS_Topic`, {
      displayName: 'HAAS API Generate Report Topic',
      topicName: `haasApiReport`,
    });

    //   senderHandler.role?.addToPrincipalPolicy(new iam.PolicyStatement({
    //     resources: [`arn:aws:ssm:eu-central-1:${props.accountId}:parameter/TWILIO_CALLBACK_URL`],
    //     effect: iam.Effect.ALLOW,
    //     actions: ['ssm:GetParameter']
    // }));

    console.log('topic name: ', snsTopic.topicArn);
    snsTopic.addToResourcePolicy(new iam.PolicyStatement({
      resources: [snsTopic.topicArn],
      actions: [
        "SNS:GetTopicAttributes",
        "SNS:SetTopicAttributes",
        "SNS:AddPermission",
        "SNS:RemovePermission",
        "SNS:DeleteTopic",
        "SNS:Subscribe",
        "SNS:ListSubscriptionsByTopic",
        "SNS:Publish"
      ],
      effect: iam.Effect.ALLOW,
      principals: [
        new AccountRootPrincipal(),
        new AccountPrincipal('649621042808'), //TODO: Moet gefixed (dit is Jonathan's accountId)
        new AccountPrincipal(cdk.Stack.of(this).account),
      ],
    }))

    // Define a subscription wrapper for the sender
    const snsLambdaSubscription = new snsSubs.LambdaSubscription(app2Fn, {
      deadLetterQueue: dlq,
    });

    snsTopic.addSubscription(snsLambdaSubscription);

    new cdk.CfnOutput(this, 'ECRImageURI', { value: dockerImage.imageUri });
    new cdk.CfnOutput(this, 'LambdaFunctionName', { value: appFn.ref });
    new cdk.CfnOutput(this, 'LambdaPuppeteerFunctionName', { value: app2Fn.functionName });
    new cdk.CfnOutput(this, 'Sns', { value: snsTopic.topicName });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.ref });
  }
}
