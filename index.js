const TelegramBot = require('node-telegram-bot-api').default;
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

if (process.env.TODO_ADDED_WEBHOOK) {
    todo_tools.setToDoAddedWebhook(process.env.TODO_ADDED_WEBHOOK);
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: true});

// Lets todo_tools fetch an image attachment without knowing about the bot
todo_tools.setAttachmentDownloader((attachment) => {
    return telegram_tools.downloadFileAsBase64(bot, attachment.file_id, attachment.mime_type);
});

// Adding a todo (image download included) happens in the background, so report
// failures to the chat instead of letting the rejection go unhandled.
function addToDo(chatId, todoId) {
    todo_tools.addToDo(chatId, todoId).catch((err) => {
        console.error(err);
        bot.sendMessage(chatId, `Error: failed to add to the todo list (${err.message})`);
    });
}

// Which field a "change title"/"change note" prompt maps to in the queued todo.
const EDIT_FIELDS = {
    title: {key: 'text', label: 'title', prompt: 'the new title'},
    note: {key: 'note', label: 'note', prompt: 'the new note'},
};

// Per-chat: if false, we're not waiting on anything. Otherwise it's
// {todoId, field}, where todoId is the message id corresponding to the todo
// item in the queue and field is 'title' or 'note'. Keyed by chat id since
// message ids are only unique within a single chat and AUTHORIZED_CHAT_IDS
// can list several chats.
var pendingEdit = {};

function confirmationText(todo) {
    const attachment_line = todo.attachment
        ? `\n\n<b>Attachment:</b> ${telegram_tools.sanitizeHTML(todo.attachment.file_name || 'image')}`
        : '';

    return `<b>Title:</b> ${telegram_tools.sanitizeHTML(todo.text)}\n\n<b>Note:</b> ${telegram_tools.sanitizeHTML(todo.note)}${attachment_line}\n\n\n<b>Add to the todo list?</b>`;
}

function confirmationOpts() {
    return telegram_tools.inlineKeyboardOpts(
        [[['Yes', 'yes'], ['No', 'no']], [['Change title', 'change_title'], ['Change note', 'change_note']]],
        {parse_mode: 'html'}
    );
}

// Re-show the Yes/No/Change... confirmation for a queued todo, editing the
// original confirmation message in place (same message id, so it stays the
// queue key) rather than sending a new one. Used both right after queuing a
// new todo and after coming back from a title/note edit, so the user can
// still edit the other field before confirming.
function showConfirmation(chatId, todoId, todo) {
    const opts = confirmationOpts();

    bot.editMessageText(confirmationText(todo), {
        chat_id: chatId,
        message_id: todoId,
        parse_mode: 'html',
        reply_markup: opts.reply_markup,
    }).catch((err) => {
        console.error(err);
        bot.sendMessage(chatId, `Error: failed to update the message (${err.message})`);
    });
}

// Listen for messages
bot.on('message', (msg) => {
  // Ignore the default "/start" message and those not coming from authorized chat IDs
  if (msg.text == '/start' || !authorized_chat_ids.includes(msg.chat.id)) {
    console.info('Message ignored')
    return
  }
  console.log(msg);

  const chatId = msg.chat.id;

  if (msg.text == '/cancel') {
    const pending = pendingEdit[chatId];
    if (pending) {
      pendingEdit[chatId] = false;
      telegram_tools.removeButtons(bot);
      showConfirmation(chatId, pending.todoId, todo_tools.toDoQueueItem(chatId, pending.todoId));
    }
    return;
  }

  // If pendingEdit is set we're waiting for the user to provide a new title or note for the Todo
  if (pendingEdit[chatId]) {
    const {todoId, field} = pendingEdit[chatId];
    const {key, label} = EDIT_FIELDS[field];

    if (!msg.text) {
      bot.sendMessage(chatId, `Send me a text message with the new ${label}, or press "Keep current ${label}" above.`);
      return;
    }

    // Update just the edited field, leaving the other one untouched
    var todo_to_update = todo_tools.toDoQueueItem(chatId, todoId);
    todo_to_update[key] = msg.text;
    todo_tools.updateQueueItem(chatId, todoId, todo_to_update);
    pendingEdit[chatId] = false;

    // Remove the button from the dangling "Send me the new ..." prompt
    telegram_tools.removeButtons(bot);

    // Back to the confirmation screen, so the other field can still be edited
    showConfirmation(chatId, todoId, todo_to_update);

    return;
  }

  // Create a new todo item
  const todo = todo_tools.createToDo(msg);
  if (todo) {
    // Ask the user for what to do
    bot.sendMessage(msg.chat.id, confirmationText(todo), confirmationOpts()).then((sentMsg) => {
        // Save todo to the queue
        todo_tools.addToQueue(chatId, sentMsg.message_id, todo);
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

    // Whichever button was pressed, it shouldn't be usable again.
    telegram_tools.addMessageToRemoveButtonsFrom(msg);

    switch (action) {
        case 'yes': {
            const todo_id = msg.message_id;
            telegram_tools.removeButtons(bot);
            bot.sendMessage(chatId, `Added to the todo list: ${todo_tools.toDoQueueItem(chatId, todo_id)['text']}`);
            addToDo(chatId, todo_id);
            break;
        }

        case 'change_title':
        case 'change_note': {
            const field = action === 'change_title' ? 'title' : 'note';
            const {label, prompt} = EDIT_FIELDS[field];
            pendingEdit[chatId] = {todoId: msg.message_id, field};
            telegram_tools.removeButtons(bot);

            const opts = telegram_tools.inlineKeyboardOpts([[[`Keep current ${label}`, 'cancel_edit']]]);
            bot.sendMessage(chatId, `Send me ${prompt}, or press the button below to leave it unchanged.`, opts)
                .then((sentMsg) => telegram_tools.addMessageToRemoveButtonsFrom(sentMsg));
            break;
        }

        case 'cancel_edit': {
            const pending = pendingEdit[chatId];
            telegram_tools.removeButtons(bot);
            if (pending) {
                pendingEdit[chatId] = false;
                showConfirmation(chatId, pending.todoId, todo_tools.toDoQueueItem(chatId, pending.todoId));
            }
            break;
        }

        default:
            telegram_tools.removeButtons(bot);
            todo_tools.deleteFromQueue(chatId, msg.message_id);
            bot.sendMessage(chatId, 'Message ignored');
            console.log(todo_tools.toDoQueue());
            break;
    }
  });
