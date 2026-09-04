'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const http = require('node:http');

const todoTools = require('../todo_tools');

// Stubs https.request/http.request with a fake ClientRequest that "responds"
// asynchronously, so tests never touch the network.
function fakeRequestImpl({ statusCode = 200, body = '' } = {}) {
    return function (url, options, callback) {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => {
            queueMicrotask(() => {
                const res = new EventEmitter();
                res.statusCode = statusCode;
                res.resume = () => {};
                callback(res);
                queueMicrotask(() => {
                    if (body) res.emit('data', Buffer.from(body));
                    res.emit('end');
                });
            });
        };
        req.destroy = () => {};
        return req;
    };
}

describe('createToDo', () => {
    it('uses the message text as the title and credits the sender', () => {
        const todo = todoTools.createToDo({
            text: 'Buy milk',
            from: { first_name: 'Luca' },
        });

        assert.deepEqual(todo, { text: 'Buy milk', note: 'Added by Luca' });
    });

    it('falls back to the caption when there is no text', () => {
        const todo = todoTools.createToDo({
            caption: 'A caption',
            from: { first_name: 'Luca' },
        });

        assert.equal(todo.text, 'A caption');
    });

    it('ignores messages with neither text nor a usable attachment', () => {
        const todo = todoTools.createToDo({ from: { first_name: 'Luca' } });

        assert.equal(todo, false);
    });

    it('attaches a compressed photo, picking the largest size', () => {
        const todo = todoTools.createToDo({
            caption: 'Look at this',
            photo: [{ file_id: 'small', width: 100 }, { file_id: 'big', width: 800 }],
            from: { first_name: 'Luca' },
        });

        assert.deepEqual(todo.attachment, { file_id: 'big' });
    });

    it('attaches an image document with its mime type and file name', () => {
        const todo = todoTools.createToDo({
            document: { file_id: 'doc1', mime_type: 'image/png', file_name: 'photo.png' },
            from: { first_name: 'Luca' },
        });

        assert.deepEqual(todo.attachment, {
            file_id: 'doc1',
            mime_type: 'image/png',
            file_name: 'photo.png',
        });
    });

    it('ignores non-image documents', () => {
        const todo = todoTools.createToDo({
            document: { file_id: 'doc1', mime_type: 'application/pdf', file_name: 'file.pdf' },
            from: { first_name: 'Luca' },
        });

        assert.equal(todo, false);
    });

    it('gives an uncaptioned photo a placeholder title', () => {
        const todo = todoTools.createToDo({
            photo: [{ file_id: 'a', width: 100 }],
            from: { first_name: 'Luca' },
        });

        assert.equal(todo.text, 'Image');
    });

    it('names the placeholder title after the file when there is one', () => {
        const todo = todoTools.createToDo({
            document: { file_id: 'doc1', mime_type: 'image/png', file_name: 'photo.png' },
            from: { first_name: 'Luca' },
        });

        assert.equal(todo.text, 'Image: photo.png');
    });

    it('marks forwarded messages and credits both the original sender and the forwarder', () => {
        const todo = todoTools.createToDo({
            text: 'Original text',
            forward_origin: { type: 'user', sender_user: { first_name: 'Alice' } },
            from: { first_name: 'Bob' },
        });

        assert.equal(todo.text, '#FU: (Alice)');
        assert.equal(todo.note, 'Original text\n\nAdded by Bob');
    });

    it('resolves the original sender for each forward_origin type', () => {
        const cases = [
            [{ type: 'user', sender_user: { first_name: 'Alice' } }, 'Alice'],
            [{ type: 'hidden_user', sender_user_name: 'Hidden Alice' }, 'Hidden Alice'],
            [{ type: 'chat', sender_chat: { title: 'A Chat' } }, 'A Chat'],
            [{ type: 'channel', chat: { title: 'A Channel' } }, 'A Channel'],
        ];

        for (const [forward_origin, expected] of cases) {
            const todo = todoTools.createToDo({
                text: 'hi',
                forward_origin,
                from: { first_name: 'Bob' },
            });
            assert.equal(todo.text, `#FU: (${expected})`);
        }
    });

    it('falls back to the legacy forward_from field on old Bot API messages', () => {
        const todo = todoTools.createToDo({
            text: 'hi',
            forward_date: 12345,
            forward_from: { first_name: 'Legacy Sender' },
            from: { first_name: 'Bob' },
        });

        assert.equal(todo.text, '#FU: (Legacy Sender)');
    });

    it('prefers forward_sender_name over forward_from when both are present', () => {
        const todo = todoTools.createToDo({
            text: 'hi',
            forward_date: 12345,
            forward_sender_name: 'Anonymous',
            forward_from: { first_name: 'Legacy Sender' },
            from: { first_name: 'Bob' },
        });

        assert.equal(todo.text, '#FU: (Anonymous)');
    });
});

describe('queue operations', () => {
    it('round-trips a todo through the queue, namespaced by chat id', () => {
        todoTools.addToQueue(1, 10, { text: 'a' });
        todoTools.addToQueue(2, 10, { text: 'b' });

        assert.deepEqual(todoTools.toDoQueueItem(1, 10), { text: 'a' });
        assert.deepEqual(todoTools.toDoQueueItem(2, 10), { text: 'b' });
    });

    it('updates an item in place', () => {
        todoTools.addToQueue(1, 11, { text: 'a' });
        todoTools.updateQueueItem(1, 11, { text: 'updated' });

        assert.deepEqual(todoTools.toDoQueueItem(1, 11), { text: 'updated' });
    });

    it('deletes and returns the removed item', () => {
        todoTools.addToQueue(1, 12, { text: 'to remove' });

        const removed = todoTools.deleteFromQueue(1, 12);

        assert.deepEqual(removed, { text: 'to remove' });
        assert.equal(todoTools.toDoQueueItem(1, 12), undefined);
    });
});

describe('addToDo', () => {
    beforeEach(() => {
        todoTools.setToDoAuthToken('test-token');
        todoTools.setToDoTaskEndpoint('https://example.com/api/v1/todo');
        todoTools.setToDoAddedWebhook('');
        todoTools.setAttachmentDownloader(null);
    });

    it('sends the queued todo to the adder and removes it from the queue', async (t) => {
        const requestMock = t.mock.method(https, 'request', fakeRequestImpl({ statusCode: 200, body: '{"id":"abc"}' }));

        todoTools.addToQueue('chat', 1, { text: 'Buy milk', note: 'Added by Luca' });

        await todoTools.addToDo('chat', 1);

        assert.equal(requestMock.mock.calls.length, 1);
        const [url, options] = requestMock.mock.calls[0].arguments;
        assert.equal(url, 'https://example.com/api/v1/todo');
        assert.equal(options.headers['Authorization'], 'test-token');
        assert.equal(todoTools.toDoQueueItem('chat', 1), undefined);
    });

    it('downloads and forwards the attachment image', async (t) => {
        t.mock.method(https, 'request', fakeRequestImpl({ statusCode: 200, body: '{}' }));
        const downloader = t.mock.fn(async () => 'data:image/png;base64,AAAA');
        todoTools.setAttachmentDownloader(downloader);

        todoTools.addToQueue('chat', 2, {
            text: 'Image',
            note: 'Added by Luca',
            attachment: { file_id: 'f1', file_name: 'photo.png' },
        });

        await todoTools.addToDo('chat', 2);

        assert.equal(downloader.mock.calls.length, 1);
        assert.deepEqual(downloader.mock.calls[0].arguments[0], { file_id: 'f1', file_name: 'photo.png' });
    });

    it('throws when the todo has an attachment but no downloader is configured', async () => {
        todoTools.addToQueue('chat', 3, {
            text: 'Image',
            note: 'Added by Luca',
            attachment: { file_id: 'f1' },
        });

        await assert.rejects(
            () => todoTools.addToDo('chat', 3),
            /No attachment downloader configured/
        );
    });

    it('calls the configured webhook with the created task id', async (t) => {
        t.mock.method(https, 'request', fakeRequestImpl({ statusCode: 200, body: '{"id":"task-42"}' }));
        const webhookRequestMock = t.mock.method(http, 'request', fakeRequestImpl({ statusCode: 200 }));

        todoTools.setToDoAddedWebhook('http://example.com/webhook');
        todoTools.addToQueue('chat', 4, { text: 'Buy milk', note: 'Added by Luca' });

        await todoTools.addToDo('chat', 4);
        // The webhook call is fired without being awaited, give it a tick to run.
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(webhookRequestMock.mock.calls.length, 1);
        const [url] = webhookRequestMock.mock.calls[0].arguments;
        assert.equal(url, 'http://example.com/webhook');
    });

    it('does not call the webhook when none is configured', async (t) => {
        t.mock.method(https, 'request', fakeRequestImpl({ statusCode: 200, body: '{"id":"1"}' }));
        const webhookRequestMock = t.mock.method(http, 'request', fakeRequestImpl({ statusCode: 200 }));

        todoTools.addToQueue('chat', 5, { text: 'Buy milk', note: 'Added by Luca' });
        await todoTools.addToDo('chat', 5);
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(webhookRequestMock.mock.calls.length, 0);
    });

    it('rejects when the adder responds with a non-2xx status', async (t) => {
        t.mock.method(https, 'request', fakeRequestImpl({ statusCode: 500, body: '' }));

        todoTools.addToQueue('chat', 6, { text: 'Buy milk', note: 'Added by Luca' });

        await assert.rejects(
            () => todoTools.addToDo('chat', 6),
            /HTTP status code 500/
        );
    });
});
