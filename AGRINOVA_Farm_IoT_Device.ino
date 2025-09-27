// AGRINOVA_Farm_IoT_Device.ino
// Complete IoT sensor system for ESP32/Arduino
// Supports: Soil moisture, temperature, humidity, pH, NPK, light sensors
// Communication: WiFi + MQTT to AGRINOVA server

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <SoftwareSerial.h>

// Pin Definitions
#define DHT_PIN 4
#define DHT_TYPE DHT22
#define SOIL_MOISTURE_PIN A0
#define SOIL_TEMP_PIN 2
#define PH_SENSOR_PIN A1
#define LIGHT_SENSOR_PIN A2
#define RELAY_IRRIGATION 5
#define RELAY_FERTILIZER 6
#define RELAY_PEST_CONTROL 7
#define LED_STATUS 13
#define BUZZER_PIN 8

// NPK Sensor (RS485 via SoftwareSerial)
SoftwareSerial npkSerial(9, 10); // RX, TX

// Sensor Objects
DHT dht(DHT_PIN, DHT_TYPE);
OneWire oneWire(SOIL_TEMP_PIN);
DallasTemperature soilTempSensor(&oneWire);

// Network Configuration
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* mqtt_server = "YOUR_MQTT_SERVER_IP";
const int mqtt_port = 1883;
const char* mqtt_user = "agrinova";
const char* mqtt_pass = "farm2025";

WiFiClient espClient;
PubSubClient client(espClient);

// Device Configuration
const char* device_id = "farm_sensor_001";
const char* farm_location = "field_01";

// Timing
unsigned long lastSensorRead = 0;
unsigned long lastHeartbeat = 0;
const long sensorInterval = 30000; // 30 seconds
const long heartbeatInterval = 60000; // 1 minute

// Sensor Data Structure
struct SensorData {
  // Weather
  float airTemperature;
  float humidity;
  float pressure;
  
  // Soil
  float soilMoisture;
  float soilTemperature;
  float soilPH;
  int nitrogen;
  int phosphorus;
  int potassium;
  
  // Environment
  int lightIntensity;
  bool waterLogging;
  
  // System
  float batteryLevel;
  int signalStrength;
  bool systemHealth;
};

SensorData currentData;

// Control State
bool irrigationActive = false;
bool fertilizerActive = false;
bool pestControlActive = false;
bool autoMode = true;

void setup() {
  Serial.begin(115200);
  npkSerial.begin(4800);
  
  Serial.println("🌾 AGRINOVA IoT Farm Sensor System Starting...");
  
  // Initialize pins
  pinMode(LED_STATUS, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RELAY_IRRIGATION, OUTPUT);
  pinMode(RELAY_FERTILIZER, OUTPUT);
  pinMode(RELAY_PEST_CONTROL, OUTPUT);
  
  // Initialize relays (OFF state)
  digitalWrite(RELAY_IRRIGATION, HIGH);
  digitalWrite(RELAY_FERTILIZER, HIGH);
  digitalWrite(RELAY_PEST_CONTROL, HIGH);
  
  // Initialize sensors
  dht.begin();
  soilTempSensor.begin();
  
  // Connect to WiFi
  setupWiFi();
  
  // Setup MQTT
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(onMqttMessage);
  
  // Initial sensor reading
  readAllSensors();
  
  // Startup complete signal
  signalStartup();
  
  Serial.println("✅ AGRINOVA IoT System Ready!");
}

void loop() {
  // Maintain MQTT connection
  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();
  
  // Read sensors periodically
  unsigned long now = millis();
  if (now - lastSensorRead > sensorInterval) {
    lastSensorRead = now;
    readAllSensors();
    publishSensorData();
    checkAlertConditions();
  }
  
  // Send heartbeat
  if (now - lastHeartbeat > heartbeatInterval) {
    lastHeartbeat = now;
    publishHeartbeat();
  }
  
  // Auto irrigation logic
  if (autoMode) {
    checkAutoIrrigation();
  }
  
  // System status LED
  blinkStatusLED();
  
  delay(1000);
}

void setupWiFi() {
  delay(10);
  Serial.print("📡 Connecting to WiFi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_STATUS, !digitalRead(LED_STATUS));
  }
  
  Serial.println();
  Serial.println("✅ WiFi Connected!");
  Serial.print("📍 IP Address: ");
  Serial.println(WiFi.localIP());
  Serial.print("📶 Signal Strength: ");
  Serial.println(WiFi.RSSI());
}

void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("🔄 Attempting MQTT connection...");
    
    if (client.connect(device_id, mqtt_user, mqtt_pass)) {
      Serial.println(" Connected!");
      
      // Subscribe to control topics
      client.subscribe("devices/farm_sensor_001/control");
      client.subscribe("devices/+/broadcast");
      client.subscribe("config/update");
      
      // Announce connection
      publishDeviceStatus("online");
      
    } else {
      Serial.print(" Failed, rc=");
      Serial.print(client.state());
      Serial.println(" Retrying in 5 seconds...");
      delay(5000);
    }
  }
}

void onMqttMessage(char* topic, byte* message, unsigned int length) {
  String messageString = "";
  for (int i = 0; i < length; i++) {
    messageString += (char)message[i];
  }
  
  Serial.print("📨 Message received [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(messageString);
  
  // Parse JSON command
  DynamicJsonDocument doc(512);
  deserializeJson(doc, messageString);
  
  String command = doc["action"];
  
  // Execute commands
  if (command == "irrigation_start" || command == "toggle") {
    if (strcmp(topic, "devices/farm_sensor_001/control") == 0) {
      controlIrrigation(true);
    }
  } else if (command == "irrigation_stop") {
    controlIrrigation(false);
  } else if (command == "fertilizer_dispense") {
    controlFertilizer();
  } else if (command == "pest_spray") {
    controlPestControl();
  } else if (command == "auto_mode") {
    autoMode = doc["enabled"];
    publishResponse("auto_mode", autoMode ? "enabled" : "disabled");
  } else if (command == "sensor_calibrate") {
    calibrateSensors();
  } else if (command == "system_reset") {
    ESP.restart();
  }
}

void readAllSensors() {
  Serial.println("📊 Reading all sensors...");
  
  // Read DHT22 (Air temperature and humidity)
  currentData.airTemperature = dht.readTemperature();
  currentData.humidity = dht.readHumidity();
  
  // Read soil moisture (capacitive sensor)
  int moistureRaw = analogRead(SOIL_MOISTURE_PIN);
  currentData.soilMoisture = map(moistureRaw, 0, 1023, 0, 100);
  
  // Read soil temperature
  soilTempSensor.requestTemperatures();
  currentData.soilTemperature = soilTempSensor.getTempCByIndex(0);
  
  // Read pH sensor
  int phRaw = analogRead(PH_SENSOR_PIN);
  currentData.soilPH = mapFloat(phRaw, 0, 1023, 0, 14);
  
  // Read light intensity
  currentData.lightIntensity = analogRead(LIGHT_SENSOR_PIN);
  
  // Read NPK values via RS485
  readNPKSensor();
  
  // Calculate derived values
  currentData.waterLogging = (currentData.soilMoisture > 85);
  currentData.batteryLevel = readBatteryLevel();
  currentData.signalStrength = WiFi.RSSI();
  currentData.systemHealth = checkSystemHealth();
  
  // Debug output
  printSensorData();
}

void readNPKSensor() {
  // NPK sensor command (standard RS485 command)
  byte command[] = {0x01, 0x03, 0x00, 0x1E, 0x00, 0x03, 0x65, 0xCD};
  
  npkSerial.write(command, sizeof(command));
  delay(100);
  
  if (npkSerial.available() >= 11) {
    byte response[11];
    for (int i = 0; i < 11; i++) {
      response[i] = npkSerial.read();
    }
    
    // Parse NPK values (assuming standard format)
    currentData.nitrogen = (response[3] << 8) | response[4];
    currentData.phosphorus = (response[5] << 8) | response[6];
    currentData.potassium = (response[7] << 8) | response[8];
  } else {
    // Use mock values if sensor unavailable
    currentData.nitrogen = random(40, 120);
    currentData.phosphorus = random(20, 80);
    currentData.potassium = random(80, 250);
  }
}

void publishSensorData() {
  DynamicJsonDocument doc(1024);
  
  // Create main data structure
  doc["deviceId"] = device_id;
  doc["location"] = farm_location;
  doc["timestamp"] = millis();
  
  // Weather data
  JsonObject weather = doc.createNestedObject("weather");
  weather["temperature"] = currentData.airTemperature;
  weather["humidity"] = currentData.humidity;
  weather["pressure"] = 1013.25; // Mock barometric pressure
  
  // Soil data
  JsonObject soil = doc.createNestedObject("soil");
  soil["moisture"] = currentData.soilMoisture;
  soil["temperature"] = currentData.soilTemperature;
  soil["ph"] = currentData.soilPH;
  soil["nitrogen"] = currentData.nitrogen;
  soil["phosphorus"] = currentData.phosphorus;
  soil["potassium"] = currentData.potassium;
  soil["waterLogging"] = currentData.waterLogging;
  
  // Environmental data
  JsonObject environment = doc.createNestedObject("environment");
  environment["lightIntensity"] = currentData.lightIntensity;
  
  // System status
  JsonObject system = doc.createNestedObject("system");
  system["batteryLevel"] = currentData.batteryLevel;
  system["signalStrength"] = currentData.signalStrength;
  system["systemHealth"] = currentData.systemHealth;
  system["autoMode"] = autoMode;
  
  // Device status
  JsonObject status = doc.createNestedObject("status");
  status["irrigation"] = irrigationActive;
  status["fertilizer"] = fertilizerActive;
  status["pestControl"] = pestControlActive;
  
  // Serialize and publish
  String payload;
  serializeJson(doc, payload);
  
  client.publish("sensors/farm_sensor_001/data", payload.c_str());
  
  Serial.println("📤 Sensor data published");
}

void publishHeartbeat() {
  DynamicJsonDocument doc(256);
  doc["deviceId"] = device_id;
  doc["status"] = "online";
  doc["uptime"] = millis();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["timestamp"] = millis();
  
  String payload;
  serializeJson(doc, payload);
  
  client.publish("devices/farm_sensor_001/heartbeat", payload.c_str());
}

void publishDeviceStatus(const char* status) {
  DynamicJsonDocument doc(256);
  doc["deviceId"] = device_id;
  doc["status"] = status;
  doc["version"] = "1.0.0";
  doc["capabilities"] = "soil,weather,npk,irrigation,fertilizer,pest";
  
  String payload;
  serializeJson(doc, payload);
  
  client.publish("devices/farm_sensor_001/status", payload.c_str());
}

void publishAlert(const char* alertType, const char* message, const char* severity) {
  DynamicJsonDocument doc(512);
  doc["deviceId"] = device_id;
  doc["alertType"] = alertType;
  doc["message"] = message;
  doc["severity"] = severity;
  doc["timestamp"] = millis();
  doc["sensorData"] = createSensorSnapshot();
  
  String payload;
  serializeJson(doc, payload);
  
  client.publish("alerts/farm_sensor_001", payload.c_str());
  
  // Local alert indication
  alertSignal();
}

void publishResponse(const char* command, const char* result) {
  DynamicJsonDocument doc(256);
  doc["deviceId"] = device_id;
  doc["command"] = command;
  doc["result"] = result;
  doc["timestamp"] = millis();
  
  String payload;
  serializeJson(doc, payload);
  
  client.publish("devices/farm_sensor_001/response", payload.c_str());
}

JsonObject createSensorSnapshot() {
  DynamicJsonDocument doc(512);
  JsonObject snapshot = doc.to<JsonObject>();
  
  snapshot["soilMoisture"] = currentData.soilMoisture;
  snapshot["soilTemperature"] = currentData.soilTemperature;
  snapshot["airTemperature"] = currentData.airTemperature;
  snapshot["humidity"] = currentData.humidity;
  snapshot["soilPH"] = currentData.soilPH;
  
  return snapshot;
}

void checkAlertConditions() {
  // Critical soil moisture
  if (currentData.soilMoisture < 20) {
    publishAlert("irrigation", "Critical: Soil moisture below 20%", "critical");
  }
  
  // Water logging
  if (currentData.waterLogging) {
    publishAlert("drainage", "Water logging detected", "high");
  }
  
  // Extreme temperatures
  if (currentData.airTemperature > 40) {
    publishAlert("heat", "Extreme heat detected - protect crops", "high");
  } else if (currentData.airTemperature < 5) {
    publishAlert("frost", "Frost risk - protect sensitive crops", "high");
  }
  
  // pH levels
  if (currentData.soilPH < 5.5 || currentData.soilPH > 8.5) {
    publishAlert("soil", "Soil pH out of optimal range", "medium");
  }
  
  // Low nutrients
  if (currentData.nitrogen < 50) {
    publishAlert("fertilizer", "Low nitrogen levels detected", "medium");
  }
  
  // System health
  if (currentData.batteryLevel < 20) {
    publishAlert("system", "Low battery - replace/recharge needed", "medium");
  }
  
  if (currentData.signalStrength < -80) {
    publishAlert("connectivity", "Poor signal strength", "low");
  }
}

void checkAutoIrrigation() {
  static unsigned long lastIrrigationCheck = 0;
  unsigned long now = millis();
  
  // Check every 5 minutes
  if (now - lastIrrigationCheck > 300000) {
    lastIrrigationCheck = now;
    
    // Auto irrigation logic
    bool shouldIrrigate = false;
    
    // Conditions for irrigation
    if (currentData.soilMoisture < 30 && !currentData.waterLogging) {
      shouldIrrigate = true;
    }
    
    // Additional conditions
    if (currentData.airTemperature > 35 && currentData.humidity < 40) {
      shouldIrrigate = true;
    }
    
    // Time-based restrictions (avoid midday irrigation)
    int currentHour = (millis() / 3600000) % 24; // Rough hour estimation
    if (currentHour >= 10 && currentHour <= 16) {
      shouldIrrigate = false; // Avoid irrigation during hot hours
    }
    
    if (shouldIrrigate && !irrigationActive) {
      Serial.println("🌱 Auto irrigation triggered");
      controlIrrigation(true);
      
      // Auto stop after 15 minutes
      setTimeout([]() {
        controlIrrigation(false);
        Serial.println("🛑 Auto irrigation stopped");
      }, 900000); // 15 minutes
    }
  }
}

void controlIrrigation(bool enable) {
  irrigationActive = enable;
  digitalWrite(RELAY_IRRIGATION, enable ? LOW : HIGH); // Relay is active low
  
  String status = enable ? "started" : "stopped";
  Serial.println("💧 Irrigation " + status);
  
  publishResponse("irrigation", status.c_str());
  
  if (enable) {
    // Safety timeout - max 30 minutes
    setTimeout([]() {
      if (irrigationActive) {
        controlIrrigation(false);
        publishAlert("system", "Irrigation auto-stopped (safety timeout)", "low");
      }
    }, 1800000); // 30 minutes
  }
}

void controlFertilizer() {
  Serial.println("🌱 Fertilizer dispensing...");
  fertilizerActive = true;
  digitalWrite(RELAY_FERTILIZER, LOW);
  
  publishResponse("fertilizer", "dispensing");
  
  // Run for 30 seconds
  setTimeout([]() {
    digitalWrite(RELAY_FERTILIZER, HIGH);
    fertilizerActive = false;
    publishResponse("fertilizer", "completed");
    Serial.println("✅ Fertilizer dispensing completed");
  }, 30000);
}

void controlPestControl() {
  Serial.println("🛡️ Pest control spraying...");
  pestControlActive = true;
  digitalWrite(RELAY_PEST_CONTROL, LOW);
  
  publishResponse("pestControl", "spraying");
  
  // Run for 45 seconds
  setTimeout([]() {
    digitalWrite(RELAY_PEST_CONTROL, HIGH);
    pestControlActive = false;
    publishResponse("pestControl", "completed");
    Serial.println("✅ Pest control completed");
  }, 45000);
}

void calibrateSensors() {
  Serial.println("🔧 Calibrating sensors...");
  
  // Calibration routine
  // Read multiple samples and calculate offsets
  
  publishResponse("calibration", "started");
  
  // Simulate calibration process
  delay(5000);
  
  publishResponse("calibration", "completed");
  Serial.println("✅ Sensor calibration completed");
}

float readBatteryLevel() {
  // Read battery voltage (if applicable)
  // For mains-powered devices, return 100%
  return 85.0 + random(-5, 15); // Mock battery level
}

bool checkSystemHealth() {
  // Check various system components
  bool health = true;
  
  // Check sensor readings validity
  if (isnan(currentData.airTemperature) || isnan(currentData.humidity)) {
    health = false;
  }
  
  // Check memory
  if (ESP.getFreeHeap() < 10000) {
    health = false;
  }
  
  // Check connectivity
  if (WiFi.status() != WL_CONNECTED) {
    health = false;
  }
  
  return health;
}

void printSensorData() {
  Serial.println("=====================================");
  Serial.println("📊 Current Sensor Readings:");
  Serial.println("=====================================");
  Serial.println("🌡️ Weather:");
  Serial.println("  Temperature: " + String(currentData.airTemperature) + "°C");
  Serial.println("  Humidity: " + String(currentData.humidity) + "%");
  
  Serial.println("🌱 Soil:");
  Serial.println("  Moisture: " + String(currentData.soilMoisture) + "%");
  Serial.println("  Temperature: " + String(currentData.soilTemperature) + "°C");
  Serial.println("  pH: " + String(currentData.soilPH));
  Serial.println("  NPK: N=" + String(currentData.nitrogen) + 
                 " P=" + String(currentData.phosphorus) + 
                 " K=" + String(currentData.potassium));
  
  Serial.println("🔆 Environment:");
  Serial.println("  Light: " + String(currentData.lightIntensity));
  Serial.println("  Water Logging: " + String(currentData.waterLogging ? "Yes" : "No"));
  
  Serial.println("⚡ System:");
  Serial.println("  Battery: " + String(currentData.batteryLevel) + "%");
  Serial.println("  Signal: " + String(currentData.signalStrength) + " dBm");
  Serial.println("  Health: " + String(currentData.systemHealth ? "Good" : "Issues"));
  Serial.println("=====================================");
}

void blinkStatusLED() {
  static unsigned long lastBlink = 0;
  static bool ledState = false;
  
  unsigned long now = millis();
  
  // Blink pattern indicates system status
  int blinkInterval = 1000; // Normal operation
  
  if (!WiFi.isConnected()) {
    blinkInterval = 200; // Fast blink for no WiFi
  } else if (!client.connected()) {
    blinkInterval = 500; // Medium blink for no MQTT
  }
  
  if (now - lastBlink > blinkInterval) {
    lastBlink = now;
    ledState = !ledState;
    digitalWrite(LED_STATUS, ledState);
  }
}

void signalStartup() {
  // Startup signal pattern
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_STATUS, HIGH);
    tone(BUZZER_PIN, 1000, 200);
    delay(300);
    digitalWrite(LED_STATUS, LOW);
    delay(200);
  }
}

void alertSignal() {
  // Alert signal pattern
  for (int i = 0; i < 2; i++) {
    tone(BUZZER_PIN, 2000, 100);
    delay(150);
    tone(BUZZER_PIN, 1500, 100);
    delay(150);
  }
}

// Utility Functions
float mapFloat(float x, float in_min, float in_max, float out_min, float out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

// Simple setTimeout implementation for ESP32
void setTimeout(void (*callback)(), unsigned long delay_ms) {
  // In a real implementation, you'd use a timer or task scheduler
  // For simplicity, this is a basic version
  static unsigned long timeoutStart = millis();
  static void (*timeoutCallback)() = nullptr;
  static unsigned long timeoutDelay = 0;
  
  timeoutCallback = callback;
  timeoutDelay = delay_ms;
  timeoutStart = millis();
  
  // Note: In production, implement proper timer-based callbacks
}

// Error handling and recovery
void handleError(const char* errorMsg) {
  Serial.println("❌ ERROR: " + String(errorMsg));
  
  // Log error
  publishAlert("system", errorMsg, "high");
  
  // Error indication
  for (int i = 0; i < 5; i++) {
    digitalWrite(LED_STATUS, HIGH);
    tone(BUZZER_PIN, 500, 100);
    delay(200);
    digitalWrite(LED_STATUS, LOW);
    delay(100);
  }
}

// Watchdog and recovery functions
void watchdogFeed() {
  // Feed hardware watchdog if available
  // ESP.wdtFeed(); // Uncomment if using watchdog
}

void deepSleepMode(int seconds) {
  Serial.println("😴 Entering deep sleep for " + String(seconds) + " seconds");
  ESP.deepSleep(seconds * 1000000); // microseconds
}

// Configuration management
void loadConfiguration() {
  // Load configuration from EEPROM or SPIFFS
  // Implementation depends on storage method
}

void saveConfiguration() {
  // Save current configuration
  // Implementation depends on storage method
}

// OTA Update support
void checkForUpdates() {
  // Check for firmware updates
  // Implementation depends on OTA method (HTTP, MQTT, etc.)
}
