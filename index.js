const TelegramBot = require('node-telegram-bot-api');
var todo_tools = require('./todo_tools');
var telegram_tools = require('./telegram_tools');

if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log("Missing TELEGRAM_BOT_TOKEN env variable");
    process.exit(1);
}

var authorized_chat_ids = []
if (process.env.AUTHORIZED_CHAT_IDS) {
    let authorized_ids = process.env.AUTHORIZED_CHAT_IDS.split(",");

    authorized_ids.forEach((id) => {
        authorized_chat_ids.push(parseInt(id.trim()));
    });
} else {
    console.log("Missing AUTHORIZED_CHAT_IDS env variable");
    process.exit(1);
}

if (!process.env.TODO_ADDER_AUTH_TOKEN) {
    console.log("Missing TODO_ADDER_AUTH_TOKEN env variable");
    process.exit(1);
}

if (!process.env.TODO_TASK_ENDPOINT) {
    console.log("Missing TODO_TASK_ENDPOINT env variable");
    process.exit(1);
}

todo_tools.setToDoAuthToken(process.env.TODO_ADDER_AUTH_TOKEN);
todo_tools.setToDoTaskEndpoint(process.env.TODO_TASK_ENDPOINT);

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: true});

// If false, we're waiting for a new item to be added to the queue.
// If not false, it should be the message id corresponding to the
// todo item in the queue
var waitingForNewTitle = false;

// Listen for messages
bot.on('message', (msg) => {
  // Ignore the default "/start" message and those not coming from authorized chat IDs
  if (msg.text == '/start' || !authorized_chat_ids.includes(msg.chat.id)) {
    console.info('Message ignored')
    return
  }
  console.log(msg);

  // If waitingForNewTitle is not false we're waiting for the user to provide the new title for the Todo
  if (waitingForNewTitle) {
    var todo_to_update = todo_tools.toDoQueueItem(waitingForNewTitle);
    bot.sendMessage(msg.chat.id, `Vecchio titolo: ${todo_to_update['text']}\nNuovo titolo:${msg.text}`);

    // Update the todo
    todo_to_update['note'] = `${todo_to_update['text']}\n\n${todo_to_update['note']}`;
    todo_to_update['text'] = msg.text;
    todo_tools.updateQueueItem(waitingForNewTitle, todo_to_update);

    todo_tools.addToDo(waitingForNewTitle);
    waitingForNewTitle = false;

    // Make sure we have no messages with dead buttons around.
    telegram_tools.removeButtons(bot);

    return;
  }

  // Create a new todo item
  const todo = todo_tools.createToDo(msg);
  if (todo) {
    const opts = telegram_tools.inlineKeyboardOpts(
        [[['Sì', 'yes'], ['No', 'no']], [['Cambia titolo', 'change_title']]],
        {parse_mode: 'html'}
    );

    // Ask the user for what to do
    bot.sendMessage(
        msg.chat.id,
        `<b>Titolo:</b> ${telegram_tools.sanitizeHTML(todo.text)}\n\n<b>Nota:</b> ${telegram_tools.sanitizeHTML(todo.note)}\n\n\n<b>Aggiungo alla scaletta?</b>`,
        opts
    ).then((msg) => {
        // Save todo to the queue
        todo_tools.addToQueue(msg.message_id, todo);
        console.log(todo_tools.toDoQueue())
    });
  }
});

// Handle user callback button presses
bot.on('callback_query', function onCallbackQuery(callbackQuery) {
    const action = callbackQuery.data;
    const msg = callbackQuery.message;

    let text;
    var opts = {};

    switch (action) {
        case 'yes':
            todo_id = (waitingForNewTitle ? waitingForNewTitle : msg.message_id);
            text = `Aggiunto alla scaletta: ${todo_tools.toDoQueueItem(todo_id)['text']}`;
            waitingForNewTitle = false;
            todo_tools.addToDo(todo_id);
            break;

        case 'change_title':
            waitingForNewTitle = msg.message_id;
            text = `Inviami il nuovo titolo, oppure premi "Mantieni titolo attuale"`;
            opts = telegram_tools.inlineKeyboardOpts([[['Mantieni titolo attuale', 'yes']]])
            break;
    
        default:
            text = `Messaggio ignorato`
            delete todo_tools.deleteFromQueue(msg.message_id);
            console.log(todo_tools.toDoQueue());
            break;
    }
  
    // Remove buttons from original message
    telegram_tools.addMessageToRemoveButtonsFrom(msg);
    telegram_tools.removeButtons(bot);

    // Reply with what we've done
    bot.sendMessage(msg.chat.id, text, opts).then((msg) => {
        telegram_tools.addMessageToRemoveButtonsFrom(msg);
    });
  });
