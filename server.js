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

console.log("Region: ", AWS.config.region);

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

app.get('/api/serach', (req, res) => {
  const query = (req.query.query).trim();
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${query}`;
  const redisKey = `wikipedia:${query}`;
  return redisClient.get(redisKey, (err, result) => {
    // If that key exist in Redis store
    if (result) {
      const resultJSON = JSON.parse(result);
      return res.status(200).json(resultJSON);
      // MAYBE: insert code below to check S3 

    } else { // Key does not exist in Redis store
      // Fetch directly from Wikipedia API
      console.log("Not found on redis cache so get from wikipedia directly")
      return axios.get(searchUrl)
        .then(response => {
          const responseJSON = response.data;
          // Save the Wikipedia API response in Redis store
          redisClient.setex(`wikipedia:${query}`, 3600, JSON.stringify({ source: 'Redis Cache', ...responseJSON, }));
          // Send JSON response to client
          console.log({ source: 'Wikipedia API', ...responseJSON })
          return res.status(200).json({ source: 'Wikipedia API', ...responseJSON });
        })
        .catch(err => {
          return res.json(err);
        });
    }
  });
});

app.get('/api/store', (req, res) => {
  const key = (req.query.key).trim();
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${key}`;
  const s3Key = `wikipedia-${key}`;
  const params = { Bucket: bucketName, key: s3Key };

  return new AWS.S3({ apiVersion: '2006-03-01' }).getObject(params, (err, result) => {
    if (result) {
      console.log(result);
      const resultJSON = JSON.parse(result.Body);
      return res.status(200).json(resultJSON);
    } else {
      return axios.get(searchUrl)
        .then(response => {
          const responseJSON = response.data;
          const body = JSON.stringify({ source: 'S3 Bucket', ...responseJSON });
          const objectParams = { Bucket: bucketName, Key: s3Key, Body: body };
          const uploadPromise = new AWS.S3({ apiVersion: '2006-03-01' }).putObject(objectParams).promise();
          uploadPromise.then(function (data) {
            console.log("Successfully uploaded data to " + bucketName + "/" + s3Key);
          });
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