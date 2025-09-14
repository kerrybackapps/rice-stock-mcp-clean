# Rice Stock Data MCP Server

A Model Context Protocol (MCP) server for accessing Rice Business Stock Market Data Portal through Claude Desktop.

## Features

- Natural language queries for stock market data
- Access to comprehensive financial metrics and indicators
- Rice University email verification for access control
- Seamless integration with Claude Desktop

## Claude Desktop Configuration

### Step 1: Get Your Access Token
1. Visit the Rice Business Stock Market Data Portal
2. Verify your Rice University email address
3. Copy your personal access token

### Step 2: Configure Claude Desktop
1. Open Claude Desktop
2. Go to Settings → Developer → Edit Config
3. Add the following configuration to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rice-stock-data": {
      "command": "npx",
      "args": ["@kerryback/data-portal-mcp"],
      "env": {
        "USER_ACCESS_TOKEN": "your_actual_access_token_here",
        "APP_URL": "https://data-portal-mcp.rice-business.org"
      }
    }
  }
}
```

4. Replace `"your_actual_access_token_here"` with your actual access token from Step 1 (keep the quotation marks)
5. Save the configuration file
6. Restart Claude Desktop

### Step 3: Using the MCP Server
Once configured, you can ask Claude questions about stock market data:
- "Show me tech stocks with PE under 20"
- "What are Apple's financial ratios?"
- "List healthcare companies by market cap"
- "Get the latest earnings data for Microsoft"
- "Compare revenue growth across FAANG stocks"

## Local Development

### Installation
```bash
npm install
npm run build
```

### Running the MCP Server Locally
```bash
npm run start:mcp
```

### Running the Web Server (for deployment)
```bash
npm start
```

## Environment Variables

- `USER_ACCESS_TOKEN` - Your personal Rice Data Portal access token (required)
- `APP_URL` - Data portal base URL (default: https://data-portal-mcp.rice-business.org)
- `PORT` - Web server port (default: 8000, used for deployment only)

## API Endpoints

The web server provides these endpoints (for deployment):
- `GET /` - Server information
- `GET /health` - Health check endpoint
- `POST /chat` - Query endpoint (requires token in request body)

## Troubleshooting

### "Authentication failed" error
- Verify your access token is correct and hasn't expired
- Ensure you've verified your Rice University email

### "Rate limit exceeded" error
- Wait a moment before making additional queries
- The API has rate limiting to ensure fair usage

### Claude Desktop doesn't show the MCP server
- Make sure you've restarted Claude Desktop after configuration
- Check that the configuration JSON is valid (no syntax errors)
- Verify the package name is correct: `@kerryback/data-portal-mcp`

## Support

For issues or questions about:
- **MCP Server**: Open an issue in this repository
- **Data Portal Access**: Contact Rice Business IT support
- **Stock Data**: Refer to the Rice Business Stock Market Data Portal documentation

## License

MIT