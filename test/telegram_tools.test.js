'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const telegramTools = require('../telegram_tools');

describe('sanitizeHTML', () => {
    it('escapes &, < and > for use in a Telegram HTML message', () => {
        assert.equal(
            telegramTools.sanitizeHTML('Tom & Jerry <script>alert(1)</script>'),
            'Tom &amp; Jerry &lt;script&gt;alert(1)&lt;/script&gt;'
        );
    });

    it('does not double-escape the ampersand it just inserted', () => {
        assert.equal(telegramTools.sanitizeHTML('<'), '&lt;');
    });

    it('leaves plain text untouched', () => {
        assert.equal(telegramTools.sanitizeHTML('Buy milk'), 'Buy milk');
    });
});

describe('inlineKeyboardOpts', () => {
    it('builds a reply_markup with rows/columns of {text, callback_data}', () => {
        const opts = telegramTools.inlineKeyboardOpts([
            [['Yes', 'yes'], ['No', 'no']],
            [['Change title', 'change_title']],
        ]);

        assert.deepEqual(opts, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Yes', callback_data: 'yes' }, { text: 'No', callback_data: 'no' }],
                    [{ text: 'Change title', callback_data: 'change_title' }],
                ],
            },
        });
    });

    it('preserves other options passed alongside the keyboard', () => {
        const opts = telegramTools.inlineKeyboardOpts([[['Yes', 'yes']]], { parse_mode: 'html' });

        assert.equal(opts.parse_mode, 'html');
        assert.deepEqual(opts.reply_markup.inline_keyboard, [[{ text: 'Yes', callback_data: 'yes' }]]);
    });

    it('returns an empty keyboard for no rows', () => {
        const opts = telegramTools.inlineKeyboardOpts([]);

        assert.deepEqual(opts.reply_markup.inline_keyboard, []);
    });
});

describe('downloadFileAsBase64', () => {
    it('returns a bare base64 string when no mime type is known', async (t) => {
        const bot = { getFileLink: async () => 'https://t.me/file/doc.bin' };
        t.mock.method(globalThis, 'fetch', async (url) => {
            assert.equal(url, 'https://t.me/file/doc.bin');
            return {
                ok: true,
                // Buffer.from().buffer is a view into Node's shared pool, not a
                // right-sized ArrayBuffer, so copy into a fresh one first.
                arrayBuffer: async () => Uint8Array.from(Buffer.from('hello')).buffer,
            };
        });

        const result = await telegramTools.downloadFileAsBase64(bot, 'file1');

        assert.equal(result, Buffer.from('hello').toString('base64'));
    });

    it('returns a data URI when a mime type is provided', async (t) => {
        const bot = { getFileLink: async () => 'https://t.me/file/photo.jpg' };
        t.mock.method(globalThis, 'fetch', async () => ({
            ok: true,
            arrayBuffer: async () => Uint8Array.from(Buffer.from('img-bytes')).buffer,
        }));

        const result = await telegramTools.downloadFileAsBase64(bot, 'file2', 'image/jpeg');

        assert.equal(result, `data:image/jpeg;base64,${Buffer.from('img-bytes').toString('base64')}`);
    });

    it('throws when Telegram returns a non-ok response', async (t) => {
        const bot = { getFileLink: async () => 'https://t.me/file/missing.bin' };
        t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 }));

        await assert.rejects(
            () => telegramTools.downloadFileAsBase64(bot, 'file3'),
            /Telegram returned HTTP 404/
        );
    });
});

describe('addMessageToRemoveButtonsFrom / removeButtons', () => {
    it('edits every queued message back to its own text, then clears the queue', async (t) => {
        const editCalls = [];
        const bot = {
            editMessageText: async (text, opts) => {
                editCalls.push({ text, opts });
                return {};
            },
        };

        telegramTools.addMessageToRemoveButtonsFrom({
            text: 'first',
            chat: { id: 1 },
            message_id: 100,
        });
        telegramTools.addMessageToRemoveButtonsFrom({
            text: 'second',
            chat: { id: 2 },
            message_id: 200,
        });

        telegramTools.removeButtons(bot);
        // editMessageText is called synchronously but awaited internally via a
        // promise chain, so let microtasks flush before asserting.
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(editCalls.length, 2);
        assert.deepEqual(editCalls[0], { text: 'first', opts: { chat_id: 1, message_id: 100 } });
        assert.deepEqual(editCalls[1], { text: 'second', opts: { chat_id: 2, message_id: 200 } });

        // The queue was cleared, so a second call edits nothing.
        telegramTools.removeButtons(bot);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(editCalls.length, 2);
    });

    it('swallows editMessageText failures so a stale button never crashes the process', async (t) => {
        const bot = { editMessageText: async () => { throw new Error('message is not modified'); } };

        telegramTools.addMessageToRemoveButtonsFrom({ text: 'x', chat: { id: 1 }, message_id: 1 });

        assert.doesNotThrow(() => telegramTools.removeButtons(bot));
        await new Promise((resolve) => setImmediate(resolve));
    });
});
