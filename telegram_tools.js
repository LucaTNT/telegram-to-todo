// Used to store the messages that need their inline keyboard buttons removed.
// Required when prompting an input while also offering an inline button.
var messageToRemoveButtonsFrom = [];

module.exports = {
    // Sanitizie the output as required by the html formatter in Telegram messages
    sanitizeHTML: function (string) {
        return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    // This allows for more compact code when generating option dictionaries for inline keyboard
    inlineKeyboardOpts: function (keyboards, opts = {}) {
        opts['reply_markup'] = {inline_keyboard: []};

        for (let row = 0; row < keyboards.length; row++) {
            const columns = keyboards[row];
            opts['reply_markup']['inline_keyboard'].push([])
            for (let column = 0; column < columns.length; column++) {
                const keyboard = columns[column];
                opts['reply_markup']['inline_keyboard'][row].push({
                    text: keyboard[0],
                    callback_data: keyboard[1]
                });
            }
        }

        return opts;
    },

    // Download a file from Telegram and return it base64-encoded, in the format
    // expected by the todo adder's `image` field. When the MIME type is known a
    // full data URI is returned, otherwise the adder sniffs it from the bytes.
    downloadFileAsBase64: async function (bot, fileId, mimeType) {
        const link = await bot.getFileLink(fileId);
        const response = await fetch(link);

        if (!response.ok) {
            throw new Error(`Telegram returned HTTP ${response.status} while downloading the file`);
        }

        const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');

        return mimeType ? `data:${mimeType};base64,${base64}` : base64;
    },

    addMessageToRemoveButtonsFrom: function (msg) {
        messageToRemoveButtonsFrom.push(msg);
    },

    removeButtons: function (bot) {
        messageToRemoveButtonsFrom.forEach((msg) => {
            const original_message_opts = {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
            };

            // Ignore errors (e.g. "message is not modified" when the text is
            // unchanged, or the message having since been deleted) so a stale
            // button never crashes the process.
            bot.editMessageText(msg.text, original_message_opts).catch(() => {});
        });

        messageToRemoveButtonsFrom = [];
    }
  };
