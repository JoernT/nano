'use strict'
/** @module write
 * Writes a data point to InfluxDB using the Javascript client library with Node.js.
 **/

import { InfluxDB, Point } from '@influxdata/influxdb-client';

// writeData(...,...,'nanoCorp','nano','temperature',{tag:'heating'},{name:'temp',value:45.0})
export function writeData(url, token, org, bucket, measurement,tag,field){
    /**
     * Instantiate the InfluxDB client
     * with a configuration object.
     **/
    const influxDB = new InfluxDB({ url, token })
    /**
     * Create a write client from the getWriteApi method.
     * Provide your `org` and `bucket`.
     **/
    const writeApi = influxDB.getWriteApi(org, bucket)

    /**
     * Apply default tags to all points.
     **/
    // writeApi.useDefaultTags({ region: 'west' })

    /**
     * Create a point and write it to the buffer.
     **/
    const point1 = new Point(measurement)
        .tag(tagName, tagValue)
        .floatField('temperature', 16.0)
    console.log(` ${point1}`)

    writeApi.writePoint(point1)

    /**
     * Flush pending writes and close writeApi.
     **/
    writeApi.close().then(() => {
        console.log('WRITE FINISHED')
    })

}
/*
    /!** Environment variables **!/
    const url = 'http://localhost:8086/api/v2'
    const token = 'griMhOjzJTw0IhEohxkWqN_vEbhn4CLBr9hsAj5t7_qnUSXOKRMLeBV_Es7z5tUHEUkuKskhEiNvEReFssbRDA=='
    const org = 'nanoCorp'
    const bucket = 'nano'

    /!**
     * Instantiate the InfluxDB client
     * with a configuration object.
     **!/
    const influxDB = new InfluxDB({ url, token })
    /!**
     * Create a write client from the getWriteApi method.
     * Provide your `org` and `bucket`.
     **!/
    const writeApi = influxDB.getWriteApi(org, bucket)

    /!**
     * Apply default tags to all points.
     **!/
    // writeApi.useDefaultTags({ region: 'west' })

    /!**
     * Create a point and write it to the buffer.
     **!/
    const point1 = new Point('heating')
        .tag('temp', 'TLM01')
        .floatField('value', 16.0)
    console.log(` ${point1}`)

    writeApi.writePoint(point1)

    /!**
     * Flush pending writes and close writeApi.
     **!/
    writeApi.close().then(() => {
        console.log('WRITE FINISHED')
    })
*/

// }


