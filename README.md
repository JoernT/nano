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


https://github.com/home-assistant/core/issues/42006

OK, here's the definition of the values:

    start: Start date of the reporting period in Iso8601Date format
    end: End date of the reporting period in Iso8601Date format
    energy: Accumulated energy consumption during the reporting period in watt-hours (Wh)
    power: Instantaneous power consumption during the reporting period in watts (W)
    deltaEnergy: Delta of accumulated energy consumption during the reporting period in watt-hours (Wh)
    powerEnergy: Energy consumption during the reporting period calculated from instantaneous power consumption in watt-hours (Wh)
    energySaved: Energy saved during the report period in watt-hours (Wh)
    persistedEnergy: Accumulated energy consumption that was saved into device local DB in watt-hours (Wh)

Note: I don't know the frequency or logic behind when a "report" is generated, but I suspect it correlates to a cycle on the appliance.
Based on the definition above, energy is not cumulative, rather will get reset every "report". If your goal is to determine total energy
used (on-going), you'll need to create a separate sensor for total energy that adds the value of energy whenever it's updated (when a new report comes out).

I'm happy to submit a PR for this, unless @JPHutchins wants to. 😄

test