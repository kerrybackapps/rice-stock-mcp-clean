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

interface ToolArguments {
  prompt: string;
  [key: string]: any;
}

class RiceStockDataMCPServer {
  private server: Server;
  private baseUrl: string;
  private userAccessToken: string;

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
    
    if (!this.userAccessToken) {
      console.error("ERROR: USER_ACCESS_TOKEN environment variable is required");
      console.error("Each user must store their personal Rice Data Portal access token in Claude Desktop configuration");
      console.error("Get your token by confirming your university email at the Rice Data Portal");
      process.exit(1);
    }
    
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
      // Step 1: Get AI response and SQL query from /chat endpoint
      const chatResponse = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: prompt,
          conversation_id: "mcp_session"
        })
      });

      if (!chatResponse.ok) {
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

      // Step 2: If there's no SQL query, return the communication (likely a clarifying question)
      if (!sqlQuery || sqlQuery.trim() === '') {
        if (communication.includes('?') || communication.toLowerCase().includes('clarif')) {
          return `**Question for you:** ${communication}`;
        }
        return communication;
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
        return `Query execution failed: ${errorText}`;
      }

      const queryData = await queryResponse.json() as any;
      
      // Step 4: Format and return the results
      if (queryData.data && Array.isArray(queryData.data)) {
        let result = communication ? `${communication}\n\n` : '';
        result += `**Query executed:** \`${sqlQuery}\`\n\n`;
        result += `**Results:** (${queryData.rows} rows, ${queryData.execution_time?.toFixed(2)}s)\n\n`;
        result += this.formatQueryResults(queryData.data, queryData.columns);
        return result;
      } else {
        return `${communication}\n\nQuery executed but returned no data.`;
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return "Request timed out. The query might be too complex. Try simplifying your question.";
      }
      return `Error connecting to the data portal: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private formatQueryResults(data: any[], columns: string[]): string {
    if (!data || data.length === 0) {
      return "No results found.";
    }

    // For small datasets (≤10 rows), show as a table
    if (data.length <= 10) {
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

    // For larger datasets, show first few rows + summary
    let result = `Showing first 5 of ${data.length} results:\n\n`;
    result += "```\n";
    
    // Header row
    result += columns.join(" | ") + "\n";
    result += columns.map(() => "---").join(" | ") + "\n";
    
    // First 5 rows
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i];
      const rowValues = columns.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return "null";
        if (typeof value === "number") return value.toLocaleString();
        return String(value);
      });
      result += rowValues.join(" | ") + "\n";
    }
    
    result += "```\n";
    
    if (data.length > 5) {
      result += `\n*... and ${data.length - 5} more rows*`;
    }
    
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