var toDoQueue = {};
var microsoftToDoAuthToken = '';
var microsoftToDoTaskEndpoint = '';

module.exports = {
    setToDoAuthToken: function (token) {
        microsoftToDoAuthToken = token;
    },

    setToDoTaskEndpoint: function (endpoint) {
        microsoftToDoTaskEndpoint = endpoint;
    },

    createToDo: function (msg) {
        var todo = {};

        // Handle forwared messages
        if (msg.forward_date) {
            const original_sender = (msg.forward_sender_name ? msg.forward_sender_name : msg.forward_from.first_name)
    
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

    addToQueue: function (todo_index, todo) {
        toDoQueue[todo_index] = todo;
    },

    toDoQueueItem: function (index) {
        return toDoQueue[index];
    },

    toDoQueue: function () {
        return toDoQueue;
    },

    deleteFromQueue: function (index) {
        const todo = toDoQueue[index];
        delete toDoQueue[index];
        return todo;
    },

    updateQueueItem: function (index, todo) {
        toDoQueue[index] = todo;
    },

    addToDo: async function (todo_index) {
        todo = this.deleteFromQueue(todo_index);
        console.log("Added to MS ToDo");
        await sendToMicrosoftToDo(todo["text"], todo["note"]);
    }
  };

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
