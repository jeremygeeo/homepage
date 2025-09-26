require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { convertDocsToHtml } = require('./googleDocsToHtml.js');
const { formatTimeAgo } = require('./utils.js');
const syncService = require('./sync.js');

const app = express();
const PORT = process.env.PORT || 3000;
const LISTEN_IP = process.env.LISTEN_IP || '127.0.0.1';
const PAGES_DIRECTORY = process.env.PAGES_DIRECTORY || path.join(__dirname, '../pages');
const TEMPLATES_DIRECTORY = process.env.TEMPLATES_DIRECTORY || path.join(__dirname, '../templates');
const CACHE_DIRECTORY = process.env.CACHE_DIRECTORY || path.join(__dirname, '../cache');

// Main route to render pages from local JSON files
app.get('/:filename', async (req, res) => {
    const filename = `${req.params.filename}.json`;
    console.log(`Request for document: ${filename}`);
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
                <p>The document "${req.params.filename}" could not be found.</p>
            `);
        } else if (error instanceof SyntaxError) {
            // JSON parsing error
            console.error(`Error parsing JSON file: ${filename}`, error);
            res.status(500).send(`<h1>500 - Server Error</h1><p>The file "${filename}" is not a valid JSON file.</p>`);
        } else {
            // Other server errors
            console.error(`An unexpected error occurred for "${filename}":`, error);
            res.status(500).send('<h1>500 - Internal Server Error</h1>');
        }
    }
});

app.get('/', async (req, res) => {
    try {
        const [indexJson, templateHtml] = await Promise.all([
            fs.readFile(path.join(CACHE_DIRECTORY, 'index.json'), 'utf8'),
            fs.readFile(path.join(TEMPLATES_DIRECTORY, 'index.html'), 'utf8')
        ]);

        const documents = new Map(JSON.parse(indexJson));
        let tableRowsHtml = '';

        if (documents.size > 0) {
            for (const [name, doc] of documents.entries()) {
                const fileType = doc.mimeType.includes('spreadsheet') ? '[Sheet]' : '[Doc]';
                const timeAgo = formatTimeAgo(doc.modifiedTime);
                tableRowsHtml += `
                    <tr>
                        <td><span class="file-icon">${fileType}</span></td>
                        <td><a href="/${name}">${name}</a></td>
                        <td>${timeAgo}</td>
                    </tr>`;
            }
        } else {
            tableRowsHtml = '<tr><td colspan="3">No documents found in the configured Google Drive folder.</td></tr>';
        }

        const finalHtml = templateHtml.replace('<!-- FILE_LIST -->', tableRowsHtml);
        res.setHeader('Content-Type', 'text/html');
        res.send(finalHtml);
    } catch (error) {
        console.error(`Could not read or parse ${path.join(CACHE_DIRECTORY, 'index.json')}`, error);
        res.status(500).send('<h1>Error</h1><p>Could not load document list. Please wait for the next sync or check server logs.</p>');
    }
});

app.listen(PORT, LISTEN_IP, async () => {
    // Start the background sync service
    syncService.start();

    console.log(`Server is running on http://${LISTEN_IP}:${PORT}`);
    console.log(`Serving pages from: ${PAGES_DIRECTORY}`);
    console.log(`Using templates from: ${TEMPLATES_DIRECTORY}`);
});
