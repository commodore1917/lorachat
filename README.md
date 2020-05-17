# LoRaChat (0.1)

LoRaChat is a text chat over the physical layer LoRa using ESP32, wich creates a mesh network. The only two things needed to get LoRaChat working are a TTGO LoRa ESP32 (or an ESP32 + a LoRa module) and any device capable of running a web browser (PC, laptop, smartphone, tablet, smartTV,...).

The ESP32 creates a WiFi hotspot to which any device with a screen and a browser can connect. The chat GUI is displayed in the browser, like any other web based chat. The difference is that this chat sends the messages over LoRa radio modulation.

All radio communications are encrypted by default with AES-256 CBC in order to keep the conversations private.

The different LoRaChat devices create with each other a mesh network, making the range of the chat much bigger. Each device acts, then, as a router and as a client at the same time.

## Installation

#### Dependencies

   * [Arduino IDE] - Official Arduino programming IDE.
   * [ESP32 API] - ESP32 tools for Arduino IDE.
   * [ESP32 Filesystem plugin] - Arduino IDE plugin for uploading files to ESP32.
    

#### Libraries

Here only we consider those libraries that are not included by default with the Arduino IDE, the ESP32 API or the ESP32 Filesystem plugin.

   * [ESPAsyncWebServer.h] - Async web server for ESP32.
   * [WebSocketsServer.h] - WebSockets implementation for ESP32.
   * [LoRa.h] - LoRa library for arduino.
   * [sqlite3.h] - SQLite 3 implementation for ESP32.


#### Installation process

1. Open lorachat.ino in the Arduino IDE.
2. With the ESP32 plugged in, go to "Tools" and use "ESP32 Sketch Data Upload" option. Wait until the data is uploaded. (Do not change the name of the folder /data. It also needs to be in the same directory of lorachat.ino sketch).
3. Upload lorachat.ino sketch to the ESP32.

#### Setup

Once the code is uploaded and the ESP32 is running, connect to the WiFi hotspot named "LoRaChat", wich it has not any encryption key.

Go to the web browser and navigate to 192.168.4.1 local IP. A web page will appear displaying the GUI. It is very intuitive, like any other chat app GUI.

It is important, but not mandatory, to change the WiFi key in Main Settings (click on the top left dots icon and then on Main Settings). If the WiFi key input is empty, the WiFi hotspot will not be protected. If a key is set, the hotspot will be protected with WPA2. The changes apply when the ESP32 is rebooted.


[Arduino IDE]: https://www.arduino.cc/en/Main/Software
[ESP32 API]: https://github.com/espressif/arduino-esp32
[ESP32 Filesystem plugin]: https://github.com/me-no-dev/arduino-esp32fs-plugin/releases/
[ESPAsyncWebServer.h]: https://github.com/me-no-dev/ESPAsyncWebServer
[WebSocketsServer.h]: https://github.com/Links2004/arduinoWebSockets
[LoRa.h]: https://github.com/sandeepmistry/arduino-LoRa
[sqlite3.h]: https://github.com/LuaDist/libsqlite3

## Contact

comodore1917@protonmail.com

License
----

GNU GPLv3
