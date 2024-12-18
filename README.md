# Gmail Smart Reply Extension

## Setup
1. Clone the repository
2. Copy `config.example.js` to `config.js`
3. Add your OpenAI API key to `config.js`
4. Load the extension in Chrome

## Development
- Never commit `config.js`
- Always use `config.example.js` for the template
- Keep API keys in environment variables for production

## Production Deployment
For production, use environment variables and a build process:
1. Use dotenv for local development
2. Set up CI/CD to inject API keys during build
3. Use production secrets management in deployment# llm-quotation-extension
