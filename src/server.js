require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { convertDocsToHtml } = require('./googleDocsToHtml.js');

const app = express();
const PORT = process.env.PORT || 3000;
const LISTEN_IP = process.env.LISTEN_IP || '127.0.0.1';
const PAGES_DIRECTORY = process.env.PAGES_DIRECTORY || path.join(__dirname, '../pages');
const TEMPLATES_DIRECTORY = process.env.TEMPLATES_DIRECTORY || path.join(__dirname, '../templates');

// Middleware to serve static files from the 'documents' directory if needed (e.g., for images)
app.use('/documents', express.static(PAGES_DIRECTORY));

// Main route to handle JSON file requests
app.get('/:filename', async (req, res) => {
    // Append .json to the requested filename to find the corresponding file
    const filename = `${req.params.filename}.json`;

    console.log( `Request for ${filename}` );

    const docPath = path.join(PAGES_DIRECTORY, filename);

    try {
        // 1. Check if the file exists. fs.access throws an error if it doesn't.
        await fs.access(docPath);

        // 2. Read the JSON document and the HTML template
        const [docJsonRaw, templateHtml] = await Promise.all([
            fs.readFile(docPath, 'utf8'),
            fs.readFile(path.join(TEMPLATES_DIRECTORY, 'docs.html'), 'utf8')
        ]);

        // 3. Parse the JSON and convert it to HTML
        const docJson = JSON.parse(docJsonRaw);
        const contentHtml = convertDocsToHtml(docJson);
        
        // 4. Inject the content into the template
        const finalHtml = templateHtml.replace('<!-- CONTENT -->', contentHtml);
        
        // 5. Send the final page
        res.setHeader('Content-Type', 'text/html');
        res.send(finalHtml);

    } catch (error) {
        if (error.code === 'ENOENT') {
            // File not found
            console.warn(`404 - File not found at path: ${docPath}`);
            res.status(404).send(`
                <h1>404 - Not Found</h1>
                <p>The document "${filename}" could not be found.</p>
            `);
        } else if (error instanceof SyntaxError) {
            // JSON parsing error
            console.error(`Error parsing JSON file: ${filename}`, error);
            res.status(500).send(`<h1>500 - Server Error</h1><p>The file "${filename}" is not a valid JSON file.</p>`);
        } else {
            // Other server errors
            console.error('An unexpected error occurred:', error);
            res.status(500).send('<h1>500 - Internal Server Error</h1>');
        }
    }
});

app.get('/', (req, res) => {

        return res.status(404).send(`
            <h1>Not Found</h1>
        `);
/*
    res.send(`
        <h1>Document Converter</h1>
        <p>Welcome! Please request a document by its filename.</p>
        <p>For example, try visiting <a href="/sample.json">/sample.json</a> to see a sample document.</p>
    `);
*/
});

app.listen(PORT, LISTEN_IP, () => {
    console.log(`Server is running on http://${LISTEN_IP}:${PORT}`);
    console.log(`Serving pages from: ${PAGES_DIRECTORY}`);
    console.log(`Using templates from: ${TEMPLATES_DIRECTORY}`);
});
