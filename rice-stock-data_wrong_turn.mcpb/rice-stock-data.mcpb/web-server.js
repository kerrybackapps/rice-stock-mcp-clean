import express from 'express';
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 8000;
const baseUrl = process.env.KOYEB_APP_URL || process.env.APP_URL || "https://your-app.koyeb.app";
app.get('/', (req, res) => {
    res.json({
        name: "Rice Stock Data MCP Server",
        version: "1.0.0",
        description: "MCP server for Rice Business Stock Market Data Portal",
        status: "running",
        endpoints: {
            health: "/health",
            chat: "/chat"
        }
    });
});
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});
app.post('/chat', async (req, res) => {
    try {
        const { message, token } = req.body;
        if (!token) {
            return res.status(401).json({ error: "Access token required" });
        }
        if (!message) {
            return res.status(400).json({ error: "Message required" });
        }
        // Here you would implement the actual chat logic
        // For now, returning a placeholder response
        res.json({
            message: `Processing query: ${message}`,
            response: "This endpoint would connect to the Rice Data Portal API",
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : "Internal server error"
        });
    }
});
app.listen(PORT, () => {
    console.log(`Rice Stock Data MCP Server running on port ${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
});
//# sourceMappingURL=web-server.js.map