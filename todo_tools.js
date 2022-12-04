var toDoQueue = {};

module.exports = {
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
        delete toDoQueue[index];
    },

    addToDo: function (todo_index) {
        this.deleteFromQueue(todo_index);
        console.log("Added to MS ToDo");
    }
  };
