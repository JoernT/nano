// pollerFunctions.mjs
import axios from 'axios';
import {tokens} from "./config.js";
import {InfluxDB, Point} from '@influxdata/influxdb-client';



export class Nano {

    constructor() {
        this.intervalIds = [];
        this.influxConf = {
            url: 'http://localhost:8086',
            org: 'nanoCorp',
            bucket: 'nano'
        }
        this.apiEndpoints = [
            {
                url: `https://api.smartthings.com/v1/devices/${tokens.smartthings.device}/status`,
                interval: 1000 * 60 * 3,
                token: tokens.smartthings.token,
            },
/*
            {
                url: 'https://api.example.com/endpoint2',
                interval: 1500,
                token: tokens.influxDB,
            },
*/
            // Add more endpoints as need
        ];

    }


    startPolling() {
        this.apiEndpoints.forEach(endpoint => {
            this.intervalIds[endpoint.url] = setInterval(() => {
                this.fetchData(endpoint)
                    .then(data => {
                        this.extractData(data);
                    })
            }, endpoint.interval);
        });
    }

    async fetchData(endpointConfig) {
        console.log('fetchData', endpointConfig.url, endpointConfig.interval);
        try {
            const response = await axios.get(endpointConfig.url, {
                headers: {
                    'Authorization': `${tokens.smartthings.token}`
                }
            })
            return response.data;
        } catch (error) {
            if (error.response) {
                // The request was made, but the server responded with a status code outside of the 2xx range
                console.error(`Error from ${endpointConfig.url}. Status code: ${error.response.status}, Message: ${error.response.data}`);
            } else if (error.request) {
                // The request was made, but no response was received
                console.error(`No response received from ${endpointConfig.url}.`);
            } else {
                // Something happened in setting up the request that triggered an Error
                console.error(`Error setting up the request for ${endpointConfig.url}:`, error.message);
            }
        }
    }

    async extractData(data) {
        // ?components?INDOOR2?temperatureMeasurement?temperature?value
        // console.log('extractAndStoreData.responseData', data)

        const heating = data.components.INDOOR2.temperatureMeasurement.temperature.value || 'N/A';

        // components?main?temperatureMeasurement?temperature?value
        const warmwater = data.components.main.temperatureMeasurement.temperature.value || 'N/A';

        // components?main?powerConsumptionReport?powerConsumption?value?power
        const energy = data.components.main.powerConsumptionReport.powerConsumption.value.power || 'N/A';

        await this.writeData('temperature', 'component', 'heating', 'temp', heating);
        await this.writeData('temperature', 'component', 'warmwater', 'temp', warmwater);
        await this.writeData('energy', 'component', 'heatpump', 'power', energy);
    }

    async writeData(measurement, tagName, tagValue, fieldName, fieldValue) {

        console.log('measurement', measurement);
        console.log('influxConf', this.influxConf);
        const url = this.influxConf.url;
        const token = tokens.influxDB;
        const org = this.influxConf.org;
        const bucket = this.influxConf.bucket;
        /**
         * Instantiate the InfluxDB client
         * with a configuration object.
         **/
        const influxDB = new InfluxDB({url, token})
        /**
         * Create a write client from the getWriteApi method.
         * Provide your `org` and `bucket`.
         **/
        const writeApi = influxDB.getWriteApi(org, bucket)

        /**
         * Apply default tags to all points.
         **/
        // writeApi.useDefaultTags({ region: 'west' })
        const point1 = new Point(measurement)
                .tag(tagName, tagValue)
                .floatField(fieldName, fieldValue)
        console.log(` ${point1}`)
        writeApi.writePoint(point1)

        /**
         * Flush pending writes and close writeApi.
         **/
        writeApi.close().then(() => {
            console.log('WRITE FINISHED')
        })


    }


    stopPolling(intervalId) {
        clearInterval(intervalId);
    }


}

new Nano().startPolling();
