/**
 * 
 * LoRaChat Javascript.
 * Implements the engine of the LoRaChat web client.
 * 
 */


/*** LORACHAT CODES ***/
var LORA_MSG = 0;
var LORA_ACK = 1;
/**********************/

/*** WEBSOCKET CODES ***/
var WS_ERROR = -1;
var WS_SEND_MSG = 0;
var WS_RECV_MSG = 1;
var WS_RECV_ACK = 2;
var WS_MSG_SENT = 3;
var WS_DB_REQ = 4;
var WS_DB_SEND = 5;
var WS_DB_RECV = 6;
var WS_ADD_CHAT = 7;
var WS_DEL_CHAT = 8;
var WS_SET_CHAT_KEY = 9;
var WS_SET_WIFI_SSID = 10;
var WS_SET_WIFI_KEY = 11;
var WS_BUFFERED_MSG = 12;
/**********************/

/*** MESSAGE STATUS CODES ***/
var MSG_PENDING = 0;
var MSG_SENT = 1;
var MSG_RECEIVED = 2;
/****************************/

var WS; // WebSocket
var DATABASE;
var ACTIVE_CHAT;
var SOCKET_READY = false;
var DATABASE_LOADED = false;


/*********************/
/*      GENERAL      */
/*********************/

/**
 * Performed before closing the window.
 */
window.onbeforeunload = function() {
    // Save (send) the database
    com_sendPacket(com_generateSendDatabasePacket());
};

/**
 * Asks for notification permission.
 */
function gen_askForNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted")
        Notification.requestPermission();
}

/**
 * Notifies a new message in a chat.
 * @param {string} chat 
 */
function gen_notify(chat) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted")
        new Notification("New message on " + chat); 
}

/**
 * Initializes the WebSocket.
 */
function gen_initWebSocket() {

    // Connect to WebSocket server
    WS = new WebSocket("ws://192.168.4.1:81");

    WS.onopen = function() {
        SOCKET_READY = true;
        if(!DATABASE_LOADED) {
            com_requestDatabase();  
        }
        com_sendPacket(com_generateBufferedMsgRequestPacket());
        gui_closeWebSocketModal();
    }
    
    WS.onmessage = function(evt) {
        com_packetHandling(evt.data);
    };

    WS.onclose = function() {
        SOCKET_READY = false;
        gui_openWebSocketModal();
        WS = null;
        setTimeout(gen_initWebSocket, 1000);
    }

    WS.onerror = function() {
        gui_alert("WebSocket error.", "red");
    }
}

/**
 * Waits until websocket is connected.
 * @param {WebSocket} socket 
 */
function gen_waitForSocketConnection(){
    setTimeout(
        function () {
            if (!SOCKET_READY) {
                gen_waitForSocketConnection();
            }
        }, 5);
}

/**
 * Executed when the page is loaded.
 */
function gen_onPageLoad(){
    gui_openWebSocketModal();
    gen_initWebSocket();
    gui_loadGUI(DATABASE);
    document.getElementById("chat-msg-screen").scrollTo(0, document.getElementById("chat-msg-screen").scrollHeight);
    gen_askForNotificationPermission();
}

/**
 * Generates and returns a complex message id:
 * chat-author-msg
 * @param {int} chatId 
 * @param {int} author 
 * @param {int} msgId 
 * @returns chat-author-msg
 */
function gen_generateMsgId(chatId, author, msgId) {
    return chatId + "-" + author + "-" + msgId;
}

/**
 * Parses a complex msgId and returns a list:
 * [0] = chat ID
 * [1] = author
 * [2] = message ID
 * @param {string} msgId message id (chat-author-msg)
 * @returns [chatId, author, messageId]
 */
function gen_parseMsgId(msgId) {
    return msdId.split("-");
}



/**************************************/
/*      Communication with ESP32      */
/**************************************/

/**
 * Handles with websocket received messages.
 * @param {string} p received data 
 */
function com_packetHandling(p) {
    var msg = JSON.parse(p);
    switch (msg["type"]) {
        case WS_RECV_MSG: com_receivedNewMessageHandler(msg); break;
        case WS_RECV_ACK: com_receivedACKHandler(msg); break;
        case WS_MSG_SENT: com_msgSentConfirmationHandler(msg); break;
        case WS_DB_SEND: com_receivedDBHandler(msg); break;
        case WS_DB_RECV: com_receivedDBConfirmationHandler(); break;
        default: break;
    }
}

/**
 * Sends a packet (string) trough the web socket.
 * @param {string} p packet to send
 */
function com_sendPacket(p){
    try {
        WS.send(p);
    } catch (error) {
        gui_alert("WebSocket error: " + error, "red");
    }
}

/**
 * Handles with received text messages: saves the message
 * into the database hand does GUI stuff.
 * @param {string} msg received message
 */
function com_receivedNewMessageHandler(msg) {
    var msgId = gen_generateMsgId(msg["chatId"], msg["author"], msg["msgId"]);
    db_addRemoteMsgToChat(DATABASE, msg["chatId"], msg["msgId"], msg["author"], msg["text"]);
    if(ACTIVE_CHAT == msg["chatId"])
        gui_addReceivedMsg(msgId, msg["author"], msg["text"]);
    else {
        gui_addLastMsgToChat(msg["chatId"], msg["author"], msg["text"]);
        gui_removeBubbleFromChat(msg["chatId"]);
        var unread = db_getChatUnreadCounter(DATABASE, msg["chatId"]);
        db_setChatUnreadCounter(DATABASE, msg["chatId"], unread+1);
        gui_addBubbleToChat(msg["chatId"], unread+1);
        gui_moveChatListItemFirst(msg["chatId"]);
        gui_moveChatListItemFirst(ACTIVE_CHAT);
        gen_notify(db_getChatTitle(DATABASE, msg["chatId"]));
    }
}

/**
 * Handles with received ACK messages: sets the message as 
 * read in both database and GUI.
 * @param {JSON} msg ack message
 */
function com_receivedACKHandler(msg) {
    var msgId = gen_generateMsgId(msg["chatId"], msg["author"], msg["msgId"]);
    db_setMessageStatus(DATABASE, msg["chatId"], msgId, MSG_RECEIVED); // Set on database
    gui_setMsgStatus(msg["chatId"], msgId, MSG_RECEIVED); // Set on screen
}

/**
 * Handles with message sent confirmations: sets the message
 * status as sent int he database and refreshes the status on
 * the GUI if the message's chat is the active one.
 * @param {JSON} msg 
 */
function com_msgSentConfirmationHandler(msg) {
    var msgId = gen_generateMsgId(msg["chatId"], msg["author"], msg["msgId"]);
    db_setMessageStatus(DATABASE, msg["chatId"], msgId, MSG_SENT);
    gui_setMsgStatus(msg["chatId"], msgId, MSG_SENT);
}

/**
 * Handles with the received database.
 * @param {JSON} msg 
 */
function com_receivedDBHandler(msg) {
    DATABASE = msg["db"];
    DATABASE_LOADED = true;
    gui_loadGUI(DATABASE);
}

/**
 * Handles with received database confirmation (when the
 * server has correctly received the database from the
 * client): shows a notification.
 */
function com_receivedDBConfirmationHandler() {
    gui_alert("Database saved!", "green");
}

/**
 * Generates a packet to send a lora text message trough websocket.
 * @param {int} chatId chat id
 * @param {int} msgId message id
 * @param {string} text message text
 */
function com_generateSendMessagePacket(chatId, msgId, text) {
    return WS_SEND_MSG + "|" + chatId + "|" + msgId + "|" + db_getUserId(DATABASE) + "|" + text;
}

/**
 * Generates a packet to send the database trough websocket.
 */
function com_generateSendDatabasePacket() {
    return WS_DB_SEND + "|" + JSON.stringify(DATABASE);
}

/**
 * Generates a database request websocket packet.
 */
function com_generateDatabaseRequestPacket() {
    return WS_DB_REQ + "|";
}

/**
 * Generates a buffered messages request websocket packet.
 */
function com_generateBufferedMsgRequestPacket() {
    return WS_BUFFERED_MSG + "|";
}

/**
 * Generates an add chat websocket packet.
 * @param {int} chatId 
 * @param {string} key 
 */
function com_generateAddChatPacket(chatId, key){
    return WS_ADD_CHAT + "|" + chatId + "|" + key;
}

/**
 * Generates a delete chat websocket packet.
 * @param {int} chatId 
 */
function com_generateDelChatPacket(chatId) {
    return WS_DEL_CHAT + "|" + chatId;
}

function com_generateSetChatKeyPacket(chatId, key) {
    return WS_SET_CHAT_KEY + "|" + chatId + "|" + key;
}

function com_generateSetWifiSSIDPacket(ssid) {
    return WS_SET_WIFI_SSID + "|" + ssid;
}

function com_generateSetWifiKeyPacket(key) {
    return WS_SET_WIFI_KEY + "|" + key;
}

/**
 * Requests the database over the websocket.
 */
function com_requestDatabase() {
    com_sendPacket(com_generateDatabaseRequestPacket());
}


/*********************************/
/*      Database functions      */
/********************************/

/**
 * Returns and empty JSON database.
 */
function db_createDB(){
    return {
        "user_id": undefined,
        "username": undefined,
        "wifi_ssid": "LoRaChat",
        "wifi_key": "",
        "contacts": [],
        "chats": []
    };
}

/**
 * Returns a contact in JSON format
 * @param {int} userId contact id
 * @param {string} name contact name
 */
function db_createContact(userId, name){
    return {
        "id": userId,
        "name": name
    }
}

/**
 * Returns a chat in JSON format.
 * @param {int} chatId chat id
 * @param {string} title chat title
 * @param {string} key chat key
 */
function db_createChat(chatId, title, key){
    return {
        "id": chatId,
        "title": title,
        "key": key,
        "unread": 0,
        "id_counter": 0,
        "messages": []
    }
}

/**
 * Returns a message in JSON format.
 * @param {string} id message id (chat-author-msg)
 * @param {string} author author of message
 * @param {string} text text of message
 * @param {boolean} mine true if it is mine, false instead
 */
function db_createMsg(id, author, text, mine){
    return {
        "id": id,
        "mine": mine, // Is the message mine?
        "author": author,
        "text": text,
        "status": MSG_PENDING // false = sent, true = received.
    }
}

/**
 * Adds a contact to the database.
 * @param {json} db database
 * @param {int} userId contact id
 * @param {string} name contact name
 */
function db_addContact(db, userId, name){
    db.contacts.push(db_createContact(userId, name));
}

/**
 * Adds a chat to local and server's database.
 * Also updates user's database on server side.
 * @param {json} db database
 * @param {int} chatId chat id
 * @param {string} title chat title
 * @param {string} key chat key
 */
function db_addChat(db, chatId, title, key){
    db.chats.push(db_createChat(chatId, title, key));
    com_sendPacket(com_generateAddChatPacket(chatId,key));
    com_sendPacket(com_generateSendDatabasePacket()); // Send all database
}

/**
 * Adds a remote message to a chat in the database.
 * @param {json} db database
 * @param {int} chatId chat id
 * @param {int} msgId message id (simple)
 * @param {string} author sender
 * @param {string} text text of message
 */
function db_addRemoteMsgToChat(db, chatId, msgId, author, text){
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId)
            db.chats[i].messages.push(db_createMsg(gen_generateMsgId(chatId, author, msgId), author, text, false));
}

/**
 * Adds an own message to a chat in the database.
 * @param {json} db database
 * @param {int} chatId chat id
 * @param {int} msgId message id (simple)
 * @param {string} text text of message
 */
function db_addOwnMsgToChat(db, chatId, msgId, text){
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) 
            db.chats[i].messages.push(db_createMsg(gen_generateMsgId(chatId, db.user_id, msgId), db.user_id, text, true));
}

/**
 * Sets the name of a contact in the database.
 * @param {json} db database
 * @param {int} contactId contact id
 * @param {string} name contact name
 */
function db_setContactName(db, contactId, name) {
    for (var i = 0; i < db.contacts.length; i++)
        if(db.contacts[i].id === contactId) {
            db.contacts[i].name = name;
            return;
        }
}

/**
 * Sets the contact ID of a contact in the database.
 * @param {json} db database
 * @param {int} oldId old id
 * @param {int} newId new id
 */
function db_setContactId(db, oldId, newId) { 
    for (var i = 0; i < db.contacts.length; i++)
        if(db.contacts[i].id === oldId) {
            db.contacts[i].id = newId;
            return;
        }
}

/**
 * Returns the name of a contact in the database.
 * If the contact is not saved, returns the id.
 * @param {json} db database
 * @param {int} contactId contact id
 */
function db_getContactName(db, contactId) {
    for (var i = 0; i < db.contacts.length; i++)
        if(db.contacts[i].id === contactId) 
            return db.contacts[i].name;
    return contactId;
}

/**
 * Returns true if the contact exists in the database.
 * Returns false if the contact does not exist.
 * @param {json} db database
 * @param {int} contactId contact id
 */
function db_existsContact(db, contactId) {
    for (var i = 0; i < db.contacts.length; i++)
        if(db.contacts[i].id === contactId)
            return true;
    return false;
}

function db_removeContact(db, contactId) {
    for (var i = 0; i < db.contacts.length; i++)
        if(db.contacts[i].id === contactId)
            db.contacts.splice(i,1);
}

/**
 * Returns a chat from the database in JSON format.
 * @param {json} db database
 * @param {int} chatId chat id
 */
function db_getChat(db, chatId) {
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) 
            return db.chats[i];
}

/**
 * Removes a chat from the local and server's database.
 * Also updates user's database on server side.
 * @param {json} db database
 * @param {int} chatId chat id
 */
function db_removeChat(db, chatId) {
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) {
            db.chats.splice(i,1);
            com_sendPacket(com_generateDelChatPacket(chatId));
            com_sendPacket(com_generateSendDatabasePacket());
            return;
        } 
}

/**
 * Returns all messages from a chat in JSON format.
 * @param {json} db database
 * @param {int} chatId chat id
 */
function db_getChatMsgs(db, chatId) {
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) 
            return db.chats[i].messages;
}

/**
 * Sets user id in the database
 * @param {json} db database
 * @param {string} name user id
 */
function db_setUserId(db, userId) {
    db.user_id = userId;
}

/**
 * Returns the user id from the database.
 * @param {json} db database
 */
function db_getUserId(db) {
    return db.user_id;
}

/**
 * Sets username in the database.
 * @param {json} db database
 * @param {string} username username
 */
function db_setUsername(db, username) {
    db.username = username;
}

/**
 * Returns username from the database.
 * @param {json} db database
 */
function db_getUsername(db) {
    return db.username;
}

/**
 * Sets the wifi SSID in the database.
 * Also updates user's database on server side.
 * @param {json} db database
 * @param {string} ssid wifi SSID
 */
function db_setWifiSSID(db, ssid){
    com_sendPacket(com_generateSetWifiSSIDPacket(ssid));
    db.wifi_ssid = ssid;
    com_sendPacket(com_generateSendDatabasePacket());
}

/**
 * Returns the wifi SSID from the database.
 * @param {json} db database
 */
function db_getWifiSSID(db){
    return db.wifi_ssid;
}

/**
 * Sets the wifi key in the local and server's database.
 * Also updates user's database on server side.
 * @param {json} db database
 * @param {string} key wifi key
 */
function db_setWifiKey(db, key){
    db.wifi_key = key;
    com_sendPacket(com_generateSetWifiKeyPacket(key));
    com_sendPacket(com_generateSendDatabasePacket());
}

/**
 * Returns the wifi key from the database
 * @param {json} db 
 */
function db_getWifiKey(db){
    return db.wifi_key;
}

/**
 * Sets the title of a chat in the database.
 * @param {json} db database
 * @param {int} chatId chat id
 * @param {string} title chat title
 */
function db_setChatTitle(db, chatId, title){
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) {
            db.chats[i].title = title;
            return;
        }
}

/**
 * Returns the title of a chat in the database.
 * @param {json} db 
 * @param {int} chatId 
 */
function db_getChatTitle(db, chatId){
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) 
            return db.chats[i].title;
}

/**
 * Sets the key of a chat in the local and server's database.
 * Also updates user's database on server side.
 * @param {json} db database
 * @param {int} chatId chat id
 * @param {string} key key
 */
function db_setChatKey(db, chatId, key){
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) {
            db.chats[i].key = key;
            com_sendPacket(com_generateSetChatKeyPacket(chatId, key));
            com_sendPacket(com_generateSendDatabasePacket());
            return;
        }          
}

/**
 * Returns the key of a chat in the database.
 * @param {json} db database
 * @param {int} chatId chat id
 */
function db_getChatKey(db, chatId){
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId)
            return db.chats[i].key;
}

/**
 * Sets the unread counter of a chat in the database.
 * @param {json} db database
 * @param {int} chatId chat id
 * @param {int} n counter value
 */
function db_setChatUnreadCounter(db, chatId, n) {
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) {
            db.chats[i].unread = n;
            return;
        }          
}

/**
 * Returns the unread messages counter from a chat in the database.
 * @param {json} db  database
 * @param {int} chatId chat id
 */
function db_getChatUnreadCounter(db, chatId) {
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) 
            return db.chats[i].unread;
    return 0;
}

/**
 * Sets the status of a message in the database.
 * @param {json} db database
 * @param {int} chatId chat id
 * @param {string} msgId message id (chat-author-msg)
 * @param {int} status status
 */
function db_setMessageStatus(db, chatId, msgId, status) {
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id == chatId) {
            var chat = db.chats[i];
            for (var j = 0; j < chat.messages.length; j++)
                if(chat.messages[j].id == msgId) {
                    chat.messages[j].status = status;
                    return;
                }               
        }
}

/**
 * Returns the message id counter from a chat in the database.
 * @param {json} db database
 * @param {int} chatId chat id
 * @param {int} n number of the counter
 */
function db_setChatIdCounter(db, chatId, n) {
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) {
            db.chats[i].id_counter = n;
            return;
        }
}

/**
 * Returns the id counter from a chat in the database.
 * @param {json} db database
 * @param {int} chatId chat id
 */
function db_getChatIdCounter(db, chatId) {
    for (var i = 0; i < db.chats.length; i++)
        if(db.chats[i].id === chatId) 
            return db.chats[i].id_counter;
}




/************************************/
/*      GUI handling functions      */
/************************************/

/**
 * Loads the GUI with the data of the database.
 * Only loads the sidebar and cleans the screen.
 * @param {json} db database
 */
function gui_loadGUI(db){
    gui_setChatScreenTitle("");
    gui_cleanChatInputBox();
    gui_hideChatBox();
    if(db === undefined) return;
    for (var i = 0; i < db.chats.length; i++) {
        var chat = db.chats[i];
        if(chat.messages[chat.messages.length-1] === undefined) {
            var lastMsg = undefined;
            var lastAuthor = undefined;
        } else{
            var lastMsg = chat.messages[chat.messages.length-1].text;
            var lastAuthor = db_getContactName(DATABASE, chat.messages[chat.messages.length-1].author);
        }
        gui_addChatToSidebar2(
            chat.id,
            chat.title,
            lastAuthor,
            lastMsg,
            chat.unread);
        if(chat.unread>0) { // If there are unread messages
            gui_moveChatListItemFirst(chat.id); // Move first place
        }
    }
}

/**
 * Generates an alert in the gui.
 * @param {string} text message to show
 * @param {string} color color of the alert
 */
function gui_alert(text, color){
    var alert = document.getElementById('alert-panel');
    alert.className = "w3-panel w3-display-container";
    switch (color) {
        case "red": alert.className += " w3-red"; break;
        case "green": alert.className += " w3-green"; break;
        case "yellow": alert.className += " w3-yellow"; break;
        default: alert.className += " w3-blue"; break;
    }
    var alertText = document.getElementById('alert-text');
    alertText.innerHTML = text;
    document.getElementById('alert-modal').style.display="block";
}

/**
 * Opens sidebar.
 */
function gui_sidebarOpen() {
    document.getElementById("sidebar").style.display = "block";
}

/**
 * Hides sidebar.
 */
function gui_sidebarClose() {
    document.getElementById("sidebar").style.display = "none";
}

/**
 * Shows chat box.
 */
function gui_showChatBox() {
    document.getElementById("chat-box").style.display = "block";
}

/**
 * Hides chat box.
 */
function gui_hideChatBox() {
    document.getElementById("chat-box").style.display = "none";
}

/**
 * Cleans the chat screen.
 */
function gui_clearChatScreen() {
    var screen = document.getElementById("chat-msg-screen");
    screen.innerHTML = '';
}

/**
 * Sets the chat screen title.
 * @param {string} title title to set
 */
function gui_setChatScreenTitle(title) {
    document.getElementById("chat-title").innerHTML = title;
}

/**
 * Adds active chat item to the dropdown menu.
 */
function gui_addActiveChatMenuItem() {
    var item = document.createElement("a");
    item.id = "dropdown-active-chat-item";
    item.className = "w3-bar-item w3-button w3-dark-gray w3-hover-grey";
    item.innerHTML = "Current chat settings";
    item.addEventListener("click", function() { // Click listener
        gui_openChatSettingsModal();
    });
    var parent = document.getElementById("dropdown-menu");
    parent.insertBefore(item, parent.childNodes[3]);
}

/**
 * Removes active chat item to the dropdown menu.
 */
function gui_removeActiveChatMenuItem() {
    var elem = document.getElementById("dropdown-active-chat-item");
    elem.parentNode.removeChild(elem);
}

/**
 * Opens and closes the dropdown menu.
 */
function gui_dropdownMenuChangeStatus() {
    var x = document.getElementById("dropdown-menu");
    if (x.className.indexOf("w3-show") == -1) x.className += " w3-show";
    else x.className = x.className.replace(" w3-show", "");
}

/**
 * Opens and closes the dropdown menu.
 */
function gui_dropdownMenuClose() {
    document.getElementById("dropdown-menu").className.replace(" w3-show", "");
}

/**
 * Shows add chat modal.
 */
function gui_openAddChatModal() {  
    document.getElementById('add-chat-modal').style.display='block';
    gui_dropdownMenuChangeStatus(); // Close menu
}

/**
 * Shows chat settings modal.
 */
function gui_openChatSettingsModal() {
    if(ACTIVE_CHAT != undefined) { // Show current values
        document.getElementById('chat-settings-change-title').value = db_getChatTitle(DATABASE, ACTIVE_CHAT);;
        document.getElementById('add-chat-input-id').value = ACTIVE_CHAT;
        document.getElementById('chat-settings-change-key').value = db_getChatKey(DATABASE, ACTIVE_CHAT);
        document.getElementById('chat-settings-id-label').innerHTML = "Chat ID: " + ACTIVE_CHAT;
    }
    document.getElementById('conv-settings-modal').style.display='block';
    gui_dropdownMenuChangeStatus(); // Close menu
}

/**
 * Adds a contact to the contacts modal contact list.
 * @param {int} contactId contact id
 * @param {string} contactName contact name
 */
function gui_addContactToContactsModalList(contactId, contactName) {
    var item = document.createElement("li"); // list item
    item.id = "contact-list-" + contactId;
    item.className = "w3-border-black";
    var name = document.createElement("label"); // contact name
    name.innerHTML = contactName + " (ID: " + contactId + ")";
    item.appendChild(name); // append contact name

    var removeButton = document.createElement("button"); // Remove contact button
    removeButton.id = "remove-contact-button-" + contactId;
    removeButton.className = "w3-btn w3-right w3-tiny w3-red w3-round-xxlarge w3-hover-light-grey";
    removeButton.innerHTML = "Remove";
    removeButton.addEventListener("click", function() { // Click listener
        gui_removeContact(contactId);
    });
    item.appendChild(removeButton); // append remove contact button

    var changeButton = document.createElement("button"); // Change contact button
    changeButton.id = "change-contact-button-" + contactId;
    changeButton.className = "w3-btn w3-right w3-tiny w3-blue w3-round-xxlarge w3-hover-light-blue";
    changeButton.innerHTML = "Change";
    changeButton.addEventListener("click", function() { // Click listener
        gui_openAddOrChangeContactModal(contactId);
    });
    item.appendChild(changeButton); // append change contact button
    document.getElementById("contact-list").appendChild(item);
}

/**
 * Shows contacts modal.
 */
function gui_openContactsModal() {
    for (var i = 0; i < DATABASE.contacts.length; i++) // Load contacts
        gui_addContactToContactsModalList(DATABASE.contacts[i].id, DATABASE.contacts[i].name);
    document.getElementById('contacts-modal').style.display='block';
    gui_dropdownMenuChangeStatus(); // Close menu
}

/**
 * Opens add or change contact modal.
 * If the contact ID is defined: change
 * If the contact ID is not defined: add
 * @param {int} contactId contact id
 */
function gui_openAddOrChangeContactModal(contactId) {
    if(contactId == undefined) { // ADD
        document.getElementById('add-change-contact-title').innerHTML = "Add contact";
        var label = document.getElementById('add-change-contact-modal-contact-id-label');
        label.className = "w3-text-blue";
        label.innerHTML = "Contact ID";
        var idInput = document.createElement("input");
        idInput.id = "add-change-contact-input-id";
        idInput.className = "w3-input w3-dark-grey w3-border w3-round-xxlarge";
        document.getElementById('add-change-contact-modal-contact-id').appendChild(idInput);
        var addButton = document.getElementById('add-change-contact-button');
        addButton.innerHTML = "Add";
        addButton.addEventListener("click", function() { // Click listener
            gui_addContact();
        });
    } else { // CHANGE
        document.getElementById('add-change-contact-title').innerHTML = "Change contact";
        var label = document.getElementById('add-change-contact-modal-contact-id-label');
        label.className = "w3-text-white";
        label.innerHTML = "Contact ID: " + contactId;
        var changeButton = document.getElementById('add-change-contact-button');
        changeButton.innerHTML = "Change";
        document.getElementById('add-change-contact-input-name').value = db_getContactName(DATABASE, contactId);
        //document.getElementById('add-change-contact-input-id').value = contactId;
        changeButton.addEventListener("click", function() { // Click listener
            gui_changeContact(contactId);
        });
    }
    document.getElementById('add-change-contact-modal').style.display='block';
}

/**
 * Shows main settings modal.
 */
function gui_openMainSettingsModal() {
    var userId = db_getUserId(DATABASE);
    if(userId !== undefined) document.getElementById('main-settings-userid-input').value = db_getUserId(DATABASE);
    else document.getElementById('main-settings-userid-input').value = "";
    var username = db_getUsername(DATABASE);
    if(username !== undefined) document.getElementById('main-settings-username-input').value = db_getUsername(DATABASE);
    else document.getElementById('main-settings-username-input').value = "";
    document.getElementById('main-settings-ssid-input').value =  db_getWifiSSID(DATABASE);
    document.getElementById('main-settings-key-input').value =  db_getWifiKey(DATABASE);
    document.getElementById('main-settings-modal').style.display='block';
    gui_dropdownMenuChangeStatus(); // Close menu
}

/**
 * Clears the add chat modal inputs and hides it.
 */
function gui_clearAddChatModal() {
    document.getElementById('add-chat-modal').style.display='none';
    document.getElementById('add-chat-input-title').value = "";
    document.getElementById('add-chat-input-id').value = "";
    document.getElementById('add-chat-input-key').value = "";
}

/**
 * Clears the chat settings modal inputs and hides it.
 */
function gui_clearChatSettingsModal() {
    document.getElementById('conv-settings-modal').style.display='none';
    document.getElementById('chat-settings-change-title').value = "";
    document.getElementById('chat-settings-change-key').value = "";
    document.getElementById('chat-settings-id-label').innerHTML = "";
}

/**
 * Clears the contacts modal and hides it.
 */
function gui_clearContactsModal() {
    document.getElementById('contacts-modal').style.display='none';
    document.getElementById('contact-list').innerHTML = "";
}

/**
 * Clears the add contact modal and hides it.
 */
function gui_clearAddOrChangeContactModal() {
    document.getElementById('add-change-contact-modal').style.display='none';
    document.getElementById('add-change-contact-input-name').value = "";
    var input = document.getElementById('add-change-contact-input-id');
    if(input != null) input.parentNode.removeChild(input);
    document.getElementById('add-change-contact-button').innerHTML = "";
}

/**
 * Clears the main settings modal inputs and hides it.
 */
function gui_clearMainSettingsModal() {
    document.getElementById('main-settings-modal').style.display='none';
    document.getElementById('main-settings-userid-input').value = "";
    document.getElementById('main-settings-username-input').value = "";
    document.getElementById('main-settings-ssid-input').value = "";
    document.getElementById('main-settings-key-input').value = "";
}

/**
 * Shows WebSocket modal.
 */
function gui_openWebSocketModal() {  
    document.getElementById('websocket-modal').style.display='block';
}

/**
 * Hides WebSocket modal.
 */
function gui_closeWebSocketModal() {  
    document.getElementById('websocket-modal').style.display='none';
}

/**
 * Adds a chat item to the sidebar list.
 * @param {int} id id of the chat
 * @param {string} name title of the chat
 */
function gui_addChatToSidebar(id, name) {
    var item = document.createElement("a");
    item.id = "chatlist-" + id;
    item.className = "w3-bar-item w3-button w3-black w3-hover-dark-gray";
    item.style = "white-space:nowrap; text-overflow:ellipsis;";
    item.addEventListener("click", function() { // Click listener
        if(ACTIVE_CHAT !== id) {
            gui_removeBubbleFromChat(id);
            gui_moveChatListItemFirst(id);
            gui_loadChat(id);
        }
        gui_sidebarClose();
    });
    var title = document.createElement("span");
    title.className = "w3-large";
    title.innerHTML = name;
    title.id = "chatlist-title-" + id;
    item.appendChild(title);
    item.appendChild(document.createElement("br"));
    document.getElementById("sidebar").appendChild(item);
}

/**
 * Adds a chat item to the sidebar, but with more details.
 * Useful for the first load.
 * @param {int} id chat id
 * @param {string} name chat title
 * @param {string} author last message author
 * @param {string} msg last message text
 * @param {int} unread unread counter
 */
function gui_addChatToSidebar2(id, name, author, msg, unread) {
    var item = document.createElement("a");
    item.id = "chatlist-" + id;
    item.className = "w3-bar-item w3-button w3-black w3-hover-dark-gray";
    item.style = "white-space:nowrap; text-overflow:ellipsis;";
    item.addEventListener("click", function() { // Click listener
        if(ACTIVE_CHAT !== id) {
            gui_removeBubbleFromChat(id);
            gui_moveChatListItemFirst(id);
            gui_loadChat(id);
        }
        gui_sidebarClose();
    });
    // Add title
    var title = document.createElement("span");
    title.className = "w3-large";
    title.innerHTML = name;
    title.id = "chatlist-title-" + id;
    item.appendChild(title);
    item.appendChild(document.createElement("br"));
    // Add last message
    var lm = document.createElement("span");
    lm.className = "w3-text-light-grey";
    if(author !== undefined || msg !== undefined)
        if(author == db_getUserId(DATABASE)) 
            lm.innerHTML = '(' + db_getUsername(DATABASE) + '): ' + msg;
        else
            lm.innerHTML = db_getContactName(DATABASE, author) + ': ' + msg;
    else
        lm.innerHTML = "";
    item.appendChild(lm);
    // Add bubble
    if(unread>0) {
        var b = document.createElement("span");
        b.className = "w3-tag w3-green w3-circle w3-right";
        b.innerHTML = unread;
        b.id = "bubble-" + id;
        item.appendChild(b);
    }
    document.getElementById("sidebar").appendChild(item);
}

/**
 * Removes a chat item from the sidebar list
 * @param {int} id chat id
 */
function gui_removeChatFromSidebar(id) {
    var chat = document.getElementById("chatlist-"+id);
    chat.parentNode.removeChild(chat);
}

/**
 * Moves a chat list item to the first place.
 * @param {int} id chat id
 */
function gui_moveChatListItemFirst(id){
    var parent = document.getElementById('sidebar');
    parent.insertBefore(document.getElementById('chatlist-'+id), parent.childNodes[5]);
}

/**
 * Changes title of chat list item.
 * @param {int} id chat id
 * @param {string} title chat title
 */
function gui_changeChatListItemTitle(id, title){
    document.getElementById("chatlist-title-"+id).innerHTML = title;
}

/**
 * Adds a resume of the last message to the chat list item.
 * @param {int} id chat id
 * @param {string} msg last message text
 */
function gui_addLastMsgToChat(id, author, msg){
    var item = document.getElementById("chatlist-"+id);
    if(item.childNodes.length>2) item.removeChild(item.childNodes[2]); // Clear
    var lm = document.createElement("span");
    lm.className = "w3-text-light-grey";
    if(author == db_getUserId(DATABASE)) 
        lm.innerHTML = '(' + db_getUsername() + '): ' + msg;
    else
        lm.innerHTML = db_getContactName(DATABASE, author) + ': ' + msg;
    document.getElementById("chatlist-"+id).appendChild(lm);
}

/**
 * Adds a counter of unread messages to a chat list item.
 * @param {int} id chat id
 * @param {int} num number of unread messages
 */
function gui_addBubbleToChat(id,num){
    gui_removeBubbleFromChat(id);
    var b = document.createElement("span");
    b.className = "w3-tag w3-green w3-circle w3-right";
    b.innerHTML = num;
    b.id = "bubble-" + id;
    document.getElementById("chatlist-"+id).appendChild(b);
}

/**
 * Removes unread messages counter from chat list item.
 * @param {int} id chat id
 */
function gui_removeBubbleFromChat(id){
    var b = document.getElementById("bubble-" + id);
    if(b != null) b.parentNode.removeChild(b);
}

/**
 * Adds an own message to the chatscreen.
 * @param {string} id message id (chat-author-msg)
 * @param {str} msg message text
 * @param {int} status message status (default: pending)
 */
function gui_addSentMsg(id, msg, status) {
    var row = document.createElement("div");
    row.className = "chat-screen-msg-row my-msg";
    row.id = "msg-" + id;
    var text = document.createElement("div");
    text.className = "chat-screen-msg-text";
    text.innerHTML = msg;
    var info = document.createElement("div");
    info.className = "chat-screen-msg-info";
    switch (status) {
        case MSG_PENDING: info.innerHTML = "sending..."; break;
        case MSG_SENT: info.innerHTML = "&#10555; sent"; break;
        case MSG_RECEIVED: info.innerHTML = "✓ received"; break;
        default: break;
    }
    row.appendChild(text);
    row.appendChild(info);
    document.getElementById("chat-msg-screen").appendChild(row);
    document.getElementById("chat-msg-screen").scrollTo(0, document.getElementById("chat-msg-screen").scrollHeight);
}

/**
 * Adds a new remote message to the chat screen.
 * @param {string} id message id (chat-author-msg)
 * @param {int} sender author 
 * @param {string} msg message text
 */
function gui_addReceivedMsg(id, sender, msg) {
    var row = document.createElement("div");
    row.className = "chat-screen-msg-row remote-msg";
    row.id = "msg-" + id;
    var text = document.createElement("div");
    text.className = "chat-screen-msg-text";
    text.innerHTML = '<b style="font-weight:bolder;">'+ db_getContactName(DATABASE, sender) + ': </b>' + msg;
    row.appendChild(text);
    document.getElementById("chat-msg-screen").appendChild(row);
    document.getElementById("chat-msg-screen").scrollTo(0, document.getElementById("chat-msg-screen").scrollHeight);
}

/**
 * Cleans the chat input box.
 */
function gui_cleanChatInputBox() {
    document.getElementById("chat-input-box").value = "";
}

/**
 * Sends a LoRa text message:
 * 1- Creates the message and its ID.
 * 2- Sends it trough websocket.
 * 3- Saves it into the database.
 * 4- Does GUI stuff.
 */
function gui_sendMsg() {
    if(document.getElementById("chat-input-box").value != "" && ACTIVE_CHAT != undefined){
        if(db_getUserId(DATABASE) != undefined && db_getUserId(DATABASE) != "") {
            var text = document.getElementById("chat-input-box").value;
            var msgIdCount = db_getChatIdCounter(DATABASE, ACTIVE_CHAT) + 1; // Create new message ID
            db_setChatIdCounter(DATABASE, ACTIVE_CHAT, msgIdCount); // Set the new message ID in the database
            com_sendPacket(com_generateSendMessagePacket(ACTIVE_CHAT, msgIdCount, text)); // Send packet
            db_addOwnMsgToChat(DATABASE, ACTIVE_CHAT, msgIdCount, text); // Add message to database
            gui_addSentMsg(gen_generateMsgId(ACTIVE_CHAT, db_getUserId(DATABASE), msgIdCount), text, MSG_PENDING);
            gui_addLastMsgToChat(ACTIVE_CHAT, db_getUsername(DATABASE), text);
            gui_moveChatListItemFirst(ACTIVE_CHAT);
            gui_cleanChatInputBox();
        } else {
            gui_alert("In order to send messages, you need to define your user ID.", "red");
        }
    }
}

/**
 * Sends a message when the pressed key is an ENTER.
 * @param {event} e key event
 */
function gui_sendMsgOnEnter(e) {
    if (e.keyCode == 13) gui_sendMsg();
}

/**
 * Sets a message status if message's chat is active.
 * @param {int} chatId chat id
 * @param {string} msgId message id (chat-author-msg)
 * @param {int} status message status
 */
function gui_setMsgStatus(chatId, msgId, status) {
    if(ACTIVE_CHAT == chatId)
        switch (status) {
            case MSG_PENDING: document.getElementById("msg-"+msgId).childNodes[1].innerHTML = "sending..."; break;
            case MSG_SENT: document.getElementById("msg-"+msgId).childNodes[1].innerHTML = "&#10555; sent"; break;
            case MSG_RECEIVED: document.getElementById("msg-"+msgId).childNodes[1].innerHTML = "✓ received"; break;
            default: break;
        }
}

/**
 * Loads a chat in the chatscreen.
 * @param {int} id chat id
 */
function gui_loadChat(id){
    ACTIVE_CHAT = id; // Set chat as active
    var chat = db_getChat(DATABASE, id);
    db_setChatUnreadCounter(DATABASE, id, 0);
    gui_setChatScreenTitle(chat.title)
    gui_clearChatScreen();
    for (var i = 0; i < chat.messages.length; i++){ // Load chats
        var msg = chat.messages[i];
        if(msg.mine) gui_addSentMsg(msg.id, msg.text, msg.status);
        else gui_addReceivedMsg(msg.id, db_getContactName(DATABASE, msg.author), msg.text); 
    }
    gui_showChatBox();
    if(document.getElementById("dropdown-active-chat-item") == null)
        gui_addActiveChatMenuItem();
    gui_sidebarClose();
    document.getElementById("chat-msg-screen").scrollTo(0, document.getElementById("chat-msg-screen").scrollHeight);
}

/**
 * Adds a chat to the GUI and the database.
 */
function gui_addChat() {
    var title = document.getElementById('add-chat-input-title').value;
    var id = document.getElementById('add-chat-input-id').value;
    var key = document.getElementById('add-chat-input-key').value;
    if (title !== "" && id !== "" && key !== "") {
        db_addChat(DATABASE, Number(id), title, key);
        gui_addChatToSidebar(Number(id), title);   
        gui_loadChat(Number(id));
        gui_clearAddChatModal();
        gui_alert("Chat created successfully!", "green");
    } else {
        gui_alert("Chat could not be created!", "red");
    } 
}

/**
 * Changes active chat's title in database.
 */
function gui_changeChatTitle() {
    var title = document.getElementById('chat-settings-change-title').value;
    if (title !== "") {
        db_setChatTitle(DATABASE, ACTIVE_CHAT, title);
        gui_setChatScreenTitle(title);
        gui_changeChatListItemTitle(ACTIVE_CHAT, title);
        gui_alert("Chat title changed successfully!", "green");
    } else {
        gui_alert("Chat title could not be changed!", "red");
    }
}

/**
 * Changes active chat's key in database.
 */
function gui_changeChatKey() {
    var key = document.getElementById('chat-settings-change-key').value;
    if (key !== "") {
        db_setChatKey(DATABASE, ACTIVE_CHAT, key);
        gui_alert("Chat key changed successfully!", "green");
    } else {
        gui_alert("Chat key could not be changed!", "red");
    }
}

/**
 * Removes a chat from database and GUI.
 */
function gui_removeChat() {
    db_removeChat(DATABASE, ACTIVE_CHAT); // Remove chat from database
    gui_clearChatScreen(); // Clear chat screen
    gui_removeChatFromSidebar(ACTIVE_CHAT); // Remove from sidebar
    gui_removeActiveChatMenuItem(); // Remove active chat element from dropdown
    gui_clearChatSettingsModal(); // Close modal
    gui_setChatScreenTitle(""); // Remove chat screen title
    ACTIVE_CHAT = undefined;
    gui_alert("Chat removed successfully!", "green");
}

/**
 * Changes user id in database.
 */
function gui_changeUserId() {
    var userId = document.getElementById('main-settings-userid-input').value;
    if (userId !== "") {
        db_setUserId(DATABASE, Number(userId));
        gui_alert("User ID changed successfully!", "green");
    } else {
        gui_alert("User ID could not be changed!", "red");
    }
}

/**
 * Changes username in the database.
 */
function gui_changeUserName() {
    var username = document.getElementById('main-settings-username-input').value;
    if (username !== "") {
        db_setUsername(DATABASE, username);
        gui_alert("Username changed successfully!", "green");
    } else {
        gui_alert("Username could not be changed!", "red");
    }
}

/**
 * Changes wifi SSID in database.
 */
function gui_changeWifiSSID() {
    var ssid = document.getElementById('main-settings-ssid-input').value;
    if (ssid !== "") {
        db_setWifiSSID(DATABASE, ssid);
        gui_alert("Wifi SSID changed successfully!", "green");
    } else {
        gui_alert("Wifi SSID could not be changed!", "red");
    }
}

/**
 * Changes wifi key in database.
 */
function gui_changeWifiKey() {
    var key = document.getElementById('main-settings-key-input').value;
    if (key !== "") {
        db_setWifiKey(DATABASE, key);
        gui_alert("Wifi key changed successfully!", "green");
    } else {
        gui_alert("Wifi key could not be changed!", "red");
    }
}

/**
 * Adds a contact to the database.
 */
function gui_addContact() {
    var name = document.getElementById('add-change-contact-input-name').value;
    var id = document.getElementById('add-change-contact-input-id').value;
    if(id != '' && name != '') {
        if(!db_existsContact(DATABASE, Number(id))) { // If the contact is not in the database
            db_addContact(DATABASE, Number(id), name);
            gui_clearAddOrChangeContactModal();
            gui_clearContactsModal();
            gui_openContactsModal();
            gui_dropdownMenuChangeStatus()
            gui_alert("Contact added!", "green");
        } else gui_alert("Contact already exists! Try again, please.", "red");
    } else gui_alert("Sorry. Invalid contact ID or contact name. Try again, please.", "red");
}

/**
 * Changes a contact name in the database.
 * @param {string} contactId contact id
 */
function gui_changeContact(contactId) {
    var name = document.getElementById('add-change-contact-input-name').value;
    if(name != '') {
        db_setContactName(DATABASE, Number(contactId), name);
        gui_clearAddOrChangeContactModal();
        gui_clearContactsModal();
        gui_openContactsModal();
        gui_dropdownMenuChangeStatus();
        gui_alert("Contact changed!", "green");
    } else gui_alert("Sorry. Empty name not allowed. Try again, please.", "red");
}

/**
 * Removes a contact from the database and the GUI.
 * @param {int} contactId 
 */
function gui_removeContact(contactId) {
    var contact = document.getElementById('contact-list-'+contactId);
    if(contact != null) contact.parentNode.removeChild(contact);
    db_removeContact(DATABASE, contactId);
    gui_alert("Contact removed!", "green");
}

/**
 * Sends the database trough the websocket.
 */
function gui_saveDatabase() {
    com_sendPacket(com_generateSendDatabasePacket());
    gui_dropdownMenuChangeStatus();
}