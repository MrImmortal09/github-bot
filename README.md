# Github Bot

> A GitHub App built with [Probot](https://github.com/probot/probot) that automates issue management workflows.

## What does this project do?

This project is a GitHub bot designed to streamline issue management workflows. It automates tasks such as assigning issues, labeling, and more, making it easier for maintainers and contributors to manage their projects efficiently.

## Setup

To set up the project locally, follow these steps:

```sh
# 1. Clone the repository
git clone https://github.com/0PrashantYadav0/github-bot.git

# 2. Navigate to the project directory
cd github-bot

# 3. Install dependencies
npm install

# 4. Start the bot
npm start
```

## Database Setup

To start the database using Docker Compose, follow these steps:

```sh
# 1. Ensure Docker and Docker Compose are installed on your machine

# 2. Start the database container
docker-compose up -d

# 3. The database will be available at the URL specified in the docker-compose.yml file
#    Update your environment variables to use this database URL
```

## Docker

To run the project using Docker, follow these steps:

```sh
# 1. Build the container
docker build -t github-bot .

# 2. Start the container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> -e DATABASE_URL=<database-url> github-bot
```

## Contributing

We welcome contributions! If you have suggestions for improvements or want to report a bug, please open an issue. Here are the steps to contribute:

1. **Open an Issue**: If you find a bug or have a feature request, open an issue using the provided template.
2. **Get Assigned**: Use the `/assign` command in the issue comments to get assigned to the issue.
3. **Open a Pull Request**: Once you have made your changes, open a pull request for review.

For more details, check out the [Contributing Guide](CONTRIBUTING.md).

## Links

- [Probot](https://github.com/probot/probot)
- [Contributing Guide](CONTRIBUTING.md)
- [Issue Template](.github/ISSUE_TEMPLATE.md)

## License

[ISC](LICENSE) © 2025 JoyBoy