const express = require('express');
const responseTime = require('response-time');
const axios = require('axios');
const redis = require('redis');

const app = express();

// This section will change for Cloud Service
const redisClient = redis.createClient();
require('dotenv').config();
const AWS = require('aws-sdk');
const bucketName = '10056513-wikipedia-store';
AWS.config.getCredentials(function (err) {
  if (err) console.log(err.stack);
  // credentials not loaded
  else {
    console.log("Access key:", AWS.config.credentials.accessKeyId);
    console.log("Secret access key:", AWS.config.credentials.secretAccessKey);
  }
});

// const bucketPromise = new AWS.S3({ apiVersion: '2006-03-01' }).createBucket({ Bucket: bucketName }).promise();
// bucketPromise
//   .then(function (data) {
//     console.log("Successfully created " + bucketName);
//   })
//   .catch(function (err) {
//     console.error(err, err.stack);
//   });

// Upload to AWS promise
// const uploadPromise = new AWS.S3({apiVersion: '2006-03-01'}).putObject(objectParams).promise();
// uploadPromise
// .then(function(data) {
//   console.log("successfully uploaded data to " + bucketName + "/" + s3Key); 
// })
// .catch(err => {
//   console.log("error: ", err);
// })

redisClient.on('error', (err) => {
  console.log("Error" + err);
});

app.use(responseTime());

app.get('/api/search', (req, res) => {
  const query = (req.query.query).trim();
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${query}`;
  const redisKey = `wikipedia:${query}`;
  // try serach Redis
  return redisClient.get(redisKey, (err, result) => {
    // Found in Redis cache
    if (result) {
      console.log(`result for query ${query} found in Redis Cache`);
      const resultJSON = JSON.parse(result);
      // server from Redis cache
      return res.status(200).json(resultJSON);
      // not found in Redis Cache
    } else {
      // check AWS store
      const s3Key = `wikipedia-${query}`;
      const params = { Bucket: bucketName, Key: s3Key };
      return new AWS.S3({ apiVersion: '2006-03-01' }).getObject(params, (err, result) => {
        // found in S3
        if (result) {
          console.log(`result for query ${query} found in S3`);
          const resultJSON = JSON.parse(result.Body);
          const forUpload = JSON.parse(JSON.stringify(resultJSON)); // copy JSON object and overwrite source to Redis Cache
          forUpload.source = 'Redis Cache';
          // upload to redis cache
          redisClient.setex(redisKey, 3600, JSON.stringify(forUpload));
          console.log(`result for query ${query} stored in Redis cache`);
          return res.status(200).json(resultJSON);
          // not found in S3 so serve from Wikipedia API and save to redis and S3
        } else {
          console.log(`Sever the result for query ${query} from Wikipedia API`);
          // go to wikipedia
          return axios.get(searchUrl)
            .then(response => {

              console.log(`result for query ${query} will be stored in S3 and Redis cache`);
              const responseJSON = response.data;
              const body = JSON.stringify({ source: 'S3 Bucket', ...responseJSON });
              const objectParams = { Bucket: bucketName, Key: s3Key, Body: body };
              // upload to S3
              const uploadPromise = new AWS.S3({ apiVersion: '2006-03-01' }).putObject(objectParams).promise();
              uploadPromise.then(function (data) {
                console.log("Successfully uploaded data to " + bucketName + "/" + s3Key);
              })
                .catch(e => {
                  console.log("Error while uploading data to S3");
                  res.json(e);
                })
              // also upload to Redis Cache
              redisClient.setex(redisKey, 3600, JSON.stringify({ source: 'Redis Cache', ...responseJSON }));
              return res.status(200).json({ source: 'Wikipedia API', ...responseJSON })
            }) // then
            .catch(e => {
              return res.json(e);
            }) // catch
        } // if else
      }); // return new AWS.S3 ...
    }; // if else
  });
});

app.get('/api/store', (req, res) => {
  const key = (req.query.key).trim();
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${key}`;
  const s3Key = `wikipedia-${key}`;
  const params = { Bucket: bucketName, Key: s3Key };

  return new AWS.S3({ apiVersion: '2006-03-01' }).getObject(params, (err, data) => {
    console.log(data);
    // found in S3
    if (data) {
      console.log(`object for the key ${key} already exists in S3!`);
      const resultJSON = JSON.parse(data.Body);
      // server from S3
      return res.status(200).json(resultJSON);
      // not found in S3
    } else {
      // go to wikipedia
      return axios.get(searchUrl)
        .then(response => {
          const responseJSON = response.data;
          const body = JSON.stringify({ source: 'S3 Bucket', ...responseJSON });
          const objectParams = { Bucket: bucketName, Key: s3Key, Body: body };
          const uploadPromise = new AWS.S3({ apiVersion: '2006-03-01' }).putObject(objectParams).promise();
          uploadPromise.then(function (data) {
            console.log("api/store route: Successfully uploaded data to " + bucketName + "/" + s3Key);
          });

          // server from wikipedia API
          return res.status(200).json({ source: 'Wikipedia API', ...responseJSON, });
        })
        .catch(err => {
          return res.json(err);
        })
    }
  })
})

app.listen(3000, () => {
  console.log('Server listening on port: ', 3000);
})

module.exports = app