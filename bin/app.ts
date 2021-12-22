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

// const getCustomerData = async (apiUrl: string, customerSlug: string, userId: string, bearerToken: string) => {
//   return axios.post(apiUrl, {
//     query: `
//     query getCustomerOfUser($input: UserOfCustomerInput) {
//       UserOfCustomer(input: $input) {
//         customer {
//           id
//           name
//           slug
//           settings {
//             id
//             logoUrl
//             colourSettings {
//               id
//               primary
//             }
//           }
//           campaigns {
//             id
//             label
//           }
//         }
//         role {
//           name
//           permissions
//         }
//         user {
//           id
//         }
//       }
//     }
//     `,
//     operationName: "getCustomerOfUser",
//     variables: {
//       input: {
//         "customerSlug": customerSlug,
//         "userId": userId
//       }
//     }
//   }, {
//     headers: {
//       Authorization: `Bearer ${bearerToken}`,
//     },
//   })
//     .then(function (response) {
//       console.log('RESPONSE: ', response.data);
//       return response.data;
//     })
//     .catch(function (error) {
//       console.log('ERROR AXIOS', error);
//     });
// }



export const lambdaHandler = async (event: any, context: Context) => {
  const url = event.url;
  console.log(`URL: ${url}`);
  console.log('ENV: ', process.env);

  const apiUrl: string = event.API_URL;
  const dashboardUrl: string = event.DASHBOARD_URL;
  const authenticateEmail: string = event.AUTHENTICATE_EMAIL;
  const workspaceEmail: string = event.WORKSPACE_EMAIL;
  const reportUrl: string = event.REPORT_URL

  const authorizationKey: string = process.env.AUTOMATION_API_KEY;

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
  console.log('result: ', result?.data);

  if (!result?.data.authenticateLambda) return {
    statusCode: 400,
    body: 'Error: No authenticate token for provided workspace email available!'
  }

  // const customerResult = await getCustomerData(apiUrl, 'lufthansa2', 'ckxfrb3tt2441qzoi47ri808w', result?.data.authenticateLambda);

  // console.log('Customer result: ', customerResult);

  const verifyUrl = `${dashboardUrl}/verify_token?token=${result?.data.authenticateLambda}`
  console.log('verify url: ', verifyUrl);

  const setDomainLocalStorage = async (browser: puppeteer.Browser, url: string) => {
    const page: puppeteer.Page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    console.log('Going to url: ', url);
    await page.goto(url, { waitUntil: 'networkidle0' });

    await page.waitForTimeout(20000);

    const localStorageData = await page.evaluate(() => {
      let json = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        json[key] = localStorage.getItem(key);
      }
      return json;
    });

    console.log('local storage after visiting verify page: ', localStorageData)

    const localStorageSecond = await page.evaluate(() => Object.assign({}, window.localStorage));
    console.log('Local storage after evaluating verify page: ', localStorageSecond)

    // await page.evaluate(values => {
    //   for (const key in values) {
    //     console.log('KEY: ', key, values[key]);
    //     localStorage.setItem(key, values[key]);
    //   }
    // }, values);


    // const localStorageThird = await page.evaluate(() => Object.assign({}, window.localStorage));
    // console.log('local storage after custom assign: ', localStorageThird)
    await page.close();
  };

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

      // const localStorageData = {
      //   access_token: result?.data.authenticateLambda,
      //   help: 'ME'
      // };

      await setDomainLocalStorage(browser, verifyUrl);
      console.log(`Started ${browserVersion}`);

      const page = await browser.newPage();

      await page.setViewport({ width: 1920, height: 1080 });
      page.setDefaultNavigationTimeout(60000);

      // const verifyResponse = await page.goto(verifyUrl, { waitUntil: 'networkidle0' });
      // console.log('verifyResponse: ', verifyResponse)
      // // const screenshot = await page.screenshot({ fullPage: true }) as Buffer;
      // await page.evaluateOnNewDocument(
      //   () => {
      //     const l = localStorage.getItem('access_token');
      //     console.log('BIG L: ', l);
      //   });
      // const ls = await page.evaluate(() => {
      //   console.log('Local storage #1: ', localStorage)
      //   return JSON.stringify(localStorage)
      // });

      // await page.evaluate(() => {
      //   const data = window.localStorage.getItem('access_token');
      //   console.log(JSON.parse(data));
      // })

      // console.log('Local storage #2: ', ls);
      // TODO: Try below snippet store in localstorage the token
      await page.evaluateOnNewDocument(
        token => {
          localStorage.setItem('access_token', token);
        }, result?.data.authenticateLambda);

      await page.goto(reportUrl, { waitUntil: 'networkidle0' });
      const localStorageFourth = await page.evaluate(() => JSON.stringify(Object.assign({}, window.localStorage)));
      console.log('New page storage: ', localStorageFourth)


      await page.waitForTimeout(20000);
      // await page.goto(reportUrl, { waitUntil: 'networkidle0' });
      // await page.waitForSelector('#report', {
      //   visible: true,
      // });

      const pdf = await page.pdf({ format: 'A4' }) as Buffer;
      await page.close();
      await browser.close();

      const s3 = new aws.S3();
      const key = `screenshots/${context.awsRequestId}.pdf`;
      console.log(`Screenshot location: ${process.env.bucketName}/${key}`);
      await s3.putObject({
        Bucket: process.env.bucketName,
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
