import { Context } from 'aws-lambda';
import * as aws from 'aws-sdk';
import * as puppeteer from 'puppeteer';
import axios from 'axios';

const authenticateLambda = async (apiUrl: string, authenticateEmail: string, workspaceEmail: string, authorizationHeader: string) => {
  return axios.post(apiUrl, {
    query: `
    mutation authenticateLambda($input: AuthenticateLambdaInput) {
      authenticateLambda(input: $input)
    }`,
    operationName: "authenticateLambda",
    variables: {
      input: { "authenticateEmail": authenticateEmail, "workspaceEmail": workspaceEmail }
    }
  }, {
    headers: {
      lambda: authorizationHeader,
    },
  })
    .then(function (response) {
      console.log('RESPONSE: ', response.data);
      return response.data;
    })
    .catch(function (error) {
      console.log('ERROR AXIOS', error);
    });
}

export const lambdaHandler = async (event: any, context: Context) => {
  const url = event.url;
  console.log(`URL: ${url}`);
  console.log('ENV: ', process.env);

  const apiUrl = event.API_URL;
  const dashboardUrl = event.DASHBOARD_URL;
  const authenticateEmail = event.AUTHENTICATE_EMAIL;
  const workspaceEmail = event.WORKSPACE_EMAIL;
  const reportUrl = event.REPORT_URL

  const authorizationKey = process.env.AUTOMATION_API_KEY;

  if (!reportUrl) return {
    statusCode: 400,
    body: 'Error: No report url available!'
  };

  if (!apiUrl) return {
    statusCode: 400,
    body: 'Error: No api url available!'
  };

  if (!authorizationKey) return {
    statusCode: 400,
    body: 'Error: No authorization api key available!'
  };

  if (!dashboardUrl) return {
    statusCode: 400,
    body: 'Error: No dashboard url available!'
  };

  const result = await authenticateLambda(apiUrl, authenticateEmail, workspaceEmail, authorizationKey);
  console.log('result: ', result);

  if (!result?.authenticateLambda) return {
    statusCode: 400,
    body: 'Error: No authenticate token for provided workspace email available!'
  }

  const verifyUrl = `${dashboardUrl}/verify_token?token=${result?.authenticateLambda}`

  let attempt = 0;
  do {
    attempt++;
    try {
      const browser = await puppeteer.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--single-process'
        ]
      });
      const browserVersion = await browser.version()
      console.log(`Started ${browserVersion}`);
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60000);
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(verifyUrl, { waitUntil: 'networkidle0' });
      // const screenshot = await page.screenshot({ fullPage: true }) as Buffer;
      await page.goto(reportUrl, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({ format: 'A4' }) as Buffer;
      await page.close();
      await browser.close();

      const s3 = new aws.S3();
      const key = `screenshots/${context.awsRequestId}.pdf`;
      console.log(`Screenshot location: ${event.bucketName}/${key}`);
      await s3.putObject({
        Bucket: event.bucketName,
        Key: key,
        Body: pdf,
        ContentType: 'image'
      }).promise();

      return {
        statusCode: 200,
        body: key
      }
    } catch (err) {
      console.log('Error:', err);
      if (attempt <= 3) {
        console.log('Trying again');
      }
    }
  } while (attempt <= 3)

  return {
    statusCode: 400,
    body: 'Error'
  }
}
