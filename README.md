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


## Links:

[smartthings cli](https://github.com/SmartThingsCommunity/smartthings-cli)
[smartthings API](https://developer.smartthings.com/docs/api/public/)
