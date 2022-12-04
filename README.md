This Telegram bot takes whatever message it is sent or forwarded and sends it to a `LucaTNT/microsoft-todo-adder` API endpoint to add it to a Microsoft To Do list.

## Configuration

It requires four parameters through environment variables:

- `TELEGRAM_BOT_TOKEN` (required) is the token obtained from [@Botfather](https://t.me/botfather).
- `AUTHORIZED_CHAT_IDS` is a comma-separated list of chat IDs allowed to talk to the bot. Get yours through [@chatIDrobot]https://t.me/chatIDrobot).
- `TODO_ADDER_AUTH_TOKEN` is the secret authorization code that allows access to `microsoft-todo-adder`
- `TODO_TASK_ENDPOINT` is the `microsoft-todo-adder` endpoint (it usually ends with `/api/v1/todo`)

## Running the app

You can either run the app directly through NodeJS

    TELEGRAM_BOT_TOKEN=your-token AUTHORIZED_CHAT_IDS=your-chat-id TODO_ADDER_AUTH_TOKEN=your-secret TODO_TASK_ENDPOINT=your-endpoint node index.js

Or you can run it in Docker

    docker run -e TELEGRAM_BOT_TOKEN=your-token -e AUTHORIZED_CHAT_IDS=your-chat-id -e TODO_ADDER_AUTH_TOKEN=your-secret -e TODO_TASK_ENDPOINT=your-endpoint --init cr.casa,kycazirzu,bet/telegram-to-todo

Note that the `--init` option is highly recommended because it allows you to stop the container through a simple Ctrl+C when running in the foreground. Without it you need to use `docker stop`.
