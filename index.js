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

// Per-chat: if false, we're waiting for a new item to be added to the queue.
// If not false, it should be the message id corresponding to the
// todo item in the queue. Keyed by chat id since message ids are only
// unique within a single chat and AUTHORIZED_CHAT_IDS can list several chats.
var waitingForNewTitle = {};

// Listen for messages
bot.on('message', (msg) => {
  // Ignore the default "/start" message and those not coming from authorized chat IDs
  if (msg.text == '/start' || !authorized_chat_ids.includes(msg.chat.id)) {
    console.info('Message ignored')
    return
  }
  console.log(msg);

  const chatId = msg.chat.id;

  // If waitingForNewTitle is not false we're waiting for the user to provide the new title for the Todo
  if (waitingForNewTitle[chatId]) {
    var todo_to_update = todo_tools.toDoQueueItem(chatId, waitingForNewTitle[chatId]);
    bot.sendMessage(msg.chat.id, `Vecchio titolo: ${todo_to_update['text']}\nNuovo titolo:${msg.text}`);

    // Update the todo
    todo_to_update['note'] = `${todo_to_update['text']}\n\n${todo_to_update['note']}`;
    todo_to_update['text'] = msg.text;
    todo_tools.updateQueueItem(chatId, waitingForNewTitle[chatId], todo_to_update);

    todo_tools.addToDo(chatId, waitingForNewTitle[chatId]);
    waitingForNewTitle[chatId] = false;

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
        todo_tools.addToQueue(chatId, msg.message_id, todo);
        console.log(todo_tools.toDoQueue())
    });
  }
});

// Handle user callback button presses
bot.on('callback_query', function onCallbackQuery(callbackQuery) {
    const msg = callbackQuery.message;

    // Ignore callbacks coming from chats that aren't authorized
    if (!authorized_chat_ids.includes(msg.chat.id)) {
        console.info('Callback query ignored')
        return
    }

    const action = callbackQuery.data;
    const chatId = msg.chat.id;

    let text;
    var opts = {};

    switch (action) {
        case 'yes':
            let todo_id = (waitingForNewTitle[chatId] ? waitingForNewTitle[chatId] : msg.message_id);
            text = `Aggiunto alla scaletta: ${todo_tools.toDoQueueItem(chatId, todo_id)['text']}`;
            waitingForNewTitle[chatId] = false;
            todo_tools.addToDo(chatId, todo_id);
            break;

        case 'change_title':
            waitingForNewTitle[chatId] = msg.message_id;
            text = `Inviami il nuovo titolo, oppure premi "Mantieni titolo attuale"`;
            opts = telegram_tools.inlineKeyboardOpts([[['Mantieni titolo attuale', 'yes']]])
            break;

        default:
            text = `Messaggio ignorato`
            delete todo_tools.deleteFromQueue(chatId, msg.message_id);
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
