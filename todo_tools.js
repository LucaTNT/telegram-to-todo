var toDoQueue = {};
var toDoAdderAuthToken = '';
var toDoAdderTaskEndpoint = '';
var todoAddedWebhook = '';
// Set by index.js: takes an attachment descriptor and resolves to its base64
// payload. Injected so this module doesn't need to know about the Telegram bot.
var attachmentDownloader = null;

// message_id is only unique within a single chat, so the queue key must be
// namespaced by chat_id to avoid different chats colliding on the same key.
function queueKey(chatId, todoIndex) {
    return `${chatId}:${todoIndex}`;
}

module.exports = {
    setToDoAuthToken: function (token) {
        toDoAdderAuthToken = token;
    },

    setToDoTaskEndpoint: function (endpoint) {
        toDoAdderTaskEndpoint = endpoint;
    },

    setToDoAddedWebhook: function (url) {
        todoAddedWebhook = url;
    },

    setAttachmentDownloader: function (downloader) {
        attachmentDownloader = downloader;
    },

    createToDo: function (msg) {
        var todo = {};

        // Attachments carry their text in `caption` instead of `text`
        const text = msg.text || msg.caption;
        const attachment = imageAttachment(msg);

        // Handle forwared messages (Bot API 7.0+ exposes them via forward_origin,
        // older versions used the now-removed forward_date/forward_from fields)
        if (msg.forward_origin || msg.forward_date) {
            const original_sender = forwardedSenderName(msg);
    
            todo['text'] = `#FU: (${original_sender})`;
            todo['note'] = `${text || ''}\n\nInserito da ${msg.from.first_name}`;
        } else {
            // Ignore empty messages (e.g. attachments we can't do anything with)
            if (!text && !attachment) {
                return false
            }
            todo['text'] = text || defaultImageTitle(attachment);
            todo['note'] = `Inserito da ${msg.from.first_name}`;
        }

        if (attachment) {
            todo['attachment'] = attachment;
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
        const todo = this.deleteFromQueue(chatId, todo_index);
        const attachment = todo['attachment'];
        let image = null;

        // The file is only pulled from Telegram once the todo is confirmed, so
        // messages that get discarded never cost us a download.
        if (attachment) {
            if (!attachmentDownloader) {
                throw new Error('No attachment downloader configured');
            }

            image = await attachmentDownloader(attachment);
        }

        const response = await sendToAdder(todo["text"], todo["note"], image, attachment && attachment.file_name);

        // The todo is already saved at this point, so a webhook failure
        // shouldn't be surfaced as a failure to add it - just log it.
        if (todoAddedWebhook) {
            // The adder responds with the created task, id included.
            let taskId = null;
            try {
                taskId = JSON.parse(response).id;
            } catch (err) {
                console.error('Failed to parse task id out of the adder response:', err);
            }

            callToDoAddedWebhook(todo["text"], todo["note"], taskId)
                .then(() => console.log('TODO_ADDED_WEBHOOK call succeeded'))
                .catch((err) => console.error('TODO_ADDED_WEBHOOK call failed:', err));
        }
    }
  };

// Describe the image a message carries, if any. Telegram sends compressed
// photos as a `photo` array holding the same image in several sizes, and
// uncompressed ones as a document, which may be any file type at all.
function imageAttachment(msg) {
    if (msg.photo && msg.photo.length) {
        const largest = msg.photo.reduce((a, b) => (b.width > a.width ? b : a));

        // Telegram always compresses these to JPEG, but let the adder sniff the
        // type from the bytes rather than asserting it here.
        return {file_id: largest.file_id};
    }

    const document = msg.document;
    if (document && document.mime_type && document.mime_type.startsWith('image/')) {
        return {
            file_id: document.file_id,
            mime_type: document.mime_type,
            file_name: document.file_name
        };
    }

    return null;
}

// Title for an image that arrived with no caption to name it after.
function defaultImageTitle(attachment) {
    return attachment.file_name ? `Immagine: ${attachment.file_name}` : 'Immagine';
}

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

// Notifies TODO_ADDED_WEBHOOK, if configured, that a todo was saved. Supports
// both http:// and https:// URLs since this is a user-provided endpoint.
async function callToDoAddedWebhook(title, note, taskId) {
    const {request} = todoAddedWebhook.startsWith('http://') ? require('http') : require('https')

    const dataString = JSON.stringify({title, note, task_id: taskId})

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(dataString),
        },
        timeout: 5000, // in ms
    }

    return new Promise((resolve, reject) => {
        const req = request(todoAddedWebhook, options, (res) => {
            if (res.statusCode < 200 || res.statusCode > 299) {
                return reject(new Error(`HTTP status code ${res.statusCode}`))
            }

            res.resume() // drain the response, we don't need the body
            res.on('end', resolve)
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

async function sendToAdder(title, note, image = null, image_name = null) {
    const https = require('https')

    const task = {
        title: title,
        note: note
    }

    if (image) {
        task['image'] = image

        if (image_name) {
            task['image_name'] = image_name
        }
    }

    const dataString = JSON.stringify(task)
    // Log the task without dumping the whole base64 blob into the logs
    console.log(JSON.stringify(Object.assign({}, task, image ? {image: `[${image.length} chars]`} : {})))

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(dataString),
            'Authorization': toDoAdderAuthToken
        },
        // Uploading an image costs the adder a round trip to the underlying
        // service, so give those requests a lot more room than a plain text
        // todo needs.
        timeout: image ? 60000 : 5000, // in ms
    }

    return new Promise((resolve, reject) => {
        const req = https.request(toDoAdderTaskEndpoint, options, (res) => {
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
