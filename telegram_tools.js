// Used to store the messages that need their inline keyboard buttons removed.
// Required when prompting an input while also offering an inline button.
var messageToRemoveButtonsFrom = [];

module.exports = {
    // Sanitizie the output as required by the html formatter in Telegram messages
    sanitizeHTML: function (string) {
        return string.replace('<', '&lt;').replace('>', '&gt;').replace('&', '&amp;');
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

    addMessageToRemoveButtonsFrom: function (msg) {
        messageToRemoveButtonsFrom.push(msg);
    },

    removeButtons: function (bot) {
        messageToRemoveButtonsFrom.forEach((msg) => {
            const original_message_opts = {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
            };

            bot.editMessageText(msg.text, original_message_opts);
        });

        messageToRemoveButtonsFrom = [];
    }
  };
