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
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: prompt,
          conversation_id: "mcp_session" // Use consistent ID for context
        })
      });

      if (response.ok) {
        const data = await response.json() as any;
        
        // Extract the response message
        if (data.message) {
          return data.message;
        } else if (data.response) {
          return data.response;
        } else {
          // If data is returned, format it nicely
          if (data.data) {
            return this.formatDataResponse(data.data, prompt);
          }
          return JSON.stringify(data, null, 2);
        }
      } else if (response.status === 401) {
        return "Authentication failed. Please check your access token is valid and hasn't expired.";
      } else if (response.status === 429) {
        return "Rate limit exceeded. Please wait a moment before trying again.";
      } else {
        const errorText = await response.text();
        return `API error (status ${response.status}): ${errorText}`;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return "Request timed out. The query might be too complex. Try simplifying your question.";
      }
      return `Error connecting to the data portal: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private formatDataResponse(data: any, prompt: string): string {
    if (Array.isArray(data) && data.length > 0) {
      // Check if it's tabular data
      if (typeof data[0] === 'object' && data[0] !== null) {
        // Create a simple table format
        let result = `Query: ${prompt}\n\n`;
        result += `Found ${data.length} results:\n\n`;
        
        // Get column headers
        const headers = Object.keys(data[0]);
        
        // Format as simple text table
        for (let i = 0; i < Math.min(data.length, 50); i++) {
          const row = data[i];
          result += `\n--- Result ${i + 1} ---\n`;
          for (const header of headers) {
            const value = row[header] ?? "N/A";
            result += `${header}: ${value}\n`;
          }
        }
        
        if (data.length > 50) {
          result += `\n... and ${data.length - 50} more results`;
        }
        
        return result;
      } else {
        return `Query: ${prompt}\n\nResults:\n${JSON.stringify(data, null, 2)}`;
      }
    }
    
    return `Query: ${prompt}\n\nResponse:\n${JSON.stringify(data, null, 2)}`;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Rice Stock Data MCP Server running on stdio");
  }
}

const server = new RiceStockDataMCPServer();
server.run().catch(console.error);