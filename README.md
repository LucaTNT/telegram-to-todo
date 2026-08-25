This Telegram bot takes whatever message it is sent or forwarded and sends it to a [LucaTNT/microsoft-todo-adder](https://github.com/LucaTNT/microsoft-todo-adder) API endpoint to add it to a Microsoft To Do list.

Before adding a message to the list, you can edit its title and/or note independently using the "Cambia titolo" / "Cambia nota" buttons — editing one leaves the other untouched. After you send the new value the bot returns to the same confirmation screen (rather than adding it right away), so you can edit the other field too before confirming with "Sì". While waiting for a new title/note you can back out with the "Mantieni ... attuale" button or by sending `/cancel`.

## Images

Messages carrying an image are attached to the todo, using the adder's `image` field. Both compressed
photos and images sent as files (any `image/*` document) work; other file types are still ignored.
The caption becomes the todo title, and a picture sent with no caption gets a placeholder title that
you can replace with "Cambia titolo".

The image is only downloaded from Telegram once you confirm the todo, so declined messages cost
nothing. Note that this needs an adder that supports attachments — plain-text todos keep working
against an older one.

## Configuration

It requires four parameters through environment variables:

- `TELEGRAM_BOT_TOKEN` (required) is the token obtained from [@Botfather](https://t.me/botfather).
- `AUTHORIZED_CHAT_IDS` is a comma-separated list of chat IDs allowed to talk to the bot. Get yours through [@chatIDrobot](https://t.me/chatIDrobot).
- `TODO_ADDER_AUTH_TOKEN` is the secret authorization code that allows access to `microsoft-todo-adder`
- `TODO_TASK_ENDPOINT` is the `microsoft-todo-adder` endpoint (it usually ends with `/api/v1/todo`)

## Running the app

You can either run the app directly through NodeJS

    TELEGRAM_BOT_TOKEN=your-token AUTHORIZED_CHAT_IDS=your-chat-id TODO_ADDER_AUTH_TOKEN=your-secret TODO_TASK_ENDPOINT=your-endpoint node index.js

Or you can run it in Docker

    docker run -e TELEGRAM_BOT_TOKEN=your-token -e AUTHORIZED_CHAT_IDS=your-chat-id -e TODO_ADDER_AUTH_TOKEN=your-secret -e TODO_TASK_ENDPOINT=your-endpoint --init cr.casa.lucazorzi.net/easypodcast/telegram-to-todo

Note that the `--init` option is highly recommended because it allows you to stop the container through a simple Ctrl+C when running in the foreground. Without it you need to use `docker stop`.
