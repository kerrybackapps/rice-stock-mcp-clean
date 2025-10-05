#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ToolArguments {
  prompt: string;
  [key: string]: any;
}

class RiceStockDataMCPServer {
  private server: Server;
  private baseUrl: string;
  private userAccessToken: string;
  private failureCount: number = 0;
  private maxFailures: number = 3;

  constructor() {
    this.server = new Server(
      {
        name: "rice-stock-data",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Use the same base URL pattern as your Koyeb deployment
    this.baseUrl = process.env.KOYEB_APP_URL || process.env.APP_URL || "https://your-app.koyeb.app";
    
    // Each user stores their personal Rice Portal access token in Claude Desktop config
    this.userAccessToken = process.env.USER_ACCESS_TOKEN || "";
    
    console.error(`Rice Stock Data MCP Server starting - connecting to: ${this.baseUrl}`);
    
    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        if (name !== "query_data") {
          return {
            content: [{
              type: "text",
              text: `Unknown tool: ${name}`
            } as TextContent]
          };
        }

        const prompt = (args as ToolArguments).prompt;

        if (!this.userAccessToken) {
          return {
            content: [{
              type: "text",
              text: "❌ **Configuration Required**: USER_ACCESS_TOKEN environment variable is missing.\n\n" +
                    "**To configure:**\n" +
                    "1. Get your access token by confirming your university email at the Rice Data Portal\n" +
                    "2. Add it to your Claude Desktop config:\n" +
                    "   ```json\n" +
                    "   \"env\": {\n" +
                    "     \"USER_ACCESS_TOKEN\": \"your_token_here\"\n" +
                    "   }\n" +
                    "   ```\n" +
                    "3. Restart Claude Desktop completely (right-click system tray → quit)"
            } as TextContent]
          };
        }

        if (!prompt) {
          return {
            content: [{
              type: "text",
              text: "Error: Please provide a query about the stock market data you'd like to access."
            } as TextContent]
          };
        }

        // Use the user's personal access token stored in Claude Desktop config
        const result = await this.queryWithNaturalLanguage(this.userAccessToken, prompt);

        return {
          content: [{
            type: "text",
            text: result
          } as TextContent]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          } as TextContent]
        };
      }
    });
  }

  private getToolDefinitions(): Tool[] {
    return [
      {
        name: "query_data",
        description: "Query Rice Stock Data Portal using natural language. Ask questions about stocks, financial metrics, sectors, or any market data.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Natural language query about stock market data (e.g., 'Show me tech stocks with PE under 20', 'What are Apple's financial ratios?', 'List healthcare companies by market cap')"
            }
          },
          required: ["prompt"]
        }
      }
    ];
  }

  private async queryWithNaturalLanguage(token: string, prompt: string): Promise<string> {
    try {
      // Determine which model to use based on failure count
      const model = this.failureCount >= this.maxFailures ? 'gpt-5' : 'gpt-4.1';
      
      // Step 1: Get AI response and SQL query from /chat endpoint
      const chatResponse = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `${prompt} (Please provide ALL results without LIMIT clause - I need the complete dataset)`,
          conversation_id: "mcp_session",
          model: model
        })
      });

      if (!chatResponse.ok) {
        // Increment failure count for non-auth errors
        if (chatResponse.status !== 401) {
          this.failureCount++;
        }
        
        if (chatResponse.status === 401) {
          return "Authentication failed. Please check your access token is valid and hasn't expired.";
        } else if (chatResponse.status === 429) {
          return "Rate limit exceeded. Please wait a moment before trying again.";
        } else {
          const errorText = await chatResponse.text();
          return `API error (status ${chatResponse.status}): ${errorText}`;
        }
      }

      const chatData = await chatResponse.json() as any;
      const communication = chatData.communication || '';
      const sqlQuery = chatData.sql_query || '';

      // Check if we switched to GPT-5 and notify user (before resetting failure count)
      let modelNotification = '';
      if (model === 'gpt-5' && this.failureCount >= this.maxFailures) {
        modelNotification = '🔄 **Switched to GPT-5.0** due to previous failures with GPT-4.1.\n\n';
      }

      // Reset failure count on successful response
      this.failureCount = 0;

      // Step 2: If there's no SQL query, return the communication (likely a clarifying question)
      if (!sqlQuery || sqlQuery.trim() === '') {
        if (communication.includes('?') || communication.toLowerCase().includes('clarif')) {
          return `${modelNotification}**Question for you:** ${communication}`;
        }
        return `${modelNotification}${communication}`;
      }

      // Step 3: Execute the SQL query to get actual data
      const queryResponse = await fetch(`${this.baseUrl}/api/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: sqlQuery
        })
      });

      if (!queryResponse.ok) {
        const errorText = await queryResponse.text();
        return `${modelNotification}Query execution failed: ${errorText}`;
      }

      const queryData = await queryResponse.json() as any;

      // Step 4: Save data to CSV and return file path with user choice prompt
      if (queryData.data && Array.isArray(queryData.data)) {
        // Save data to temporary CSV file
        const csvFilePath = await this.saveDataAsCSV(queryData.data, queryData.columns);

        let result = modelNotification;
        result += communication ? `${communication}\n\n` : '';
        result += `**Query executed:** \`${sqlQuery}\`\n\n`;
        result += `**Results:** Retrieved ${queryData.rows} rows in ${queryData.execution_time?.toFixed(2)}s\n\n`;

        result += `📊 **Data Retrieved Successfully**\n\n`;
        result += `**Data saved to:** \`${csvFilePath}\`\n\n`;
        result += `**Ask the user:** How would you like me to handle this data?\n\n`;
        result += `1. **Show on screen** - Display the data in a formatted table\n`;
        result += `2. **Provide download link** - The file is already saved at the path above\n`;
        result += `3. **Work with data** - Analyze, visualize, or process the data programmatically\n\n`;
        result += `**Note:** The data is available in the CSV file at the path shown above. ` +
                  `You can read it directly using the Read tool or work with it programmatically.`;

        return result;
      } else {
        return `${modelNotification}${communication}\n\nQuery executed but returned no data.`;
      }

    } catch (error) {
      // Increment failure count on exceptions
      this.failureCount++;
      
      if (error instanceof Error && error.name === 'AbortError') {
        return "Request timed out. The query might be too complex. Try simplifying your question.";
      }
      return `Error connecting to the data portal: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async saveDataAsCSV(data: any[], columns: string[]): Promise<string> {
    // Save to user's home directory in a dedicated rice-stock-data folder
    // This makes files persistent and accessible to Claude Desktop
    const homeDir = os.homedir();
    const dataDir = path.join(homeDir, 'rice-stock-data');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `stock-data-${timestamp}.csv`;
    const filePath = path.join(dataDir, filename);

    // Convert data to CSV format
    let csvContent = columns.join(',') + '\n';

    for (const row of data) {
      const rowValues = columns.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return '';

        // Escape values that contain commas, quotes, or newlines
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      csvContent += rowValues.join(',') + '\n';
    }

    // Write to file
    fs.writeFileSync(filePath, csvContent, 'utf-8');

    return filePath;
  }

  private formatQueryResults(data: any[], columns: string[]): string {
    if (!data || data.length === 0) {
      return "No results found.";
    }

    // For very small datasets (≤5 rows), show complete table
    if (data.length <= 5) {
      let result = "```\n";
      
      // Header row
      result += columns.join(" | ") + "\n";
      result += columns.map(() => "---").join(" | ") + "\n";
      
      // Data rows
      for (const row of data) {
        const rowValues = columns.map(col => {
          const value = row[col];
          if (value === null || value === undefined) return "null";
          if (typeof value === "number") return value.toLocaleString();
          return String(value);
        });
        result += rowValues.join(" | ") + "\n";
      }
      
      result += "```";
      return result;
    }

    // For medium datasets (6-20 rows), show all with warning
    if (data.length <= 20) {
      let result = `Complete dataset (${data.length} rows):\n\n`;
      result += "```\n";
      
      // Header row
      result += columns.join(" | ") + "\n";
      result += columns.map(() => "---").join(" | ") + "\n";
      
      // All rows
      for (const row of data) {
        const rowValues = columns.map(col => {
          const value = row[col];
          if (value === null || value === undefined) return "null";
          if (typeof value === "number") return value.toLocaleString();
          return String(value);
        });
        result += rowValues.join(" | ") + "\n";
      }
      
      result += "```";
      return result;
    }

    // For large datasets (>20 rows), show first/last few + summary
    let result = `**Large Dataset Retrieved** (${data.length} total rows)\n\n`;
    result += `🚫 **Do not print this entire dataset - it will be very slow!**\n\n`;
    result += `💾 **CSV Download:** Provide a link to download this data as a CSV file.\n\n`;
    result += "**Sample - First 3 rows:**\n```\n";
    
    // Header row
    result += columns.join(" | ") + "\n";
    result += columns.map(() => "---").join(" | ") + "\n";
    
    // First 3 rows
    for (let i = 0; i < 3; i++) {
      const row = data[i];
      const rowValues = columns.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return "null";
        if (typeof value === "number") return value.toLocaleString();
        return String(value);
      });
      result += rowValues.join(" | ") + "\n";
    }
    
    result += "```\n\n";
    
    // Last 2 rows
    if (data.length > 3) {
      result += "**Last 2 rows:**\n```\n";
      result += columns.join(" | ") + "\n";
      result += columns.map(() => "---").join(" | ") + "\n";
      
      for (let i = Math.max(3, data.length - 2); i < data.length; i++) {
        const row = data[i];
        const rowValues = columns.map(col => {
          const value = row[col];
          if (value === null || value === undefined) return "null";
          if (typeof value === "number") return value.toLocaleString();
          return String(value);
        });
        result += rowValues.join(" | ") + "\n";
      }
      
      result += "```\n\n";
    }
    
    result += `📊 **Full dataset contains ${data.length} rows** - All data has been retrieved from the portal.\n\n` +
              `✅ **Next steps:** Use this data for analysis, create charts, calculate statistics, or generate summaries. ` +
              `Do not attempt to display all ${data.length} rows as it will be very slow in the chat interface.`;
    
    return result;
  }

  private formatDataResponse(data: any, prompt: string): string {
    // Legacy method - keeping for compatibility
    if (Array.isArray(data) && data.length > 0) {
      if (typeof data[0] === 'object' && data[0] !== null) {
        const columns = Object.keys(data[0]);
        return this.formatQueryResults(data, columns);
      }
    }
    
    return `Response:\n${JSON.stringify(data, null, 2)}`;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Rice Stock Data MCP Server running on stdio");
  }
}

const server = new RiceStockDataMCPServer();
server.run().catch(console.error);