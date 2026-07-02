var toDoQueue = {};
var microsoftToDoAuthToken = '';
var microsoftToDoTaskEndpoint = '';

// message_id is only unique within a single chat, so the queue key must be
// namespaced by chat_id to avoid different chats colliding on the same key.
function queueKey(chatId, todoIndex) {
    return `${chatId}:${todoIndex}`;
}

module.exports = {
    setToDoAuthToken: function (token) {
        microsoftToDoAuthToken = token;
    },

    setToDoTaskEndpoint: function (endpoint) {
        microsoftToDoTaskEndpoint = endpoint;
    },

    createToDo: function (msg) {
        var todo = {};

        // Handle forwared messages (Bot API 7.0+ exposes them via forward_origin,
        // older versions used the now-removed forward_date/forward_from fields)
        if (msg.forward_origin || msg.forward_date) {
            const original_sender = forwardedSenderName(msg);
    
            todo['text'] = `#FU: (${original_sender})`;
            todo['note'] = `${msg.text}\n\nInserito da ${msg.chat.first_name}`;
        } else {
            // Ignore empty messages (e.g. photos/attachments)
            if (!msg.text) {
                return false
            }
            todo['text'] = msg.text;
            todo['note'] = `Inserito da ${msg.chat.first_name}`;
        }
    
        return todo;
    },

    addToQueue: function (chatId, todo_index, todo) {
        toDoQueue[queueKey(chatId, todo_index)] = todo;
    },

    toDoQueueItem: function (chatId, index) {
        return toDoQueue[queueKey(chatId, index)];
    },

    toDoQueue: function () {
        return toDoQueue;
    },

    deleteFromQueue: function (chatId, index) {
        const key = queueKey(chatId, index);
        const todo = toDoQueue[key];
        delete toDoQueue[key];
        return todo;
    },

    updateQueueItem: function (chatId, index, todo) {
        toDoQueue[queueKey(chatId, index)] = todo;
    },

    addToDo: async function (chatId, todo_index) {
        todo = this.deleteFromQueue(chatId, todo_index);
        await sendToMicrosoftToDo(todo["text"], todo["note"]);
    }
  };

// Derive the original sender's display name from a forwarded message.
// Bot API 7.0+ nests this in forward_origin (a MessageOrigin), while older
// clients used the top-level forward_from / forward_sender_name fields.
function forwardedSenderName(msg) {
    const origin = msg.forward_origin;

    if (origin) {
        switch (origin.type) {
            case 'user':
                return origin.sender_user.first_name;
            case 'hidden_user':
                return origin.sender_user_name;
            case 'chat':
                return origin.sender_chat.title;
            case 'channel':
                return origin.chat.title;
        }
    }

    // Legacy fields (Bot API < 7.0)
    return msg.forward_sender_name ? msg.forward_sender_name : msg.forward_from.first_name;
}

async function sendToMicrosoftToDo(title, note) {
    const https = require('https')

    const task = {
        title: title,
        note: note
    }

    const dataString = JSON.stringify(task)
    console.log(dataString)

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': microsoftToDoAuthToken
        },
        timeout: 5000, // in ms
    }

    return new Promise((resolve, reject) => {
        const req = https.request(microsoftToDoTaskEndpoint, options, (res) => {
        if (res.statusCode < 200 || res.statusCode > 299) {
            return reject(new Error(`HTTP status code ${res.statusCode}`))
        }

        const body = []
        res.on('data', (chunk) => body.push(chunk))
        res.on('end', () => {
            const resString = Buffer.concat(body).toString()
            resolve(resString)
        })
        })

        req.on('error', (err) => {
        reject(err)
        })

        req.on('timeout', () => {
        req.destroy()
        reject(new Error('Request time out'))
        })

        req.write(dataString)
        req.end()
    })
}
