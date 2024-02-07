# nano
home automation

## Prep

* install OS (Ubuntu)
* install asdf
* install node
* install Git
* install influxDB
* 

## First exploration of commands

* install smartthings cli first
* `smarthings devices` lists all devices - to get the id of the device (heatpump)
* 

Already gives me the most important info
* smartthings devices:status [ID]

## Plan
* write a polling script in node to poll a. smartthings b. wetherdata (temperature, sunshine hours)
* push data to influxDb
* use Grafana or similar to visualize (maybe only Fore + lib)


## HomeBridge

### install homebridge
`npm install -g --unsafe-perm homebridge homebridge-config-ui-x`

### start homebridge service
`sudo hb-service install –-user homebridge`

## Links:

[smartthings cli](https://github.com/SmartThingsCommunity/smartthings-cli)


https://api.smartthings.com/v1/devices/5574bfcf-b397-8a39-88d3-000001200000/components/INDOOR2/status
[smartthings API](https://developer.smartthings.com/docs/api/public/)
