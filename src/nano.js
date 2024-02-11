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
                name:'smartthings',
                url: `https://api.smartthings.com/v1/devices/${tokens.smartthings.device}/status`,
                interval: 1000 * 60,
                token: tokens.smartthings.token,
            },
            {
                name: 'DWD-hourly-sunshine-duration-direct-diffuse',
                url: 'https://api.open-meteo.com/v1/dwd-icon?latitude=52.4333&longitude=13.3076&hourly=sunshine_duration,direct_radiation_instant,diffuse_radiation_instant&timezone=Europe%2FBerlin',
                interval: 1000 * 60 * 60,
            },
            // Add more endpoints as need
        ];

    }


    startPolling() {
        this.apiEndpoints.forEach(endpoint => {
            this.request(endpoint);

            this.intervalIds[endpoint.url] = setInterval(() => {
                console.log('fetching', endpoint.name);
                this.request(endpoint);
                /*
                                this.fetchData(endpoint)
                                    .then(data => {
                                        this.extractData(data, endpoint);
                                    })
                */
            }, endpoint.interval);
        });
    }

    request(endpoint) {
        this.fetchData(endpoint)
            .then(data => {
                this.extractData(data, endpoint);
            })
    }

    async fetchData(endpointConfig) {
        console.log('fetchData', endpointConfig.url, endpointConfig.interval);
        try {
            let response;
            if (endpointConfig.token) {
                response = await axios.get(endpointConfig.url, {
                    headers: {
                        'Authorization': `${tokens.smartthings.token}`
                    }
                })
            } else {
                // anonymous API requires no token
                response = await axios.get(endpointConfig.url, {})
            }
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

    async extractData(data, endpoint) {
        // ?components?INDOOR2?temperatureMeasurement?temperature?value
        // console.log('extractAndStoreData.responseData', data)

        if (endpoint.name === 'smartthings') {
            const heating = data.components.INDOOR2.temperatureMeasurement.temperature.value || 'N/A';
            const warmwater = data.components.main.temperatureMeasurement.temperature.value || 'N/A';
            const energy = data.components.main.powerConsumptionReport.powerConsumption.value.power || 'N/A';
            await this.writeData('nano','temperature', 'component', 'heating', 'temp', heating);
            await this.writeData('nano','temperature', 'component', 'warmwater', 'temp', warmwater);
            await this.writeData('nano','energy', 'component', 'heatpump', 'power', energy);
        }

        if (endpoint.name === 'DWD-hourly-sunshine-duration-direct-diffuse') {
            // console.log('pulling sunshine', data)
            const times = data.hourly.time;
            const durations = data.hourly.sunshine_duration;
            const directs = data.hourly.direct_radiation_instant;
            const diffuses = data.hourly.diffuse_radiation_instant;
            // console.log('times', times);
            // console.log('durations', durations);
            for (let i = 0; i < times.length; i++) {
                const time = times[i];
                const duration = durations[i];
                const direct = directs[i];
                const diffuse = diffuses[i];
                console.log(time,duration,direct,diffuse);
                await this.writeData('sunshine','sunshine', 'location', 'Berlin', 'duration', duration);
                // await this.writeData('sunshine','sunshine', 'location', 'Berlin', 'direct', direct);
                // await this.writeData('sunshine','sunshine', 'location', 'Berlin', 'diffuse', diffuse);
            }
        }

    }

    async writeData(bucket, measurement, tagName, tagValue, fieldName, fieldValue) {

        console.log('write to bucket', bucket);
        console.log('measurement', measurement);
        console.log('influxConf', this.influxConf);
        const url = this.influxConf.url;
        const token = tokens.influxDB;
        const org = this.influxConf.org;
        // const bucket = this.influxConf.bucket;

        try{
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
        }catch(e){
            console.error(e.message);
        }



    }


    stopPolling(intervalId) {
        clearInterval(intervalId);
    }


}

new Nano().startPolling();
// pullSunshine();