let Accessory, Service, Characteristic, UUIDGen;
var mqtt = require("mqtt");
const storage = require('node-persist');
const moment = require('moment')
var fs = require('fs')

module.exports = (homebridge) => {
  // Accessory must be created from PlatformAccessory Constructor
  Accessory = homebridge.platformAccessory;
  
  // Service and Characteristic are from hap-nodejs
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  var FakeGatoHistoryService = require('fakegato-history')(homebridge); 

  // For platform plugin to be considered as dynamic platform plugin,
  // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
  homebridge.registerPlatform('homebridge-mqtt-thermostats', 'mqttThermostats', mqttThermostatsPlatform, true);

	// Platform constructor
	// config may be null
	// api may be null if launched from old homebridge version
	function mqttThermostatsPlatform(log, config, api) {
		this.log = log;
		this.config = config;
		this.accessories = [];
		this.thermostats = config.thermostats || {};
	
		this.mqttTopics = {}; //list of registered mqtt topics
	
		this.name = config.name;
		this.url = config.url;
		this.heat = {};
		this.heat.name = config.heat_name || "";
		this.heat.topic_get = config.heat_topic_get || "";	
		this.heat.topic_set = config.heat_topic_set || "";
		this.heat.on_value = config.heat_on_value || "1";
		this.heat.off_value = config.heat_off_value || "0";
		this.heat.state = false;
	
		storage.initSync({dir:"/usr/lib/node_modules/homebridge-mqtt-thermostats/storage"});

		if (api) {
			this.api = api;
			this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
		}
	
		var clientId = 'mqttThermostats_' + config.name.replace(/[^\x20-\x7F]/g, "") + '_' + Math.random().toString(16).substr(2, 8);
		var options = {
			keepalive: 10,
			clientId: clientId,
			protocolId: 'MQTT',
			protocolVersion: 4,
			clean: true,
			reconnectPeriod: 1000,
			connectTimeout: 30 * 1000,
			will: {
				topic: 'WillMsg',
				payload: 'Connection Closed abnormally..!',
				qos: 0,
				retain: false
			},
			username: config.username,
			password: config.password,
			rejectUnauthorized: false
		};
	
		var that = this;
		
		// connect to MQTT broker
		this.mqttClient = mqtt.connect(this.url, this.options);
	
		this.mqttClient.on('error', function (err) {
			console.log('MQTT Error: ' + err);
			});

		this.mqttClient.on('connect', function () {
			console.log('MQTT connect');
		});
	
		this.mqttClient.on('message', function (topic, message) {
	
			var handlers = that.mqttTopics[topic];
			if (handlers) {
				for (var i in handlers) {
	//	    console.log("mqtt_message "+handlers[i]+" "+message);
					handlers[i](topic, message);
				}
			} else {
				log('Warning: No MQTT dispatch handler for topic [' + topic + ']');
			}
		});
	}   

	mqttThermostatsPlatform.prototype.mqttSubscribe = function(topic, acc, handler) {
		if (!this.mqttTopics[topic]) {
		  this.mqttTopics[topic] = {};
		  this.mqttClient.subscribe(topic);
		  console.log("mqtt subscribe "+acc+" "+topic);
		}
		this.mqttTopics[topic][acc] = handler;
	}
 
	mqttThermostatsPlatform.prototype.mqttPublish = function(topic, message) {

		console.log("mqtt publish topic: "+topic+ " mess: "+message.toString());	
		this.mqttClient.publish(topic, message.toString());
	}

	mqttThermostatsPlatform.prototype.checkHeating = function() {

		if (this.heat.topic_set!="") {

			var lheat_state = false;
			  for (var i in this.thermostats) {
				var accessory = this.accessories[this.thermostats[i].name];
		
				console.log("check heat "+accessory.context.name+" "+accessory.context.current_heat_state+" "+accessory.context.target_temp+" "+accessory.context.current_temp);	
				if (accessory.context.current_heat_state>0 && accessory.context.target_heat_state>0) {
					lheat_state = true;
					}
			}
		
			var rheat_state = ( this.heat.state == this.heat.on_value) ? true : false;
		
			console.log("check heat "+lheat_state+" "+rheat_state);
			if (rheat_state!=lheat_state) {	
				console.log("change heat "+lheat_state+" "+rheat_state+" topic "+this.heat.topic_set);	
				this.mqttPublish(this.heat.topic_set, lheat_state ? this.heat.on_value : this.heat.off_value);
								
				if (lheat_state) {
					//start heating all that are under target temp+delta stop				
					for (var i in this.thermostats) {
					  var accessory = this.accessories[this.thermostats[i].name];
								
					  if (accessory.context.current_temp < accessory.context.target_temp+accessory.context.temp_delta_stop-0.1) {
						console.log("check heat start "+accessory.context.name+" to :"+ accessory.context.target_temp);
					
						var therm_service = accessory.getService(Service.Thermostat);					
						therm_service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setValue(Characteristic.CurrentHeatingCoolingState.HEAT, undefined, 'checkHeatValue');
						if (accessory.context.setOn!="") {
							this.mqttPublish(accessory.context.setOn, accessory.context.onValue);
						}			
					  }
					}
				
	//				fs.readFile(homebridge.user.storagePath()+'thermo_heat.json', function (err, data) {
	//					var json = JSON.parse(data)
	//				    json.push({time: moment().unix(), heat: lheat_state})
	//				    fs.writeFile(homebridge.user.storagePath()+'thermo_heat.json', JSON.stringify(json))
	//				})
				}
			}
		}
	}
	
	// Method to setup accesories from config.json
	mqttThermostatsPlatform.prototype.didFinishLaunching = function () {

	//  this.log("Platform didFinishLaunching: " + this.pins + "'...");
	  // Add or update accessories defined in config.json  
	  for (var i in this.thermostats) {
		  this.addAccessory(this.thermostats[i]);
	  }
  
	  if (this.heat_name!="") {
		this.addHeatAccessory(this.heat);
	  }
  
	  this.log("Platform remove old accesories");

	  // Remove extra accessories in cache
	  for (var name in this.accessories) {
		var accessory = this.accessories[name];
		if (!accessory.reachable) {
		this.removeAccessory(accessory);
			this.log("Remove accessory: "+name);
		}
	  }  
	}

	// Method to restore accessories from cache
	mqttThermostatsPlatform.prototype.configureAccessory = function (accessory) {
	  this.log("config accessory: " + accessory.context.name + "'...");
  
	
	  this.setService(accessory);
	  this.accessories[accessory.context.name] = accessory;
	}    
	
	// Method to add and update HomeKit accessories
	mqttThermostatsPlatform.prototype.addAccessory = function (data) {
	  this.log("Initializing platform accessory '" + data.name + "'...");
  
	  // Retrieve accessory from cache
	  var accessory = this.accessories[data.name];

	  if (data.manufacturer) data.manufacturer = data.manufacturer.toString();
	  if (data.model) data.model = data.model.toString();
	  if (data.serial) data.serial = data.serial.toString();

	  if (!accessory) {
		this.log("creating accessory '" + data.name + "'...");
		
		// Setup accessory as SWITCH (8) category.
		var uuid = UUIDGen.generate(data.name);    
		accessory = new Accessory(data.name, uuid, 10);
		accessory.addService(Service.Thermostat, data.name);
		//logging

		// Register new accessory in HomeKit
		this.api.registerPlatformAccessories("homebridge-mqtt-thermostats-platform", "mqttThermostats", [accessory]);

		// Store accessory in cache
		this.accessories[data.name] = accessory;    		
	  }

		// Store and initialize variables into context
		var cache = accessory.context;
		cache.name = data.name;
		this.displayName = data.name;
	
	    cache.setOn = data.topics.setOn;
		cache.onValue = data.onValue || 1;
		cache.offValue = data.offValue || 0;
		
		cache.temp_delta_start  = data.temp_delta_start || 0.7;
		cache.temp_delta_restart  = data.temp_delta_restart || 0.3;
		cache.temp_delta_stop  = data.temp_delta_stop || 0.3;
	
		// New accessory is always reachable
		accessory.reachable = true;

		// Setup listeners for different switch events
		this.setService(accessory);	
  
		//therm
		var therm_service = accessory.getService(Service.Thermostat);

		//logging		
		for (var index in accessory.services) {
    		var service = accessory.services[index];    
    			if (service.UUID === "E863F007-079E-48FF-8F27-9C2605A29F52") {			
	    			this.log("remove old FakeGatoHistoryService " + accessory.displayName +" : "+service.displayName + " "+ service.UUID + " "+ service.subtype);
					accessory.removeService(service);
   				}    			
    		}
    		
    	var loggingService = accessory.addService(new FakeGatoHistoryService("thermo", this, { storage: 'fs', filename: 'thermo_'+data.name+'.json'}), "loging");		
		
		this.log(data.name+": therm_service: " + therm_service.UUID);
		this.log(data.name+": logginsservice: " + loggingService.UUID);
	
		let target_temp = storage.getItemSync(data.name+' target_temp');
//		let heat_treshold_temp = storage.getItemSync(data.name+' heat_treshold_temp');
//		let cool_treshold_temp = storage.getItemSync(data.name+' cool_treshold_temp');
		let target_heat_state = storage.getItemSync(data.name+' target_heat_state');

		if (! target_temp) {
			target_temp = 21.0;
			storage.setItemSync(data.name+' target_temp', target_temp);
		}
//		if (! heat_treshold_temp) {
//			heat_treshold_temp = 20.0;
//			storage.setItemSync(data.name+' heat_treshold_temp', heat_treshold_temp);
//		}
//		if (! cool_treshold_temp) {
//			cool_treshold_temp = 22.0;
//			storage.setItemSync(data.name+' cool_treshold_temp', cool_treshold_temp);
//		}
		if (! target_heat_state) {
			target_heat_state = 1; //heat
			storage.setItemSync(data.name+' target_heat_state', target_heat_state);
		}

		cache.target_temp = target_temp;	 
//		cache.heat_treshold_temp = heat_treshold_temp;
//		cache.cool_treshold_temp = cool_treshold_temp;
		cache.current_temp = 99;
	
		 // The value property of TargetHeatingCoolingState must be one of the following:
		//Characteristic.TargetHeatingCoolingState.OFF = 0;
		//Characteristic.TargetHeatingCoolingState.HEAT = 1;
		//Characteristic.TargetHeatingCoolingState.COOL = 2;
		//Characteristic.TargetHeatingCoolingState.AUTO = 3;
		cache.target_heat_state = target_heat_state;
	
		// The value property of CurrentHeatingCoolingState must be one of the following:
		//Characteristic.CurrentHeatingCoolingState.OFF = 0;
		//Characteristic.CurrentHeatingCoolingState.HEAT = 1;
		//Characteristic.CurrentHeatingCoolingState.COOL = 2;
		cache.current_heat_state = 0;	
	
		//Characteristic.TemperatureDisplayUnits.CELSIUS = 0;
		//Characteristic.TemperatureDisplayUnits.FAHRENHEIT = 1;
		cache.temp_displ = 0;
	
		var that = this;

		therm_service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.setProps({
				validValues: 
				[Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.HEAT] //, Characteristic.TargetHeatingCoolingState.AUTO
		})
		.on('get', function (callback) {
			console.log('TargetHeatingCoolingState:'+ cache.target_heat_state);
				callback(null, cache.target_heat_state);
			})
		.on('set', function (value, callback, context) {
			if (context !== 'fromSetValue') {
				console.log('set TargetHeatingCoolingState:'+ value);
				cache.target_heat_state = value;
				if (data.topics.setOn!="") {
					that.mqttPublish(data.topics.setOn, cache.onValue);
				}
				that.checkHeating();
				storage.setItemSync(data.name+' target_heat_state', cache.target_heat_state);
			}
			callback();
			});
		
		therm_service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)		
		.on('get', function (callback) {
				console.log("CurrentHeatingCoolingState:"+ cache.current_heat_state);
				callback(null, cache.current_heat_state);
			})
		.on('set', function (value, callback, context) {
			if (context !== 'fromSetValue') {
				console.log('set CurrentHeatingCoolingState:'+ value);
				cache.current_heat_state = value;
			}
			if (context !== 'checkHeatValue') {
				that.checkHeating();
			}
			callback();
			});		

		therm_service.getCharacteristic(Characteristic.TargetTemperature)
		.setProps({
			maxValue: 30,
			minValue: 15,
			minStep: 0.1
		})
		.on('get', function (callback) {
			console.log("TargetTemperature:"+ cache.target_temp);
				callback(null, cache.target_temp);
			})
		.on('set', function (value, callback, context) {
			if (context !== 'fromSetValue') {
				console.log('set TargetTemperature:'+ value);
				cache.target_temp = value;
				storage.setItemSync(data.name+' target_temp', cache.target_temp);
			
				if (
				   (cache.current_temp <= cache.target_temp-cache.temp_delta_start) || 
				   (that.heat.state && cache.current_temp < cache.target_temp-cache.temp_delta_restart)
				   ) {
					console.log("start heat "+cache.name+" to :"+ cache.target_temp);
					cache.current_heat_state = Characteristic.CurrentHeatingCoolingState.HEAT;
					therm_service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setValue(Characteristic.CurrentHeatingCoolingState.HEAT, undefined, 'fromSetValue');
				
					if (data.topics.setOn!="") {
						that.mqttPublish(data.topics.setOn, cache.onValue);
					}
				}
				else 
				if (cache.current_temp >= cache.target_temp+cache.temp_delta_stop) {
					console.log("stop heat "+cache.name+" to :"+ cache.target_temp);
					cache.current_heat_state = Characteristic.CurrentHeatingCoolingState.OFF;
					therm_service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setValue(Characteristic.CurrentHeatingCoolingState.OFF, undefined, 'fromSetValue');
				
					if (data.topics.setOn!="") {
						that.mqttPublish(data.topics.setOn, cache.offValue);
					}
				  }
			}
			
			if (data.topics.setTargetTemperature!="") {				
				that.mqttPublish(data.topics.setTargetTemperature, value);
			}
					
			callback();
			});
		
	  therm_service.getCharacteristic(Characteristic.CurrentTemperature)
		.setProps({
			maxValue: 40,
			minValue: 0,
			minStep: 0.1
		})
		.on('get', function (callback) {
				console.log("CurrentTemperature:"+ cache.current_temp+" for "+cache.name);
				callback(null, cache.current_temp);
			})		
		
//	  therm_service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
//		  .setProps({
//			minValue: 15,
//			maxValue: 28,
//			minStep: 0.1
//		  })
//		  .on('get', callback => {
//			console.log('HeatingThresholdTemperature:', cache.heat_treshold_temp);
//			callback(null, cache.heat_treshold_temp);
//		  })
//		  .on('set', (value, callback) => {
//			console.log('SET HeatingThresholdTemperature from', console.heat_treshold_temp, 'to', value);
//			cache.heat_treshold_temp = value;
//			storage.setItemSync(data.name+' heat_treshold_temp', cache.heat_treshold_temp);
//			callback(null);
//		  });     
	  
//	  therm_service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
//		  .setProps({
//			minValue: 15,
//			maxValue: 29,
//			minStep: 0.1
//		  })
//		  .on('get', callback => {
//			console.log('CoolingThresholdTemperature:', cache.cool_treshold_temp);
//			callback(null, cache.cool_treshold_temp);
//		  })
//		  .on('set', (value, callback) => {
//			console.log('SET CoolingThresholdTemperature from', console.cool_treshold_temp, 'to', value);
//			cache.cool_treshold_temp = value;
//			storage.setItemSync(data.name+' cool_treshold_temp', cache.cool_treshold_temp);
//			callback(null);
//		  });           
		
		this.mqttSubscribe(data.topics.getCurrentTemperature, cache.name, function (topic, message) {
			console.log("mqtt get" + " "+topic +" " +message);
			var newState = parseFloat(message);
			
			cache.current_temp = newState;
			therm_service.getCharacteristic(Characteristic.CurrentTemperature).setValue(newState, undefined, 'fromSetValue');
			if (loggingService !== undefined) {
				loggingService.addEntry({time: moment().unix(), currentTemp:cache.current_temp, setTemp:cache.target_temp, valvePosition:cache.current_heat_state});
				console.log("saved to loggingService");
			}
			else 
				console.log("can't save to loggingService");
		
			if (cache.target_heat_state !== Characteristic.TargetHeatingCoolingState.OFF) {
			  if (
			  	(cache.current_temp <= cache.target_temp-cache.temp_delta_start) ||
			  	(that.heat.state && cache.current_temp < cache.target_temp-cache.temp_delta_restart)
			  	) {
				console.log("start heat "+cache.name+" to :"+ cache.target_temp);
				therm_service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setValue(Characteristic.CurrentHeatingCoolingState.HEAT, undefined, 'changeValue');
				if (data.topics.setOn!="") {
					that.mqttPublish(data.topics.setOn, cache.onValue);
				}
			  }
			  else
			  if (cache.current_temp >= cache.target_temp+cache.temp_delta_stop) {
				console.log("stop heat "+cache.name+" to :"+ cache.target_temp);
				therm_service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setValue(Characteristic.CurrentHeatingCoolingState.OFF, undefined, 'changeValue');
				if (data.topics.setOn!="") {
					that.mqttPublish(data.topics.setOn, cache.offValue);
				}
			  }
			}
		});
	
	  therm_service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
		.on('get', function (callback) {
				callback(null, data.temp_displ);
		});
	
	//        that.service.getCharacteristic(Characteristic.CurrentRelativeHumidity).setValue(that.CurrentRelativeHumidity, undefined, 'fromSetValue');
	
	  // Retrieve initial state
	  this.getInitState(accessory);
	}

	// Method to add and update HomeKit accessories
	mqttThermostatsPlatform.prototype.addHeatAccessory = function (data) {
	  this.log("Initializing platform accessory '" + data.name + "'...");

	  // Retrieve accessory from cache
	  var accessory = this.accessories[data.name];

	  if (!accessory) {
		this.log("creating heat accessory '" + data.name + "'...");
		
		// Setup accessory as SWITCH (8) category.
		var uuid = UUIDGen.generate(data.name);    
		accessory = new Accessory(data.name, uuid, 10);
		accessory.addService(Service.Switch, data.name);
		// Register new accessory in HomeKit
		this.api.registerPlatformAccessories("homebridge-mqtt-thermostats-platform", "mqttThermostats", [accessory]);

		// Store accessory in cache
		this.accessories[data.name] = accessory;    
	  }
  
		// Store and initialize variables into context
	  var cache = accessory.context;
	  cache.name = data.name;	
  
	  // New accessory is always reachable
	  accessory.reachable = true;
  
	  var that = this;
	  this.heat_service = accessory.getService(Service.Switch);

	  this.heat_service.getCharacteristic(Characteristic.On)
		.on('get', function (callback) {
			callback(null, that.heat.state);
		})
		.on('set', function (value, callback, context) {
			if (context !== 'fromSetValue') {
				that.heat.state = value;
				that.mqttPublish(that.heat.topic_set, value ? that.heat.on_value : that.heat.off_value);
			}
			callback();    
		});
	
	  this.mqttSubscribe(this.heat.topic_get, cache.name, function (topic, message) {
		console.log("mqtt get heat "+topic +" " +message);    
		var status = message.toString();
		if (status == that.heat.on_value || status == that.heat.off_value) {
			that.heat.state = (status == that.heat.on_value) ? true : false;
			console.log("mqtt get heat set state "+that.heat.state);    
			that.heat_service.getCharacteristic(Characteristic.On).setValue(that.heat.state, undefined, 'fromSetValue');
		}
	  });
	
	  // Retrieve initial state
	  this.getInitState(accessory);
	}

	// Method to remove accessories from HomeKit
	mqttThermostatsPlatform.prototype.removeAccessory = function (accessory) {
	  if (accessory) {
		var name = accessory.context.name;
		this.log(name + " is removed from HomeBridge.");
		this.api.unregisterPlatformAccessories("homebridge-mqtt-thermostats-platform", "mqttThermostats", [accessory]);
		delete this.accessories[name];
	  }
	}

	// Method to setup listeners for different events
	mqttThermostatsPlatform.prototype.setService = function (accessory) {

		this.log(accessory.context.name + " setService ");

		accessory.on('identify', this.identify.bind(this, accessory.context));
	}
	
	// Method to retrieve initial state
	mqttThermostatsPlatform.prototype.getInitState = function (accessory) {
	  var manufacturer = accessory.context.manufacturer || "kakaki";
	  var model = accessory.context.model || "Kakaki-Thermostats";
	  var serial = accessory.context.serial || accessory.UUID;

	  // Update HomeKit accessory information
	  accessory.getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, manufacturer)
		.setCharacteristic(Characteristic.Model, model)
		.setCharacteristic(Characteristic.SerialNumber, serial);
	}

	// Method to handle identify request
	mqttThermostatsPlatform.prototype.identify = function (thisItem, paired, callback) {
	  this.log(thisItem.name + " identify requested!");
//	  callback();
	}

};
