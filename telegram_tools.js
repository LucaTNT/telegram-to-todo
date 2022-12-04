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
    }
  };
