'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../index');
const todo_tools = require('../todo_tools');
const telegram_tools = require('../telegram_tools');

// telegram_tools keeps a single process-wide queue of messages whose inline
// keyboard needs stripping. A "change title/note" prompt is added to it only
// once its send promise resolves, so a test that doesn't await that can leave
// an entry dangling for the next test to (wrongly) pick up. Start every test
// with that queue empty.
beforeEach(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    telegram_tools.removeButtons({ editMessageText: async () => ({}) });
});

// A minimal stand-in for the node-telegram-bot-api client, capturing every
// call instead of talking to Telegram. sendMessage returns a fake sent
// message so code that reads sentMsg.message_id keeps working.
function fakeBot(nextMessageId = 900) {
    let messageId = nextMessageId;

    return {
        sentMessages: [],
        editedMessages: [],
        sendMessage: async function (chatId, text, opts) {
            const message_id = messageId++;
            this.sentMessages.push({ chatId, text, opts, message_id });
            return { message_id, chat: { id: chatId }, text };
        },
        editMessageText: async function (text, opts) {
            this.editedMessages.push({ text, opts });
            return {};
        },
    };
}

function baseEnv() {
    return {
        TELEGRAM_BOT_TOKEN: 'token',
        AUTHORIZED_CHAT_IDS: '111,222',
        TODO_ADDER_AUTH_TOKEN: 'secret',
        TODO_TASK_ENDPOINT: 'https://example.com/api/v1/todo',
    };
}

describe('loadConfig', () => {
    it('parses a full, valid environment', () => {
        const config = app.loadConfig(baseEnv());

        assert.equal(config.telegramBotToken, 'token');
        assert.deepEqual(config.authorizedChatIds, [111, 222]);
        assert.equal(config.todoAdderAuthToken, 'secret');
        assert.equal(config.todoTaskEndpoint, 'https://example.com/api/v1/todo');
        assert.equal(config.todoAddedWebhook, null);
    });

    it('trims whitespace around chat ids', () => {
        const config = app.loadConfig({ ...baseEnv(), AUTHORIZED_CHAT_IDS: ' 111 , 222 ' });

        assert.deepEqual(config.authorizedChatIds, [111, 222]);
    });

    it('carries the webhook URL through when set', () => {
        const config = app.loadConfig({ ...baseEnv(), TODO_ADDED_WEBHOOK: 'https://example.com/webhook' });

        assert.equal(config.todoAddedWebhook, 'https://example.com/webhook');
    });

    for (const missing of ['TELEGRAM_BOT_TOKEN', 'AUTHORIZED_CHAT_IDS', 'TODO_ADDER_AUTH_TOKEN', 'TODO_TASK_ENDPOINT']) {
        it(`throws when ${missing} is missing`, () => {
            const env = baseEnv();
            delete env[missing];

            assert.throws(() => app.loadConfig(env), new RegExp(missing));
        });
    }
});

describe('confirmationText', () => {
    it('renders title, note and the confirmation prompt as HTML', () => {
        const text = app.confirmationText({ text: 'Buy milk', note: 'Added by Luca' });

        assert.equal(
            text,
            '<b>Title:</b> Buy milk\n\n<b>Note:</b> Added by Luca\n\n\n<b>Add to the todo list?</b>'
        );
    });

    it('escapes HTML-significant characters in title and note', () => {
        const text = app.confirmationText({ text: 'A & B <tag>', note: 'x' });

        assert.match(text, /A &amp; B &lt;tag&gt;/);
    });

    it('adds an attachment line when the todo has one', () => {
        const text = app.confirmationText({ text: 't', note: 'n', attachment: { file_name: 'photo.png' } });

        assert.match(text, /<b>Attachment:<\/b> photo\.png/);
    });

    it('falls back to a generic label when the attachment has no file name', () => {
        const text = app.confirmationText({ text: 't', note: 'n', attachment: {} });

        assert.match(text, /<b>Attachment:<\/b> image/);
    });
});

describe('confirmationOpts', () => {
    it('offers Yes/No and Change title/Change note buttons', () => {
        const opts = app.confirmationOpts();

        assert.deepEqual(opts.reply_markup.inline_keyboard, [
            [{ text: 'Yes', callback_data: 'yes' }, { text: 'No', callback_data: 'no' }],
            [{ text: 'Change title', callback_data: 'change_title' }, { text: 'Change note', callback_data: 'change_note' }],
        ]);
        assert.equal(opts.parse_mode, 'html');
    });
});

describe('showConfirmation', () => {
    it('edits the original message with the confirmation text and keyboard', async () => {
        const bot = fakeBot();

        app.showConfirmation(bot, 1, 42, { text: 'Buy milk', note: 'Added by Luca' });
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(bot.editedMessages.length, 1);
        const { text, opts } = bot.editedMessages[0];
        assert.match(text, /Buy milk/);
        assert.deepEqual(opts, { chat_id: 1, message_id: 42, parse_mode: 'html', reply_markup: app.confirmationOpts().reply_markup });
    });

    it('reports an error to the chat when the edit fails', async () => {
        const bot = fakeBot();
        bot.editMessageText = async () => { throw new Error('message is not modified'); };

        app.showConfirmation(bot, 1, 42, { text: 't', note: 'n' });
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(bot.sentMessages.length, 1);
        assert.match(bot.sentMessages[0].text, /Error: failed to update the message/);
    });
});

describe('handleMessage', () => {
    it('ignores /start', () => {
        app.setAuthorizedChatIds([111]);
        const bot = fakeBot();

        app.handleMessage(bot, { text: '/start', chat: { id: 111 }, from: { first_name: 'Luca' } });

        assert.equal(bot.sentMessages.length, 0);
    });

    it('ignores messages from unauthorized chats', () => {
        app.setAuthorizedChatIds([111]);
        const bot = fakeBot();

        app.handleMessage(bot, { text: 'hi', chat: { id: 999 }, from: { first_name: 'Luca' } });

        assert.equal(bot.sentMessages.length, 0);
    });

    it('queues a new todo and asks for confirmation', async () => {
        app.setAuthorizedChatIds([201]);
        const bot = fakeBot(1000);

        app.handleMessage(bot, { text: 'Buy milk', chat: { id: 201 }, from: { first_name: 'Luca' } });
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(bot.sentMessages.length, 1);
        assert.match(bot.sentMessages[0].text, /Buy milk/);
        assert.deepEqual(todo_tools.toDoQueueItem(201, 1000), { text: 'Buy milk', note: 'Added by Luca' });
    });

    it('sends nothing for a message with no usable text or attachment', () => {
        app.setAuthorizedChatIds([202]);
        const bot = fakeBot();

        app.handleMessage(bot, { chat: { id: 202 }, from: { first_name: 'Luca' } });

        assert.equal(bot.sentMessages.length, 0);
    });

    it('does nothing on /cancel when there is no pending edit', () => {
        app.setAuthorizedChatIds([203]);
        const bot = fakeBot();

        app.handleMessage(bot, { text: '/cancel', chat: { id: 203 }, from: { first_name: 'Luca' } });

        assert.equal(bot.sentMessages.length, 0);
        assert.equal(bot.editedMessages.length, 0);
    });

    it('prompts again when a title/note edit is pending but the reply has no text', async () => {
        app.setAuthorizedChatIds([204]);
        const bot = fakeBot(1100);

        app.handleMessage(bot, { text: 'Buy milk', chat: { id: 204 }, from: { first_name: 'Luca' } });
        await new Promise((resolve) => setImmediate(resolve));
        app.handleCallbackQuery(bot, {
            data: 'change_title',
            message: { message_id: 1100, chat: { id: 204 } },
        });

        bot.sentMessages = [];
        app.handleMessage(bot, { chat: { id: 204 }, from: { first_name: 'Luca' } });

        assert.equal(bot.sentMessages.length, 1);
        assert.match(bot.sentMessages[0].text, /Send me a text message with the new title/);
    });

    it('applies a pending title edit and returns to the confirmation screen', async () => {
        app.setAuthorizedChatIds([205]);
        const bot = fakeBot(1200);

        app.handleMessage(bot, { text: 'Buy milk', chat: { id: 205 }, from: { first_name: 'Luca' } });
        await new Promise((resolve) => setImmediate(resolve));
        app.handleCallbackQuery(bot, {
            data: 'change_title',
            message: { message_id: 1200, chat: { id: 205 } },
        });

        app.handleMessage(bot, { text: 'Buy oat milk', chat: { id: 205 }, from: { first_name: 'Luca' } });
        await new Promise((resolve) => setImmediate(resolve));

        assert.deepEqual(todo_tools.toDoQueueItem(205, 1200), { text: 'Buy oat milk', note: 'Added by Luca' });
        // handleCallbackQuery/handleMessage also edit message 1200 to strip its
        // old buttons (text-less edits), so the confirmation re-render is the
        // *last* edit targeting it, not necessarily the only one.
        const confirmationEdit = bot.editedMessages.findLast((e) => e.opts.message_id === 1200);
        assert.ok(confirmationEdit, 'expected the confirmation message to be re-edited');
        assert.match(confirmationEdit.text, /Buy oat milk/);

        // The edit is no longer pending, so a further plain message starts a
        // new todo instead of being swallowed as another edit reply.
        bot.sentMessages = [];
        app.handleMessage(bot, { text: 'Buy bread', chat: { id: 205 }, from: { first_name: 'Luca' } });
        await new Promise((resolve) => setImmediate(resolve));
        assert.match(bot.sentMessages[0].text, /Buy bread/);
    });
});

describe('handleCallbackQuery', () => {
    it('ignores callbacks from unauthorized chats', () => {
        app.setAuthorizedChatIds([111]);
        const bot = fakeBot();

        app.handleCallbackQuery(bot, { data: 'yes', message: { message_id: 1, chat: { id: 999 } } });

        assert.equal(bot.sentMessages.length, 0);
    });

    it('on "yes", confirms and hands the todo off to todo_tools.addToDo', async (t) => {
        app.setAuthorizedChatIds([301]);
        const bot = fakeBot();
        const addToDoMock = t.mock.method(todo_tools, 'addToDo', async () => {});

        todo_tools.addToQueue(301, 1300, { text: 'Buy milk', note: 'Added by Luca' });

        app.handleCallbackQuery(bot, { data: 'yes', message: { message_id: 1300, chat: { id: 301 } } });
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(bot.sentMessages.length, 1);
        assert.match(bot.sentMessages[0].text, /Added to the todo list: Buy milk/);
        assert.equal(addToDoMock.mock.calls.length, 1);
        assert.deepEqual(addToDoMock.mock.calls[0].arguments, [301, 1300]);
    });

    it('reports an error to the chat when todo_tools.addToDo fails', async (t) => {
        app.setAuthorizedChatIds([302]);
        const bot = fakeBot();
        t.mock.method(todo_tools, 'addToDo', async () => { throw new Error('adder is down'); });

        todo_tools.addToQueue(302, 1301, { text: 'Buy milk', note: 'Added by Luca' });

        app.handleCallbackQuery(bot, { data: 'yes', message: { message_id: 1301, chat: { id: 302 } } });
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(bot.sentMessages.length, 2);
        assert.match(bot.sentMessages[1].text, /Error: failed to add to the todo list \(adder is down\)/);
    });

    it('on "change_note", prompts for a new note with a "keep current" button', () => {
        app.setAuthorizedChatIds([303]);
        const bot = fakeBot();

        app.handleCallbackQuery(bot, { data: 'change_note', message: { message_id: 1400, chat: { id: 303 } } });

        assert.equal(bot.sentMessages.length, 1);
        const { text, opts } = bot.sentMessages[0];
        assert.match(text, /Send me the new note/);
        assert.deepEqual(opts.reply_markup.inline_keyboard, [[{ text: 'Keep current note', callback_data: 'cancel_edit' }]]);
    });

    it('on "cancel_edit", restores the confirmation screen unchanged and clears the pending edit', async () => {
        app.setAuthorizedChatIds([304]);
        const bot = fakeBot(1500);

        app.handleMessage(bot, { text: 'Buy milk', chat: { id: 304 }, from: { first_name: 'Luca' } });
        await new Promise((resolve) => setImmediate(resolve));
        app.handleCallbackQuery(bot, { data: 'change_title', message: { message_id: 1500, chat: { id: 304 } } });
        // The "cancel_edit" callback's own message is the prompt Telegram just
        // sent (the "Keep current title" button lives on it), not the original
        // confirmation message.
        const promptMessageId = bot.sentMessages.at(-1).message_id;

        app.handleCallbackQuery(bot, { data: 'cancel_edit', message: { message_id: promptMessageId, chat: { id: 304 } } });
        await new Promise((resolve) => setImmediate(resolve));

        const confirmationEdit = bot.editedMessages.findLast((e) => e.opts.message_id === 1500);
        assert.ok(confirmationEdit, 'expected the confirmation message to be re-edited');
        assert.match(confirmationEdit.text, /Buy milk/);
        assert.deepEqual(todo_tools.toDoQueueItem(304, 1500), { text: 'Buy milk', note: 'Added by Luca' });

        // The edit is no longer pending, so a plain reply is treated as a new todo.
        bot.sentMessages = [];
        app.handleMessage(bot, { text: 'Buy bread', chat: { id: 304 }, from: { first_name: 'Luca' } });
        await new Promise((resolve) => setImmediate(resolve));
        assert.match(bot.sentMessages[0].text, /Buy bread/);
    });

    it('strips its own button but shows no confirmation on "cancel_edit" when there is no pending edit', () => {
        app.setAuthorizedChatIds([305]);
        const bot = fakeBot();

        app.handleCallbackQuery(bot, { data: 'cancel_edit', message: { message_id: 1501, chat: { id: 305 } } });

        // Pressing any button always strips that button from the message it's
        // on; with no pending edit, that's the only edit that should happen.
        assert.equal(bot.editedMessages.length, 1);
        assert.equal(bot.editedMessages[0].opts.message_id, 1501);
        assert.equal(bot.sentMessages.length, 0);
    });

    it('on an unrecognized action, discards the queued todo and reports it as ignored', () => {
        app.setAuthorizedChatIds([306]);
        const bot = fakeBot();
        todo_tools.addToQueue(306, 1600, { text: 'Buy milk', note: 'Added by Luca' });

        app.handleCallbackQuery(bot, { data: 'no', message: { message_id: 1600, chat: { id: 306 } } });

        assert.equal(todo_tools.toDoQueueItem(306, 1600), undefined);
        assert.equal(bot.sentMessages.length, 1);
        assert.equal(bot.sentMessages[0].text, 'Message ignored');
    });
});
