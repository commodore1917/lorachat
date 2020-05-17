/**********************************************************
 * 
 * LoRaChat.
 * Chat over LoRa.
 * 2020. 
 * 
 **********************************************************/
#include <stdio.h>
#include <stdlib.h>
#include <sqlite3.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ESPAsyncWebServer.h>
#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include <FS.h>
#include <SPIFFS.h>
#include <mbedtls/md.h>
#include <hwcrypto/aes.h>

#define FORMAT_SPIFFS_IF_FAILED true

#define SS   18
#define RST  14
#define DIO0 26
#define FREQ 868E6

#define LORA_PACKET_ID_SIZE 8
#define LORA_TG_ID_SIZE 8

#define ROUTING 1
#define ROUTING_TABLE_SIZE 4

#define RECEIVED_BUFFER_SIZE 5

/*** LORACHAT CODES ***/
#define LORA_MSG 0
#define LORA_ACK 1
/**********************/

/*** WEBSOCKET CODES ***/
#define WS_ERROR -1
#define WS_SEND_MSG 0
#define WS_RECV_MSG 1
#define WS_RECV_ACK 2
#define WS_MSG_SENT 3
#define WS_DB_REQ 4
#define WS_DB_SEND 5
#define WS_DB_RECV 6
#define WS_ADD_CHAT 7
#define WS_DEL_CHAT 8
#define WS_SET_CHAT_KEY 9
#define WS_SET_WIFI_SSID 10
#define WS_SET_WIFI_KEY 11
#define WS_BUFFERED_MSG 12
/**********************/


typedef struct RoutingTable{
  String table[ROUTING_TABLE_SIZE];
  int last = 0;
}RoutingTable;

typedef struct ReceivedBuffer{
  String buf[RECEIVED_BUFFER_SIZE];
  int n = 0;
}ReceivedBuffer;

RoutingTable routingTable; // Storage for recently received packet's hashes
ReceivedBuffer messageBuffer; // Buffer for storing received messages when the client is not connected
 
WebSocketsServer webSocket = WebSocketsServer(81); // Servidor websocket: 192.168.4.1:81
AsyncWebServer server(80); // Servidor web: 192.168.4.1:80

sqlite3 *db; // Database
String db_response = ""; // Database query response

bool clientConnected = false;

void setup() {
 
  Serial.begin(9600);

  if(!SPIFFS.begin(FORMAT_SPIFFS_IF_FAILED)) Serial.println("[ERROR] SPIFFS Mount Failed");
  else Serial.println("[OK] SPIFFS active");

  sqlite3_initialize(); // Initialize SQLite engine
  //db_removeDatabase("lorachat.db");
  if(db_open("/spiffs/lorachat.db", &db)) Serial.println("[ERROR] Database init failed");
  else Serial.println("[OK] Database active"); 
  if(!db_check(db)) db_create(db); // If the database does not exist, creates it

  initWifiAP();
  Serial.println("[OK] WiFi AP active");
 
  initWebSocket();
  Serial.println("[OK] WebSocket server active");

  initWebServer();
  Serial.println("[OK] Web server active");

  initLoRa();
  Serial.println("[OK] LoRa active");
  
}
 
void loop() {
  
  onReceive(LoRa.parsePacket()); // Recibir paquete de LoRa
  
  webSocket.loop(); // Gestionar clientes del web socket
  
}




/********************************************************/
/*                        WIFI                          */ 
/********************************************************/

/**
 * WiFi AP setup and initialization.
 */
void initWifiAP() {
  /**
   * Set up an access point
   * @param ssid              Pointer to the SSID (max 63 char).
   * @param passphrase        (for WPA2 min 8 char, for open use NULL)
   * @param channel           WiFi channel number, 1 - 13.
   * @param ssid_hidden       Network cloaking (0 = broadcast SSID, 1 = hide SSID)
   * @param max_connection    Max simultaneous connected clients, 1 - 4.
  */
  String ssid_aux = db_getWifiSSID(db);
  char ssid_char[ssid_aux.length()+1];
  ssid_aux.toCharArray(ssid_char, ssid_aux.length()+1);
  const char* ssid = (const char*)ssid_char;
  String pass_aux = db_getWifiKey(db);
  char pass_char[pass_aux.length()+1];
  pass_aux.toCharArray(pass_char, pass_aux.length()+1);
  const char* pass = (const char*)pass_char;
  WiFi.softAP(ssid, pass, 6, 0, 1);
}





/**************************************************************/
/*                        Web Server                          */ 
/**************************************************************/

/**
 * Configures and intializes the web server.
 */
void initWebServer() {
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send(SPIFFS, "/index.html", "text/html");
  });
  
  server.on("/lorachat.css", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send(SPIFFS, "/lorachat.css", "text/css");
  });

  server.on("/lorachat.js", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send(SPIFFS, "/lorachat.js", "text/javascript");
  });
  
  server.begin(); // Begin web server
}






/*************************************************************/
/*                        WebSocket                          */ 
/*************************************************************/

/**
 * Handles with messages received over WebSocket.
 */
void webSocketMessageHandler(const char * msg) {

  const char * delim = "|";

  int type = atoi(strtok((char*)msg, delim));
  
  switch(type) {
    
    case WS_SEND_MSG: // Received LoRa message to send
    {
      int chatId = atoi(strtok(NULL, delim));
      int msgId = atoi(strtok(NULL, delim));
      int author = atoi(strtok(NULL, delim));
      char* messageText = strtok(NULL, delim);
      if(sendLoRaTextMessage(chatId, author, msgId, messageText))
        webSocketMsgSent(chatId, msgId, author); // Only if the packet was send.
    } break;
    
    case WS_DB_REQ: // Database requested
    {
      webSocketSendDatabase(db_getUserDB(db)); // send db
    } break;

    case WS_DB_SEND: // Database received
    {
      char* userDB = strtok(NULL, delim);
      db_setUserDB(db, userDB); // save db
      webSocketDatabaseReceived();
    } break;

    case WS_ADD_CHAT: // Add chat received
    {
      int chatId = atoi(strtok(NULL, delim));
      char* chatKey = strtok(NULL, delim);
      db_insertTG(db, chatId, chatKey);
    } break;

    case WS_DEL_CHAT: // Delete chat received
    {
      int chatId = atoi(strtok(NULL, delim));
      db_deleteTG(db, chatId);
    } break;

    case WS_SET_CHAT_KEY: // Set chat key received
    {
      int chatId = atoi(strtok(NULL, delim));
      char* chatKey = strtok(NULL, delim);
      db_setTGKey(db, chatId, chatKey);
    } break;

    case WS_SET_WIFI_SSID: // Set wifi SSID received
    {
      char* ssid = strtok(NULL, delim);
      db_setWifiSSID(db, ssid);
    } break;

    case WS_SET_WIFI_KEY: // Set wifi key received
    {
      char* key = strtok(NULL, delim);
      db_setWifiKey(db, key);
    } break;

    case WS_BUFFERED_MSG: // Send buffered messages
    {
      if(bufferedMessages()) {
        webSocketSendBufferedMessages();
        freeMessageBuffer();
      }
    } break;
    
    default: break;  
  }

}

/**
 * Generates a text message json to send it over websocket.
 */
String webSocketGenerateTextMessageJson(int talkgroupId, int messageId, int author, String messageText) {
  String json = "";
  json += "{\"type\":" + String(WS_RECV_MSG);
  json += ",\"chatId\":" + String(talkgroupId);
  json += ",\"msgId\":" + String(messageId);
  json += ",\"author\":" + String(author);
  json += ",\"text\":\"" + String(messageText);
  json += "\"}";
  return json;
}

/**
 * Sends a ws message from a LoRa received text message.
 */
void webSocketSendTextMessage(int talkgroupId, int messageId, int author, String messageText) {
  String json = webSocketGenerateTextMessageJson(talkgroupId, messageId, author, messageText);
  webSocket.broadcastTXT(json);
}

/**
 * Sends a ws message from a LoRa received ACK.
 */
String webSocketGenerateACKJson(int talkgroupId, int messageId, int author) {
  String json = "";
  json += "{\"type\":" + String(WS_RECV_ACK);
  json += ",\"chatId\":" + String(talkgroupId);
  json += ",\"msgId\":" + String(messageId);
  json += ",\"author\":" + String(author);
  json += "}";
  return json;
}

/**
 * Sends a ws message from a LoRa received ACK.
 */
void webSocketSendACK(int talkgroupId, int messageId, int author) {
  String json = webSocketGenerateACKJson(talkgroupId, messageId, author);
  webSocket.broadcastTXT(json);
}

/**
 * Confirms that a LoRa message has been sent.
 */
void webSocketMsgSent(int talkgroupId, int messageId, int author) {
  String json = "";
  json += "{\"type\":" + String(WS_MSG_SENT);
  json += ",\"chatId\":" + String(talkgroupId);
  json += ",\"msgId\":" + String(messageId);
  json += ",\"author\":" + String(author);
  json += "}";
  webSocket.broadcastTXT(json);
}

/**
 * Confirms that the database has been received.
 */
void webSocketDatabaseReceived() {
  String json = "";
  json += "{\"type\":" + String(WS_DB_RECV);
  json += "}";
  webSocket.broadcastTXT(json);
}

/**
 * Sends user's database over the web socket.
 */
void webSocketSendDatabase(String database) {
  String json = "";
  json += "{\"type\":" + String(WS_DB_SEND);
  json += ",\"db\":" + database;
  json += "}";
  webSocket.broadcastTXT(json);
}

/**
 * Sends buffered messages to client.
 */
void webSocketSendBufferedMessages() {
  for(int i=0; i<messageBuffer.n; i++) {
    webSocket.broadcastTXT(messageBuffer.buf[i]);
  }
}

/**
 * WebSocket event handler.
 */
void onWebSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
 
    case WStype_DISCONNECTED: // When client disconnects
      clientConnected = false;
      Serial.printf("[%u] Client disconnected!\n", num);
      break;

    case WStype_CONNECTED: // When client connects 
      {
        clientConnected = true;
        IPAddress ip = webSocket.remoteIP(num);
        Serial.printf("[%u] Connection from ", num);
        Serial.println(ip.toString());
      }
      break;

    case WStype_TEXT: // Text
      {
        //Serial.printf("[%u] get Text: %s\n", num, payload);
        webSocketMessageHandler((const char *)payload);
      }
      break;
      
    default: break;
  }
}

/**
 * Initializes WebSocket server.
 */
void initWebSocket() {
  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);  // Assign handler to event listener
}





/********************************************************/
/*                        LoRa                          */ 
/********************************************************/

/**
 * Initializes LoRa module.
 */
void initLoRa(){
  SPI.begin(SCK, MISO, MOSI, SS);
  LoRa.setPins(SS, RST, DIO0);
  LoRa.setTxPower(20); // Max is 20
  LoRa.enableCrc();
  if (!LoRa.begin(FREQ)) while (1); // 433 Mhz
}

/**
 * Sends a message over LoRa.
 */
int sendLoRaTextMessage(int talkgroupId, int author, int messageId, String messageText) {

  String barePacket = String(talkgroupId) + "|";
  barePacket += String(LORA_MSG) + "|";
  barePacket += String(author) + "|";
  barePacket += String(messageId) + "|";
  barePacket += messageText;
  String packetHash = packetHashedId(barePacket);
  String tgHash = talkgroupHashedId(String(talkgroupId));
  String encryptedPacket = str_AES256_enc(db_getTGKeyById(db, talkgroupId), tgHash, barePacket); // Get key and encrypt
  
  int b = LoRa.beginPacket();        
  LoRa.print(packetHash);
  LoRa.print("|");
  LoRa.print(tgHash);
  LoRa.print("|");
  LoRa.print(encryptedPacket);
  int e = LoRa.endPacket();

  if(ROUTING) insertPacketIntoRecents(packetHash);

  return b && e;
}

/**
 * Sends an ACK of a received message over LoRa.
 */
int sendLoRaACK(int talkgroupId, int author, int messageId) {

  String barePacket = String(talkgroupId) + "|";
  barePacket += String(LORA_ACK) + "|";
  barePacket += String(author) + "|";
  barePacket += String(messageId);
  String packetHash = packetHashedId(barePacket);
  String tgHash = talkgroupHashedId(String(talkgroupId));
  String encryptedPacket = str_AES256_enc(db_getTGKeyById(db, talkgroupId), tgHash, barePacket); // Get key and encrypt
  
  int b = LoRa.beginPacket();        
  LoRa.print(packetHash);
  LoRa.print("|");
  LoRa.print(tgHash);
  LoRa.print("|");
  LoRa.print(encryptedPacket);
  int e = LoRa.endPacket();

  if(ROUTING) insertPacketIntoRecents(packetHash);

  return b && e;
}

/***
 * Resends a packet over LoRa.
 */
int resendLoRaPacket(String packet) {

  int b = LoRa.beginPacket();        
  LoRa.print(packet);
  int e = LoRa.endPacket();

  return b && e;
}



/**
 * Performed when a LoRa packet is received.
 */
void onReceive(int packetSize) {

  if(!packetSize) return;

  // Get bare packet
  char packet[packetSize];
  char packet_copy[packetSize];
  int i = 0;
  while (LoRa.available()) { packet[i++] = (char)LoRa.read();}
  
  strcpy(packet_copy, packet);

  const char * delim = "|";

  // Extract packet id
  char* packetHashId = strtok(packet, delim);
  
  // Checks size of the packet id
  if(strlen(packetHashId) != LORA_PACKET_ID_SIZE) return;

  // Check if the packet is recent
  if(isPacketInRecents(String(packetHashId))) return; // If it is, ignore it
  
  // Resend
  if(ROUTING) resendLoRaPacket(packet_copy);

  // Insert packet into recents
  if(ROUTING) insertPacketIntoRecents(String(packetHashId));

  // Extract talkgroup id
  char* receivedTgHash = strtok(NULL, delim);

  // Checks size of the talkgroup id
  if(strlen(receivedTgHash) != LORA_TG_ID_SIZE) return;
  
  // Check if the tg is in my database
  if(!db_existsTGHash(db, receivedTgHash)) return; // If not, it is not for me

  char* encryptedPacket = strtok(NULL, delim);

  // Decrypt packet
  String decryptedPacket = str_AES256_dec(db_getTGKeyByHash(db, receivedTgHash), receivedTgHash, encryptedPacket); // Get key and encrypt
    
  // Check if decrypted packet hash id and received packet hash id are the same
  if(packetHashedId(decryptedPacket) != String(packetHashId)) return; // If not the same, break

  // Extract data from decrypted packet
  char dec[decryptedPacket.length()+1];
  decryptedPacket.toCharArray(dec, decryptedPacket.length()+1);
  int tgId = atoi(strtok(dec, delim));
  
  // Check if real tgHash and packet's tgHash are the same
  if(talkgroupHashedId(String(tgId)) != receivedTgHash) return; // If not the same, break
    
  int msgType = atoi(strtok(NULL, delim));
  int author = atoi(strtok(NULL, delim));
  int msgId = atoi(strtok(NULL, delim)); 
  
  switch(msgType) { // Message type actions
    
    case LORA_MSG: // Text message
    {
      sendLoRaACK(tgId, author, msgId); // Send ACK
      String text = String(strtok(NULL, delim));
      if(clientConnected) // if the client is connected
        webSocketSendTextMessage(tgId, msgId, author, text); // send message over ws
      else { // if the client is not connected
        String json = webSocketGenerateTextMessageJson(tgId, msgId, author, text);
        insertMessageInBuffer(json); // insert message into the buffer
      }
    } break;

    case LORA_ACK: { // Message ACK
      if(clientConnected) // if the client is connected
        webSocketSendACK(tgId, msgId, author); // send ack over ws
      else { // if the client is not connected
        String json = webSocketGenerateACKJson(tgId, msgId, author);
        insertMessageInBuffer(json); // insert message into the buffer
      }
    } break;
    
    default: break;
  }

}

/**
 * Returns the ID of a LoRa packet.
 */
String packetHashedId(String barePacket) {
  return strToSHA256(barePacket).substring(0, LORA_PACKET_ID_SIZE);
}

/**
 * Returns the hashed ID of a talkgroup.
 */
String talkgroupHashedId(String tgId) {
  return strToSHA256(tgId).substring(0, LORA_TG_ID_SIZE);
}





/**********************************************************/
/*                        SQLite                          */ 
/**********************************************************/

const char* data = "Callback function called";

/**
 * SQLite callback function.
 */
static int callback(void *data, int argc, char **argv, char **azColName) {
   int i;
   for (i = 0; i<argc-1; i++) {
      db_response += argv[i] ? argv[i] : "null";
      db_response += "/";
   }
   db_response += argv[argc-1] ? argv[argc-1] : "null";
   db_response += "|";
   //Serial.println(db_response);
   return 0;
}

/** 
 * Opens SQLite database.
 * Returns: 1 = error; 0 = ok;
 */
int db_open(const char *filename, sqlite3 **db) {
   int rc = sqlite3_open(filename, db);
   return rc;
}

/**
 * Checks if the database is created -> 0 = no, >0 = yes.
 */
int db_check(sqlite3 *db) {
  db_response = "";
  db_exec(db, "SELECT count(*) FROM sqlite_master WHERE type = 'table';");  
  db_response.remove(db_response.length()-1);
  return db_response.toInt();
}

/**
 * Creates and intializes tables on the database.
 */
int db_create(sqlite3 *db) {
  db_exec(db, "CREATE TABLE TALKGROUP(HASH VARCHAR(8), ID INT, KEY VARCHAR(64));");
  db_exec(db, "CREATE TABLE WIFI(ID INT, WIFI_SSID VARCHAR(32) DEFAULT 'LoraChat', WIFI_KEY VARCHAR(32) DEFAULT '');");
  db_exec(db, "INSERT INTO WIFI (ID) VALUES (1);");
  db_exec(db, "CREATE TABLE DATABASE(ID INT, DB TEXT);");
  db_exec(db, "INSERT INTO DATABASE (ID, DB) VALUES (1, '{\"user_id\": \"\",\"username\": \"LoRaChatter\",\"wifi_ssid\": \"LoRaChat\",\"wifi_key\": \"\",\"contacts\": [],\"chats\": []}');");
}

char *zErrMsg = 0;

/**
 * SQLite querys executor.
 */
int db_exec(sqlite3 *db, const char *sql) {
   //Serial.println(sql);
   long start = micros();
   int rc = sqlite3_exec(db, sql, callback, (void*)data, &zErrMsg);
   if (rc != SQLITE_OK) {
       Serial.printf("SQL error: %s\n", zErrMsg);
       sqlite3_free(zErrMsg);
   }
   //Serial.print(F("Time taken:"));
   //Serial.println(micros()-start);
   return rc;
}

/**
 * Removes the database from the storage.
 */
void db_removeDatabase(String filename) {
  SPIFFS.remove("/" + filename);
  SPIFFS.remove("/" + filename + "-journal");
}

/**
 * Sets the user's database (JSON) on SQLite database.
 */
int db_setUserDB(sqlite3 *db, String userDB) {
  String sql = "UPDATE DATABASE SET DB = '" + userDB + "' WHERE ID = 1;";
  return db_exec(db, sql.c_str());
}

/**
 * Gets the user's database (JSON) from SQLite database.
 */
String db_getUserDB(sqlite3 *db) {
  db_response = "";
  db_exec(db, "SELECT DB FROM DATABASE WHERE ID = 1;");
  db_response.remove(db_response.length()-1);
  return db_response;
}

/**
 * Inserts a new TG into the SQLite database.
 */
int db_insertTG(sqlite3 *db, int tgId, String tgKey) {
  String sql = "INSERT INTO TALKGROUP (HASH, ID, KEY) VALUES ('" + talkgroupHashedId(String(tgId))  + "', " + String(tgId) + ", '" + tgKey + "');";
  return db_exec(db, sql.c_str());
}

/**
 * Deletes a TG from the SQLite database.
 */
int db_deleteTG(sqlite3 *db, int tgId) {
  String sql = "DELETE FROM TALKGROUP WHERE ID = " + String(tgId) + ";";
  return db_exec(db, sql.c_str());
}

/**
 * Gets the hash id of a talkgroup from the SQLite database.
 */
String db_getTGHash(sqlite3 *db, int tgId) {
  db_response = "";
  String sql = "SELECT HASH FROM TALKGROUP WHERE ID = " + String(tgId) + ";";
  db_exec(db, sql.c_str());
  db_response.remove(db_response.length()-1);
  return db_response;
}

/**
 * Gets all TGs info from the SQLite database.
 */
String db_getTGs(sqlite3 *db) {
  db_response = "";
  String sql = "SELECT * FROM TALKGROUP;";
  db_exec(db, sql.c_str());
  db_response.remove(db_response.length()-1);
  return db_response;
}

/**
 * Checks if a TG hash exists in the SQLite database.
 * Returns: if exists = 1, else = 0.
 */
int db_existsTGHash(sqlite3 *db, String hash) {
  db_response = "";
  String sql = "SELECT COUNT(*) FROM TALKGROUP WHERE HASH = '" + String(hash) + "';";
  db_exec(db, sql.c_str());
  db_response.remove(db_response.length()-1);
  return db_response.toInt();
}

/**
 * Sets the key of a talkgroup into the SQLite database.
 */
int db_setTGKey(sqlite3 *db, int tgId, String tgKey) {
  String sql = "UPDATE TALKGROUP SET KEY = '" + String(tgKey) + "' WHERE ID = " + String(tgId) + ";";
  return db_exec(db, sql.c_str());
}

/**
 * Gets the key of a talkgroup by ID from the SQLite database.
 */
String db_getTGKeyById(sqlite3 *db, int tgId) {
  db_response = "";
  String sql = "SELECT KEY FROM TALKGROUP WHERE ID = " + String(tgId) + ";";
  db_exec(db, sql.c_str());
  db_response.remove(db_response.length()-1);
  return db_response;
}

/**
 * Gets the key of a talkgroup by hsh from the SQLite database.
 */
String db_getTGKeyByHash(sqlite3 *db, String hash) {
  db_response = "";
  String sql = "SELECT KEY FROM TALKGROUP WHERE HASH = '" + String(hash) + "';";
  db_exec(db, sql.c_str());
  db_response.remove(db_response.length()-1);
  return db_response;
}

/**
 * Sets the wifi key into the SQLite database.
 */
int db_setWifiKey(sqlite3 *db, String wifiKey) {
  String sql = "UPDATE WIFI SET WIFI_KEY = '" + String(wifiKey) + "' WHERE ID = 1;";
  return db_exec(db, sql.c_str());
}

/**
 * Sets the wifi SSID into the SQLite database.
 */
int db_setWifiSSID(sqlite3 *db, String wifiSSID) {
  String sql = "UPDATE WIFI SET WIFI_SSID = '" + String(wifiSSID) + "' WHERE ID = 1;";
  return db_exec(db, sql.c_str());
}

/**
 * Gets the wifi key from the SQLite database.
 */
String db_getWifiKey(sqlite3 *db) {
  db_response = "";
  db_exec(db, "SELECT WIFI_KEY FROM WIFI WHERE ID = 1;");
  db_response.remove(db_response.length()-1);
  return db_response;
}

/**
 * Gets the wifi ssid from the SQLite database.
 */
String db_getWifiSSID(sqlite3 *db) {
  db_response = "";
  db_exec(db, "SELECT WIFI_SSID FROM WIFI WHERE ID = 1;");
  db_response.remove(db_response.length()-1);
  return db_response;
}






/***************************************************/
/*                    ROUTING                      */ 
/***************************************************/

/**
 * Inserts the hash of a packet in the routing table.
 */
void insertPacketIntoRecents(String hash) {
  if(routingTable.last == ROUTING_TABLE_SIZE) routingTable.last = 0;
  routingTable.table[routingTable.last] = hash;
  routingTable.last++;
}

/**
 * Checks if the hash of a packet is in the routing table.
 * Returns: 1 if yes, else 0.
 */
int isPacketInRecents(String hash){
  for(int i=0; i<ROUTING_TABLE_SIZE; i++) 
    if(routingTable.table[i] == hash) return 1;
  return 0;  
}

/**
 * Prints the routing table.
 */
void printRoutingTable(){
  Serial.println("---ROUTING TABLE---");
  for(int i=0; i<ROUTING_TABLE_SIZE; i++) {
    Serial.println("[" + String(i) + "] = " + routingTable.table[i]);  
  }
}




/**********************************************************/
/*                    MESSAGE BUFFER                      */ 
/**********************************************************/

/**
 * Inserts a message in the buffer.
 */
void insertMessageInBuffer(String msg) {
  if(messageBuffer.n < RECEIVED_BUFFER_SIZE) {
    messageBuffer.buf[messageBuffer.n] = msg;
    messageBuffer.n++;
  }
}

/**
 * Returns number of buffered messages.
 */
int bufferedMessages() {
  return messageBuffer.n;  
}

/**
 * "Frees" the message buffer.
 */
void freeMessageBuffer() {
  messageBuffer.n = 0;
}

/**
 * Prints the message buffer
 */
void printMessageBuffer(){
  Serial.println("---MSG BUFFER---");
  for(int i=0; i<RECEIVED_BUFFER_SIZE; i++) {
    Serial.println("[" + String(i) + "] = " + messageBuffer.buf[i]);  
  }
}





/*******************************************************/
/*                    Cyptography                      */ 
/*******************************************************/

/**
 * Returns the SHA256 hash of a string.
 */
String strToSHA256(String input) {
    
  char payload[input.length()+1];
  input.toCharArray(payload, input.length()+1);
  
  byte shaResult[32]; 
  
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char *) payload, strlen(payload));
  mbedtls_md_finish(&ctx, shaResult);
  mbedtls_md_free(&ctx);
 
  String output;
  for(int i= 0; i< sizeof(shaResult); i++){
      char str[3];
      sprintf(str, "%02x", (int)shaResult[i]);
      output += str;
  }
  return output;
}

/**
 * Encrypts a string with AES256.
 * Receives: (key, string)
 * Returns: encrypted string
 */
String str_AES256_enc(String i_key, String salt, String input) {

  char s2[input.length()+1];
  input.toCharArray(s2, input.length()+1);
  size_t bs = ((input.length()/16)+1)*16;
  
  char plaintext[bs];
  char encrypted[bs];
  
  char key[256];
  String o_key = strToSHA256(i_key);
  o_key.toCharArray(key, 256);
  
  char iv[16];
  String o_iv = strToSHA256(salt).substring(48,64);
  o_iv.toCharArray(iv, 16);
  
  memset(plaintext, 0, sizeof(plaintext));
  memset(encrypted, 0, sizeof(encrypted));
  strcpy(plaintext, (const char*)s2);
  
  esp_aes_context aes;
  esp_aes_init(&aes);
  esp_aes_setkey(&aes, (const unsigned char *)key, 256);
  esp_aes_crypt_cbc(&aes, ESP_AES_ENCRYPT, sizeof(plaintext), (unsigned char*)iv, (uint8_t*)plaintext, (uint8_t*)encrypted);
  esp_aes_free(&aes);
  memset(plaintext, 0, sizeof( plaintext));
  memset(iv, 0, sizeof(iv));

  return encrypted;
}

/**
 * Decrypts an AES256 encrypted string.
 * Receives: (key, string)
 * Returns: plaintext string
 */
String str_AES256_dec(String i_key, String salt, String input) {
  
  char s2[input.length()+1];
  input.toCharArray(s2, input.length()+1);
  size_t bs = ((input.length()/16)+1)*16;
  
  char plaintext[bs];
  char encrypted[bs];
  
  char key[256];
  String o_key = strToSHA256(i_key);
  o_key.toCharArray(key, 256);
  
  char iv[16];
  String o_iv = strToSHA256(salt).substring(48,64);
  o_iv.toCharArray(iv, 16);
  
  memset(encrypted, 0, sizeof(encrypted));
  strcpy(encrypted, (const char*)s2);
 
  esp_aes_context aes;
  esp_aes_init(&aes);
  esp_aes_setkey(&aes, (const unsigned char *)key, 256);
  esp_aes_crypt_cbc(&aes, ESP_AES_DECRYPT, sizeof(encrypted), (unsigned char*)iv, (uint8_t*)encrypted, (uint8_t*)plaintext);
  esp_aes_free(&aes);

  return plaintext;
}
