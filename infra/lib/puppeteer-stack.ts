import * as cdk from '@aws-cdk/core';
import * as crpm from 'crpm';
import * as ecra from '@aws-cdk/aws-ecr-assets'
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as s3 from '@aws-cdk/aws-s3';
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";

export class PuppeteerStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucketProps = crpm.load<s3.CfnBucketProps>(`${__dirname}/../res/storage/s3/bucket/props.yaml`);
    const bucket = new s3.CfnBucket(this, 'Bucket', bucketProps);

    const dockerImage = new ecra.DockerImageAsset(this, 'DockerImage', { directory: '../', exclude: ['node_modules', 'infra'] });

    const jwtSecret = secretsmanager.Secret.fromSecretNameV2(this,
      'AUTOMATION_API_KEY',
      'SecretOfAutomation',
    );

    console.log('jwt secret: ', jwtSecret.secretValueFromJson('AUTOMATION_API_KEY').toString());

    const fnRoleProps = crpm.load<iam.CfnRoleProps>(`${__dirname}/../res/security-identity-compliance/iam/role-lambda/props.yaml`);
    const fnRole = new iam.CfnRole(this, 'LambdaRole', fnRoleProps);

    const appFnProps = crpm.load<lambda.CfnFunctionProps>(`${__dirname}/../res/compute/lambda/function-puppeteer/props.yaml`);
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

    new cdk.CfnOutput(this, 'ECRImageURI', { value: dockerImage.imageUri });
    new cdk.CfnOutput(this, 'LambdaFunctionName', { value: appFn.ref });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.ref });
  }
}
