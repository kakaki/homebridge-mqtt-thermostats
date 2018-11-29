
# MQTT Thermostats

A Homebridge Plugin for controlling thermostats based on ESPURNA soft with temperature sensors and relays.

#### Install via npm (>= v8.x.x)
`npm install homebridge-mqtt-thermostats -g`


#### Edit the ./homebridge/config.json

```
    "description": "This is an example configuration file. You can use this as a template for creating your own configuration file.",
    "platforms": [
	    {
            "platform": "mqttThermostats",
            "name": "mqttThermostats",
            "url": "<url of MQTT server (optional)>",
    		"username": "<username for MQTT (optional)>",
            "password": "<password for MQTT (optional)>",
            "heat_name": "<heat name optional switch accesory to control heating",
            "heat_topic_get": "<topic to read heat state>",
            "heat_topic_set": "<topic to set heat state>",
            "heat_on_value": 1,
            "heat_off_value": 0,
            "thermostats": [
                {
                    "name": "<name of termostat>",
                    "topics" :
					    {
                        "getCurrentTemperature": "<topic to get current temp>",
                        "setOn": "<topic to set relay controling temp>"
					    }
                }
            ]
        }
    ]

```

#### Misc
Feel free to give me feedback, create PRs or submit issues, enhancements and bugs.
