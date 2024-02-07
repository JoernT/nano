// pollerFunctions.mjs

import axios from 'axios';
import config from './config.mjs';

// Define API endpoints and their polling intervals
const apiEndpoints = [
    { url: 'https://api.example.com/endpoint1', interval: 5000, token: config.tokens.smartthings}, // 5 seconds
    // { url: 'https://api.example.com/endpoint2', interval: 2000, token: config.tokens.token2  }, // 10 seconds
    // Add more endpoints as needed
];

// Object to store interval IDs for each endpoint
const intervalIds = {};

// Function to poll an API endpoint with Bearer token authentication
async function pollEndpoint(endpoint) {
    console.log('pollEndpoints', endpoint.url, endpoint.interval);
    try {
        const response = await axios.get(endpoint.url, {
            headers: {
                'Authorization': `Bearer ${endpoint.token}`
            }
        });
        // Access values from the response data
        // const name = response.data.data.name;
        // const age = response.data.data.age;
        // const email = response.data.data.email;


        console.log(`Response from ${endpoint.url}:`, response.data);
    } catch (error) {
        if (error.response) {
            // The request was made, but the server responded with a status code outside of the 2xx range
            console.error(`Error from ${endpoint.url}. Status code: ${error.response.status}, Message: ${error.response.data}`);
        } else if (error.request) {
            // The request was made, but no response was received
            console.error(`No response received from ${endpoint.url}.`);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error(`Error setting up the request for ${endpoint.url}:`, error.message);
        }
    }

}

// Function to start polling for all API endpoints
export function startPolling() {
    apiEndpoints.forEach(endpoint => {
        intervalIds[endpoint.url] = setInterval(() => {
            pollEndpoint(endpoint);
        }, endpoint.interval);
    });
}

// Function to stop polling for all API endpoints
export function stopPolling() {
    Object.values(intervalIds).forEach(intervalId => {
        clearInterval(intervalId);
    });
    // Clear the interval IDs object
    Object.keys(intervalIds).forEach(key => delete intervalIds[key]);
}
